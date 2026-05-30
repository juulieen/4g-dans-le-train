/**
 * Importe la couverture mobile officielle ARCEP (« Mon Réseau Mobile ») et la
 * réduit à une couche légère exploitable sur le web.
 *
 * Source : Open Data ARCEP — « Cartes de couverture théorique », publiées par
 * opérateur et par technologie en GeoPackage compressé 7z (Lambert-93).
 * https://data.arcep.fr/mobile/couvertures_theoriques/
 *
 * Pipeline, 100 % JS/Bun (aucune dépendance système type GDAL/7z) :
 *   1. téléchargement des fichiers .gpkg.7z (un par opérateur × techno) ;
 *   2. décompression (7zip-min, binaire embarqué) ;
 *   3. lecture du GeoPackage (= base SQLite) via bun:sqlite ;
 *   4. décodage des géométries WKB et reprojection Lambert-93 → WGS84 (proj4) ;
 *   5. ÉCHANTILLONNAGE sur cellules H3 le long du corridor ferroviaire
 *      (rail-lines.geojson) : pour chaque cellule traversée par une voie, on
 *      teste si elle tombe dans un polygone de couverture et on retient le
 *      meilleur niveau par opérateur.
 *
 * La sortie (static/data/arcep-coverage.geojson) est une FeatureCollection de
 * points H3 — même représentation que les mesures communautaires —, donc petite
 * et directement affichable par MapLibre. Le détail France entière (polygones
 * lourds) n'est jamais envoyé au navigateur.
 *
 * Usage :
 *   bun run data:arcep                 # 4G, tous opérateurs (défaut)
 *   ARCEP_TECHNO=5G bun run data:arcep # autre techno (2G/3G/4G/5G)
 *
 * Voir docs/DATA.md.
 */
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Database } from 'bun:sqlite';
import sevenZip from '7zip-min';
import wkx from 'wkx';
import proj4 from 'proj4';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { latLngToCell, cellToLatLng } from 'h3-js';

const unpack = promisify(sevenZip.unpack);

// --- Configuration ---------------------------------------------------------

const TECHNO = (process.env.ARCEP_TECHNO ?? '4G').toUpperCase();
const QUARTER = process.env.ARCEP_QUARTER ?? '2025_T4';
/**
 * Résolution H3 pour la couche ARCEP. On utilise une maille plus grossière
 * (res 7 ≈ 1,4 km) que les mesures communautaires (res 9 ≈ 200 m) : la couverture
 * théorique varie lentement dans l'espace, et cela divise par ~50 le nombre de
 * cellules à tester (point-in-polygon), rendant l'import rapide.
 */
const ARCEP_RESOLUTION = Number(process.env.ARCEP_H3_RES ?? '7');
const BASE_URL = 'https://data.arcep.fr/mobile/couvertures_theoriques/last/Metropole/00_Metropole';

/** Codes opérateur ARCEP → identifiant interne utilisé côté app. */
const OPERATORS: { code: string; key: string }[] = [
	{ code: 'OF', key: 'orange' },
	{ code: 'SFR0', key: 'sfr' },
	{ code: 'FREE', key: 'free' },
	{ code: 'BOUY', key: 'bouygues' }
];

/** Le suffixe de fichier dépend de la techno (voix vs data). */
function usageFor(techno: string): string {
	return techno === '2G' ? 'voix' : 'data';
}

const TMP = '/tmp/arcep-import';
const OUT_DIR = 'static/data';
const OUT_FILE = `${OUT_DIR}/arcep-coverage.geojson`;
const RAIL_FILE = `${OUT_DIR}/rail-lines.geojson`;

/** Niveaux de couverture ARCEP, ordonnés du meilleur au moins bon. */
const LEVEL_RANK: Record<string, number> = { TBC: 3, BC: 2, CL: 1 };
const RANK_LEVEL: Record<number, string> = { 3: 'TBC', 2: 'BC', 1: 'CL' };

