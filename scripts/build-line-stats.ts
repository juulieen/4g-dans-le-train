/**
 * Calcule, par ligne commerciale, la couverture ARCEP THÉORIQUE le long du tracé
 * réel, et l'écrit dans src/lib/geo/line-stats.json (committé). Ces stats
 * alimentent les pages SEO prerendues (/ligne, /operateur, croisées) en chiffres
 * réels et en zones blanches nommées — sans coût runtime.
 *
 * PRINCIPE : on réutilise l'EXACT même tracé que `build-line-index` (module
 * partagé rail-routing) — gares GTFS ordonnées → routage sur le RFN →
 * échantillonnage en points tous les STEP_KM. En chaque point on lit le niveau
 * ARCEP (cellule H3 res 7 de static/data/arcep-coverage.geojson) pour les 4
 * opérateurs, puis on agrège :
 *   - répartition TBC/BC/CL/none par opérateur, pondérée par la LONGUEUR du
 *     parcours (« Orange annoncée excellente sur 78 % du trajet ») ;
 *   - répartition du « meilleur des 4 » (couverture au mieux) ;
 *   - zones blanches : tronçons contigus où AUCUN opérateur ne capte
 *     (best === none) d'au moins MIN_WHITE_KM, étiquetés par la gare amont
 *     (« après Mâcon ») grâce aux noms de gares GTFS.
 *
 * Entrées (déjà committées, aucun téléchargement de données ARCEP) :
 *   - static/data/arcep-coverage.geojson (niveaux ARCEP par cellule H3 res 7)
 *   - static/data/rail-lines.geojson     (réseau RFN, via rail-routing)
 *   - GTFS SNCF                           (itinéraires de gares, via rail-routing)
 *
 * Sortie : src/lib/geo/line-stats.json (committé, lu par src/lib/geo/line-stats.ts).
 *
 * Usage : bun run data:line-stats  (après data:line-index et data:arcep).
 * Licence sources : Licence Ouverte / Open Licence (Etalab).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { latLngToCell } from 'h3-js';
import type { FeatureCollection } from 'geojson';
import { RAIL_LINES } from '../src/lib/geo/lines';
import type { LineStats, LevelDist, OperatorKey } from '../src/lib/geo/line-stats';
import {
	RailGraph,
	routeLine,
	sampleLine,
	stationRoutesBySlug,
	STEP_KM,
	km
} from './lib/rail-routing';

const DATA = 'static/data';
// Résolution H3 de la couche ARCEP. DOIT suivre celle d'import-arcep
// (variable d'env ARCEP_H3_RES, défaut 7) et de build-arcep-lines.
const ARCEP_RES = 7;
const OPERATORS: OperatorKey[] = ['orange', 'sfr', 'free', 'bouygues'];
/** Longueur minimale d'un tronçon sans couverture pour le compter en zone blanche (km). */
const MIN_WHITE_KM = 3;
/** Deux trous séparés par moins de ce covert sont fusionnés (anti-fragmentation res 7). */
const MERGE_GAP_KM = 3;
/** Nombre max de zones blanches détaillées conservées par ligne (les plus longues). */
const MAX_WHITE_ZONES = 6;
/**
 * Garde-fou de fiabilité. `import-arcep` n'écrit QUE les cellules couvertes
 * (best > 0) : une cellule absente du jeu ARCEP signifie donc soit « vraie zone
 * blanche », soit « point hors du corridor qu'ARCEP a échantillonné ». Tant que
 * le tracé routé suit la voie indexée, l'absence ≈ zone blanche réelle. Mais sur
 * quelques lignes à gares GTFS rares, le routage s'écarte du corridor ARCEP et
 * gonfle artificiellement le « sans réseau » (ex. paris-nancy ~40 %, paris-sedan
 * ~30 %, contre ≤ 18 % pour les vraies lignes POLT). Au-delà de ce seuil, l'overlay
 * ARCEP de la ligne n'est pas fiable : on EXCLUT la ligne de line-stats.json
 * (la page retombe sur son contenu générique) plutôt que d'afficher de faux chiffres.
 */
