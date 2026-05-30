/**
 * Dérive une couche de VOIES FERRÉES COLORÉES à partir de la couverture ARCEP.
 *
 * Au lieu d'afficher des points (peu parlants), on colore directement le tracé
 * de la voie selon ce qu'un voyageur peut y faire :
 *   - TBC  → streaming vidéo / visio
 *   - BC   → web, réseaux sociaux
 *   - CL   → messages, navigation lente
 *   - rien → zone blanche
 *
 * Entrées (déjà présentes, aucun téléchargement) :
 *   - static/data/rail-lines.geojson      (tracés SNCF)
 *   - static/data/arcep-coverage.geojson  (niveaux ARCEP par cellule H3, par opérateur)
 *
 * Sortie :
 *   - static/data/arcep-lines.geojson : segments LineString portant, par opérateur,
 *     le niveau ARCEP (`orange`,`sfr`,`free`,`bouygues`) + `best` (meilleur des 4).
 *     Les segments sont fusionnés tant que les niveaux ne changent pas (compacité).
 *
 * Usage : bun run data:arcep-lines  (lancé aussi en fin de data:arcep)
 */
import { readFile, writeFile } from 'node:fs/promises';
import * as turf from '@turf/turf';
import { latLngToCell } from 'h3-js';
import type { Feature, FeatureCollection, Position } from 'geojson';

const ARCEP_RES = 7; // doit correspondre à ARCEP_RESOLUTION de import-arcep
const STEP_KM = 0.5; // pas d'échantillonnage le long de la voie
const OPERATORS = ['orange', 'sfr', 'free', 'bouygues'] as const;
type Operator = (typeof OPERATORS)[number];
type Levels = Record<Operator, string | null>;

const LEVEL_RANK: Record<string, number> = { TBC: 3, BC: 2, CL: 1 };
const RANK_LEVEL: Record<number, string> = { 3: 'TBC', 2: 'BC', 1: 'CL' };

const DATA = 'static/data';

async function main() {
	const arcep = JSON.parse(
		await readFile(`${DATA}/arcep-coverage.geojson`, 'utf8')
	) as FeatureCollection;
	const rail = JSON.parse(
		await readFile(`${DATA}/rail-lines.geojson`, 'utf8')
	) as FeatureCollection;

	// Index cellule H3 → niveaux par opérateur.
	const cov = new Map<string, Levels>();
	for (const f of arcep.features) {
		const p = (f.properties ?? {}) as Record<string, string>;
		if (!p.cellId) continue;
		cov.set(p.cellId, {
			orange: p.orange ?? null,
			sfr: p.sfr ?? null,
			free: p.free ?? null,
			bouygues: p.bouygues ?? null
		});
	}
	console.log(`[lines] ${cov.size} cellules ARCEP indexées`);

	const EMPTY: Levels = { orange: null, sfr: null, free: null, bouygues: null };
	const levelsAt = (lng: number, lat: number): Levels =>
		cov.get(latLngToCell(lat, lng, ARCEP_RES)) ?? EMPTY;
	const sig = (l: Levels) => OPERATORS.map((o) => l[o] ?? '-').join('');
	const bestOf = (l: Levels): string | null => {
		let r = 0;
		for (const o of OPERATORS) r = Math.max(r, l[o] ? LEVEL_RANK[l[o] as string] : 0);
		return r ? RANK_LEVEL[r] : null;
	};

	const out: Feature[] = [];
	const pushSeg = (coords: Position[], lv: Levels) => {
		if (coords.length < 2) return;
		out.push({
			type: 'Feature',
			geometry: { type: 'LineString', coordinates: coords },
			properties: { ...lv, best: bestOf(lv) }
		});
	};

	let processed = 0;
	for (const f of rail.features) {
		if (!f.geometry) continue;
		const lines =
			f.geometry.type === 'LineString'
				? [f.geometry.coordinates]
				: f.geometry.type === 'MultiLineString'
					? f.geometry.coordinates
					: [];
		for (const coords of lines) {
			if ((coords as Position[]).length < 2) continue;
			const line = turf.lineString(coords as Position[]);
			const len = turf.length(line, { units: 'kilometers' });

			let segCoords: Position[] = [];
			let segLevels: Levels | null = null;
			for (let d = 0; d <= len; d += STEP_KM) {
				const pt = turf.along(line, d, { units: 'kilometers' }).geometry.coordinates;
				const lv = levelsAt(pt[0], pt[1]);
				if (segLevels === null) {
					segCoords = [pt];
					segLevels = lv;
				} else if (sig(lv) === sig(segLevels)) {
					segCoords.push(pt);
				} else {
					// La couverture change : on clôt le segment courant et on en démarre un.
					segCoords.push(pt);
					pushSeg(segCoords, segLevels);
					segCoords = [pt];
					segLevels = lv;
				}
			}
			if (segLevels) pushSeg(segCoords, segLevels);
		}
		if (++processed % 2000 === 0) console.log(`[lines] ${processed} voies traitées…`);
	}

	await writeFile(
		`${DATA}/arcep-lines.geojson`,
		JSON.stringify({ type: 'FeatureCollection', features: out })
	);
	console.log(`[lines] écrit ${DATA}/arcep-lines.geojson — ${out.length} segments ✅`);
}

main().catch((e) => {
	console.error('[lines] échec :', e);
	process.exit(1);
});