// Lambert-93 (RGF93).
proj4.defs(
	'EPSG:2154',
	'+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

// --- Étapes ----------------------------------------------------------------

async function download(url: string, dest: string): Promise<void> {
	if (existsSync(dest)) {
		console.log(`[arcep]   déjà téléchargé : ${dest}`);
		return;
	}
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
	await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** Décode une géométrie GeoPackage (header GP + WKB) en GeoJSON (en Lambert-93). */
function decodeGpkgGeom(blob: Uint8Array): MultiPolygon | Polygon | null {
	const buf = Buffer.from(blob);
	if (buf[0] !== 0x47 || buf[1] !== 0x50) return null; // magic "GP"
	const flags = buf[3];
	const envCode = (flags >> 1) & 0x07;
	const envSizes: Record<number, number> = { 0: 0, 1: 32, 2: 48, 3: 48, 4: 64 };
	const headerLen = 8 + (envSizes[envCode] ?? 0);
	const wkb = buf.subarray(headerLen);
	return wkx.Geometry.parse(wkb).toGeoJSON() as MultiPolygon | Polygon;
}

/** Reprojette en place toutes les coordonnées Lambert-93 → WGS84. */
function reproject(geom: MultiPolygon | Polygon): void {
	const conv = (ring: number[][]) => {
		for (const pt of ring) {
			const [lon, lat] = proj4('EPSG:2154', 'WGS84', [pt[0], pt[1]]);
			pt[0] = lon;
			pt[1] = lat;
		}
	};
	if (geom.type === 'Polygon') geom.coordinates.forEach(conv);
	else geom.coordinates.forEach((poly) => poly.forEach(conv));
}

/**
 * Construit l'ensemble des cellules H3 traversées par le réseau ferroviaire.
 * On échantillonne chaque LineString à pas régulier et on indexe chaque point.
 */
async function railCells(): Promise<Map<string, { lat: number; lng: number }>> {
	const rail = JSON.parse(await readFile(RAIL_FILE, 'utf8')) as FeatureCollection;
	const cells = new Map<string, { lat: number; lng: number }>();
	const STEP_KM = 0.7; // pas d'échantillonnage cohérent avec la maille ARCEP (res 7)
	for (const f of rail.features) {
		if (!f.geometry) continue;
		const lines =
			f.geometry.type === 'LineString'
				? [f.geometry.coordinates]
				: f.geometry.type === 'MultiLineString'
					? f.geometry.coordinates
					: [];
		for (const coords of lines) {
			if ((coords as number[][]).length < 2) continue;
			const line = turf.lineString(coords as number[][]);
			const len = turf.length(line, { units: 'kilometers' });
			for (let d = 0; d <= len; d += STEP_KM) {
				const pt = turf.along(line, d, { units: 'kilometers' });
				const [lng, lat] = pt.geometry.coordinates;
				const cell = latLngToCell(lat, lng, ARCEP_RESOLUTION);
				if (!cells.has(cell)) {
					const [clat, clng] = cellToLatLng(cell);
					cells.set(cell, { lat: clat, lng: clng });
				}
			}
		}
	}
	return cells;
}

interface CellCoverage {
	lat: number;
	lng: number;
	/** meilleur rang de niveau observé par opérateur */
	byOperator: Record<string, number>;
}

async function processOperator(
	op: { code: string; key: string },
	railCellMap: Map<string, { lat: number; lng: number }>,
	acc: Map<string, CellCoverage>
): Promise<void> {
	const file = `${QUARTER}_couv_Metropole_${op.code}_${TECHNO}_${usageFor(TECHNO)}.gpkg.7z`;
	const url = `${BASE_URL}/${file}`;
	const archive = join(TMP, file);
	const outDir = join(TMP, `${op.code}_${TECHNO}`);

	console.log(`[arcep] ${op.key} : téléchargement…`);
	await download(url, archive);
	console.log(`[arcep] ${op.key} : décompression…`);
	await rm(outDir, { recursive: true, force: true });
	await unpack(archive, outDir);
	const gpkg = (await readdir(outDir)).find((f) => f.endsWith('.gpkg'));
	if (!gpkg) throw new Error(`Pas de .gpkg dans ${outDir}`);

	const db = new Database(join(outDir, gpkg), { readonly: true });
	const table = (
		db.query("SELECT table_name FROM gpkg_contents WHERE data_type='features' LIMIT 1").get() as {
			table_name: string;
		}
	).table_name;

	const rows = db.query(`SELECT geom, niveau FROM "${table}"`).all() as {
		geom: Uint8Array;
		niveau: string;
	}[];
	db.close();

	// Polygones Turf reprojetés + bbox précalculée, triés du meilleur niveau au
	// moins bon pour pouvoir court-circuiter dès qu'on atteint TBC.
	const polys: {
		feature: Feature<Polygon | MultiPolygon>;
		rank: number;
		bbox: [number, number, number, number];
	}[] = [];
	for (const r of rows) {
		const rank = LEVEL_RANK[r.niveau];
		if (!rank) continue;
		const geom = decodeGpkgGeom(r.geom);
		if (!geom) continue;
		reproject(geom);
		const feature = turf.feature(geom);
		polys.push({ feature, rank, bbox: turf.bbox(feature) as [number, number, number, number] });
	}
	polys.sort((a, b) => b.rank - a.rank);
	console.log(`[arcep] ${op.key} : ${polys.length} polygones, test des cellules…`);

	let hits = 0;
	for (const [cell, { lat, lng }] of railCellMap) {
		const pt = turf.point([lng, lat]);
		let best = 0;
		for (const { feature, rank, bbox } of polys) {
			if (rank <= best) break; // trié décroissant : plus rien de mieux ensuite
			// Pré-filtre bbox (rapide) avant le point-in-polygon (coûteux).
			if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
			if (turf.booleanPointInPolygon(pt, feature)) {
				best = rank;
				break; // meilleur rang possible pour cette cellule (liste triée)
			}
		}
		if (best > 0) {
			hits++;
			const entry = acc.get(cell) ?? { lat, lng, byOperator: {} };
			entry.byOperator[op.key] = Math.max(entry.byOperator[op.key] ?? 0, best);
			acc.set(cell, entry);
		}
	}
	console.log(`[arcep] ${op.key} : ${hits} cellules couvertes`);
}

async function main() {
	await mkdir(TMP, { recursive: true });
	await mkdir(OUT_DIR, { recursive: true });

	if (!existsSync(RAIL_FILE)) {
		throw new Error(
			`${RAIL_FILE} manquant — lancez d'abord « bun run data:sncf » pour importer les voies.`
		);
	}

	console.log(`[arcep] techno=${TECHNO} trimestre=${QUARTER}`);
	console.log('[arcep] indexation du corridor ferroviaire (H3)…');
	const railCellMap = await railCells();
	console.log(`[arcep] ${railCellMap.size} cellules H3 le long des voies`);

	const acc = new Map<string, CellCoverage>();
	for (const op of OPERATORS) {
		try {
			await processOperator(op, railCellMap, acc);
		} catch (e) {
			console.warn(`[arcep] ${op.key} ignoré :`, (e as Error).message);
		}
	}

	const features: Feature[] = [];
	for (const [cell, cov] of acc) {
		const byOperator: Record<string, string> = {};
		for (const [k, rank] of Object.entries(cov.byOperator)) byOperator[k] = RANK_LEVEL[rank];
		features.push({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [cov.lng, cov.lat] },
			properties: { cellId: cell, techno: TECHNO, ...byOperator }
		});
	}

	await writeFile(OUT_FILE, JSON.stringify({ type: 'FeatureCollection', features }));
	console.log(`[arcep] écrit ${OUT_FILE} — ${features.length} cellules ✅`);
	console.log('[arcep] génération des voies colorées (data:arcep-lines)…');
}

main().catch((e) => {
	console.error('[arcep] échec :', e);
	process.exit(1);
});
