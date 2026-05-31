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
const ARCEP_RES = 7; // doit correspondre à ARCEP_RESOLUTION de import-arcep / build-arcep-lines
const OPERATORS: OperatorKey[] = ['orange', 'sfr', 'free', 'bouygues'];
/** Longueur minimale d'un tronçon sans couverture pour le compter en zone blanche (km). */
const MIN_WHITE_KM = 3;
/** Nombre max de zones blanches détaillées conservées par ligne (les plus longues). */
const MAX_WHITE_ZONES = 6;

const LEVEL_RANK: Record<string, number> = { TBC: 3, BC: 2, CL: 1 };

type Level = 'TBC' | 'BC' | 'CL' | null;
type Levels = Record<OperatorKey, Level>;

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Nettoie un libellé de gare GTFS pour un usage rédactionnel (« Mâcon Loché TGV » → « Mâcon Loché »). */
function prettyStation(name: string): string {
	return name
		.replace(/\s*\([^)]*\)\s*/g, ' ') // retire les parenthèses
		.replace(/\s+(TGV|Ville|Gare|SNCF)\b/gi, '') // qualificatifs de gare
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

		// Zones blanches : suites contiguës de best === null d'au moins MIN_WHITE_KM.
		const zones: { after: string; lengthKm: number }[] = [];
		for (let i = 0; i < n; ) {
			if (bestAt[i] === null) {
				let j = i;
				while (j < n && bestAt[j] === null) j++;
				const len = cum[j - 1] - cum[i];
				if (len >= MIN_WHITE_KM) zones.push({ after: stationBefore(cum[i]), lengthKm: r1(len) });
				i = j;
			} else i++;
		}
		zones.sort((a, b) => b.lengthKm - a.lengthKm);

		const toFractions = (d: LevelDist): LevelDist => ({
			TBC: r4(d.TBC / n),
			BC: r4(d.BC / n),
			CL: r4(d.CL / n),
			none: r4(d.none / n)
		});

		out[line.slug] = {
			lengthKm: r1(cum[n - 1]),
			samples: n,
			arcep: {
				orange: toFractions(arcepDist.orange),
				sfr: toFractions(arcepDist.sfr),
				free: toFractions(arcepDist.free),
				bouygues: toFractions(arcepDist.bouygues)
			},
			best: toFractions(bestDist),
			zonesBlanches: { count: zones.length, zones: zones.slice(0, MAX_WHITE_ZONES) }
		};
	}

	await writeFile('src/lib/geo/line-stats.json', JSON.stringify(out) + '\n');
	console.log(
		`[line-stats] écrit src/lib/geo/line-stats.json — ${Object.keys(out).length}/${RAIL_LINES.length} lignes ` +
			`(${missing} sans tracé GTFS) ✅`
	);
}

main().catch((e) => {
	console.error('[line-stats] échec :', e);
	process.exit(1);
});