const MAX_NODATA_FRACTION = 0.2;

const LEVEL_RANK: Record<string, number> = { TBC: 3, BC: 2, CL: 1 };

type Level = 'TBC' | 'BC' | 'CL' | null;
type Levels = Record<OperatorKey, Level>;

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Nettoie un libellé de gare GTFS pour un usage rédactionnel (« Mâcon Loché TGV » → « Mâcon Loché »). */
function prettyStation(name: string): string {
	const s = name
		.replace(/\s*\([^)]*\)\s*/g, ' ') // retire les parenthèses
		.replace(/\s+/g, ' ')
		.trim();
	// Gares parisiennes (« Paris Gare de Lyon », « Paris Est »…) → « Paris ».
	if (/^Paris\b/.test(s)) return 'Paris';
	// Qualificatifs de gare en suffixe (« … Ville », « … TGV », « Gare de … »).
	return s
		.replace(/\s+(TGV|Ville|SNCF)\b/gi, '')
		.replace(/\bGare\s+(de|du|des|d')\s+/gi, '')
		.replace(/\s+Gare\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function emptyDist(): LevelDist {
	return { TBC: 0, BC: 0, CL: 0, none: 0 };
}

/** Meilleur niveau des 4 opérateurs en un point (ou null = zone blanche). */
function bestOf(lv: Levels): Level {
	let rank = 0;
	for (const op of OPERATORS) {
		const r = lv[op] ? LEVEL_RANK[lv[op] as string] : 0;
		if (r > rank) rank = r;
	}
	return rank === 3 ? 'TBC' : rank === 2 ? 'BC' : rank === 1 ? 'CL' : null;
}

async function main() {
	// 1) Index ARCEP : cellule H3 res 7 → niveaux par opérateur.
	const arcep = JSON.parse(
		await readFile(`${DATA}/arcep-coverage.geojson`, 'utf8')
	) as FeatureCollection;
	const cov = new Map<string, Levels>();
	for (const f of arcep.features) {
		const p = (f.properties ?? {}) as Record<string, string>;
		if (!p.cellId) continue;
		cov.set(p.cellId, {
			orange: (p.orange as Level) ?? null,
			sfr: (p.sfr as Level) ?? null,
			free: (p.free as Level) ?? null,
			bouygues: (p.bouygues as Level) ?? null
		});
	}
	console.log(`[line-stats] ${cov.size} cellules ARCEP indexées (res ${ARCEP_RES})`);

	const EMPTY: Levels = { orange: null, sfr: null, free: null, bouygues: null };
	const levelsAt = (lng: number, lat: number): Levels =>
		cov.get(latLngToCell(lat, lng, ARCEP_RES)) ?? EMPTY;

	// 2) Itinéraires de gares (avec noms) + graphe routable du RFN.
	console.log('[line-stats] itinéraires de gares (GTFS) + graphe RFN…');
	const routes = await stationRoutesBySlug();
	const graph = await RailGraph.fromRfn();

	// 3) Par ligne : route le tracé, échantillonne, agrège ARCEP + zones blanches.
	const out: Record<string, LineStats> = {};
	let missing = 0;
	let unreliable = 0;
	const dropped: string[] = [];

	for (const line of RAIL_LINES) {
		const route = routes.get(line.slug);
		if (!route || route.length < 2) {
			missing++;
			continue;
		}
		const { coords } = routeLine(
			graph,
			route.map((s) => s.coord)
		);
		if (coords.length < 2) {
			missing++;
			continue;
		}
		const samples = sampleLine(coords, STEP_KM);
		const n = samples.length;

		// Distance cumulée et meilleur niveau en chaque point d'échantillonnage.
		const cum = new Array<number>(n);
		const bestAt = new Array<Level>(n);
		cum[0] = 0;
		const arcepDist: Record<OperatorKey, LevelDist> = {
			orange: emptyDist(),
			sfr: emptyDist(),
			free: emptyDist(),
			bouygues: emptyDist()
		};
		const bestDist = emptyDist();
		const bump = (d: LevelDist, lv: Level) => (lv ? (d[lv] += 1) : (d.none += 1));

		for (let i = 0; i < n; i++) {
			if (i > 0) cum[i] = cum[i - 1] + km(samples[i - 1], samples[i]);
			const lv = levelsAt(samples[i][0], samples[i][1]);
			for (const op of OPERATORS) bump(arcepDist[op], lv[op]);
			const b = bestOf(lv);
			bestAt[i] = b;
			bump(bestDist, b);
		}

		// Position cumulée de chaque gare (point d'échantillonnage le plus proche).
		const stationCum = route
			.map((st) => {
				let bi = 0;
				let bd = Infinity;
				for (let i = 0; i < n; i++) {
					const d = km(samples[i], st.coord);
					if (d < bd) {
						bd = d;
						bi = i;
					}
				}
				return { name: prettyStation(st.name), cum: cum[bi] };
			})
			.sort((a, b) => a.cum - b.cum);

		const stationBefore = (c: number): string => {
			let label = stationCum[0]?.name ?? line.from;
			for (const s of stationCum) {
				if (s.cum <= c) label = s.name;
				else break;
			}
			return label;
		};

		const toFractions = (d: LevelDist): LevelDist => ({
			TBC: r4(d.TBC / n),
			BC: r4(d.BC / n),
			CL: r4(d.CL / n),
			none: r4(d.none / n)
		});

		// Garde-fou : un « sans réseau » trop élevé trahit un tracé routé qui sort
		// du corridor ARCEP → overlay non fiable, on écarte la ligne entièrement.
		const best = toFractions(bestDist);
		if (best.none > MAX_NODATA_FRACTION) {
			unreliable++;
			dropped.push(line.slug);
			continue;
		}

		// Zones blanches : suites contiguës best === null, fusionnées si séparées par
		// un court tronçon couvert (la grille res 7 fragmente un même trou), puis
		// filtrées par longueur minimale et nommées par la gare amont.
		const raw: { start: number; end: number }[] = [];
		for (let i = 0; i < n; ) {
			if (bestAt[i] === null) {
				let j = i;
				while (j < n && bestAt[j] === null) j++;
				raw.push({ start: cum[i], end: cum[j - 1] });
				i = j;
			} else i++;
		}
		const merged: { start: number; end: number }[] = [];
		for (const r of raw) {
			const last = merged[merged.length - 1];
			if (last && r.start - last.end < MERGE_GAP_KM) last.end = r.end;
			else merged.push({ ...r });
		}
		const zones = merged
			.map((r) => ({ after: stationBefore(r.start), lengthKm: r1(r.end - r.start) }))
			.filter((z) => z.lengthKm >= MIN_WHITE_KM)
			.sort((a, b) => b.lengthKm - a.lengthKm);

		out[line.slug] = {
			lengthKm: r1(cum[n - 1]),
			samples: n,
			arcep: {
				orange: toFractions(arcepDist.orange),
				sfr: toFractions(arcepDist.sfr),
				free: toFractions(arcepDist.free),
				bouygues: toFractions(arcepDist.bouygues)
			},
			best,
			zonesBlanches: { count: zones.length, zones: zones.slice(0, MAX_WHITE_ZONES) }
		};
	}

	await writeFile('src/lib/geo/line-stats.json', JSON.stringify(out) + '\n');
	console.log(
		`[line-stats] écrit src/lib/geo/line-stats.json — ${Object.keys(out).length}/${RAIL_LINES.length} lignes ` +
			`(${missing} sans tracé GTFS, ${unreliable} écartées car overlay ARCEP peu fiable) ✅`
	);
	if (dropped.length) console.log(`[line-stats]   écartées : ${dropped.join(', ')}`);
}

main().catch((e) => {
	console.error('[line-stats] échec :', e);
	process.exit(1);
});
