/**
 * Construit l'index spatial « cellule H3 (résolution 9) → slug de ligne commerciale »
 * et l'écrit dans src/lib/geo/line-index.json (committé).
 *
 * POURQUOI : le champ `lineSlug` des mesures était mort (jamais renseigné). Cet
 * index permet, à l'ingestion, de rattacher une mesure à sa ligne en O(1)
 * (`Map.get(cellId)`), sans calcul géométrique par requête.
 *
 * LA GÉOMÉTRIE (gares GTFS ordonnées → routage sur le RFN → échantillonnage en
 * cellules H3) est mutualisée dans `scripts/lib/rail-routing.ts` — partagée avec
 * `build-line-stats.ts` (B2) pour que les deux voient EXACTEMENT le même tracé.
 *
 * DÉSAMBIGUÏSATION : une cellule de tronc commun est routée par plusieurs lignes ;
 * on l'attribue à la ligne dont l'itinéraire total est le plus COURT (la plus
 * « locale » / structurante du tronc — ex. le tronc LGV Sud-Est → `paris-lyon`).
 *
 * LIMITES (cf. docs/PRODUCT.md) :
 *  - seules les cellules SUR une voie reçoivent un slug ; une mesure dont la
 *    cellule n'est sur aucune voie connue reste sans slug (acceptée quand même).
 *
 * Le fichier produit est COMMITTÉ (comme commercial-lines.json) pour que le
 * runtime/prerender fonctionne sans rejouer l'import.
 *
 * Licence source : Licence Ouverte / Open Licence (Etalab).
 */
import { writeFile } from 'node:fs/promises';
import { latLngToCell } from 'h3-js';
import { H3_RESOLUTION } from '../src/lib/geo/h3';
import { RAIL_LINES } from '../src/lib/geo/lines';
import {
	RailGraph,
	routeLine,
	sampleLine,
	stationRoutesBySlug,
	STEP_KM,
	type Coord
} from './lib/rail-routing';

const OUT_FILE = 'src/lib/geo/line-index.json';

// --- main -------------------------------------------------------------------

async function main() {
	console.log('[line-index] 1/3 — itinéraires de gares (GTFS)…');
	const routes = await stationRoutesBySlug();
	const stations = new Map<string, Coord[]>(
		[...routes].map(([slug, sts]) => [slug, sts.map((s) => s.coord)])
	);
	console.log(`[line-index]   ${stations.size}/${RAIL_LINES.length} lignes avec itinéraire`);

	console.log('[line-index] 2/3 — graphe routable du réseau RFN…');
	const graph = await RailGraph.fromRfn();
	const edges = graph.adj.reduce((s, a) => s + a.length, 0) / 2;
	console.log(`[line-index]   ${graph.coords.length} sommets, ${edges} arêtes`);

	console.log('[line-index] 3/3 — routage par ligne + rattachement des cellules…');
	// cellule → (slug → longueur d'itinéraire) : une cellule de tronc commun est
	// revendiquée par plusieurs lignes ; on conserve toutes les revendications.
	const claims = new Map<string, Map<string, number>>();
	const perSlug = new Map<string, number>();
	let totalFallbacks = 0;
	const debug = process.env.DEBUG_LINE_INDEX === '1';
	const diag: { slug: string; stops: number; len: number; cells: number; fb: number }[] = [];

	for (const [slug, sts] of [...stations].sort((a, b) => a[0].localeCompare(b[0]))) {
		const { coords, lengthKm, fallbacks } = routeLine(graph, sts);
		totalFallbacks += fallbacks;
		if (coords.length < 2) {
			perSlug.set(slug, 0);
			if (debug) diag.push({ slug, stops: sts.length, len: 0, cells: 0, fb: fallbacks });
			continue;
		}
		const cells = new Set<string>();
		for (const [lng, lat] of sampleLine(coords, STEP_KM))
			cells.add(latLngToCell(lat, lng, H3_RESOLUTION));
		for (const cell of cells) {
			let m = claims.get(cell);
			if (!m) claims.set(cell, (m = new Map()));
			m.set(slug, lengthKm);
		}
		perSlug.set(slug, cells.size);
		if (debug)
			diag.push({ slug, stops: sts.length, len: lengthKm, cells: cells.size, fb: fallbacks });
	}
	if (debug) {
		console.log('[line-index] DIAG (slug | gares | longueur km | cellules routées | replis)');
		for (const d of diag.sort((a, b) => a.len - b.len))
			console.log(
				`  ${d.slug.padEnd(26)} ${String(d.stops).padStart(3)}  ${d.len.toFixed(0).padStart(5)}  ${String(d.cells).padStart(5)}  ${d.fb}`
			);
	}

	// Index final, format COMPACT indexé pour limiter la taille committée :
	//   { slugs: [...], cells: { "<cellId>": [i, j, ...] } }
	// où les entiers indexent `slugs`. Les slugs d'une cellule sont ordonnés par
	// itinéraire CROISSANT : le premier (primaire) est la ligne la plus
	// spécifique/locale traversant la cellule, les suivants sont les autres lignes
	// du tronc commun (utiles aux pages SEO par ligne, B1/B2). Minifié + exclu de
	// Prettier (.prettierignore), comme les autres jeux de données générés.
	const slugList = [...new Set([...claims.values()].flatMap((m) => [...m.keys()]))].sort();
	const slugIdx = new Map(slugList.map((s, i) => [s, i]));
	const cells: Record<string, number[]> = {};
	let multi = 0;
	for (const cell of [...claims.keys()].sort()) {
		const ordered = [...claims.get(cell)!.entries()].sort((a, b) => a[1] - b[1]).map(([s]) => s);
		cells[cell] = ordered.map((s) => slugIdx.get(s)!);
		if (ordered.length > 1) multi++;
	}
	await writeFile(OUT_FILE, JSON.stringify({ slugs: slugList, cells }) + '\n');

	const total = Object.keys(cells).length;
	console.log(
		`[line-index] écrit ${OUT_FILE} : ${total} cellules rattachées (${multi} sur tronc commun)`
	);
	const missing = RAIL_LINES.filter((l) => !stations.has(l.slug)).map((l) => l.slug);
	const zero = [...stations.keys()].filter((s) => !(perSlug.get(s) ?? 0));
	console.log(
		`[line-index] ${stations.size}/${RAIL_LINES.length} lignes routées ; ` +
			`${missing.length} sans itinéraire GTFS ; ${zero.length} sans cellule ; ${totalFallbacks} segments en repli corde`
	);
	if (missing.length) console.log(`[line-index]   sans itinéraire GTFS : ${missing.join(', ')}`);
	if (zero.length) console.log(`[line-index]   sans cellule : ${zero.join(', ')}`);
	console.log('[line-index] ✅');
}

main().catch((e) => {
	console.error('[line-index] échec :', e);
	process.exit(1);
});
