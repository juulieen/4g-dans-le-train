/**
 * Construit l'index spatial « cellule H3 (résolution 9) → slug de ligne commerciale »
 * et l'écrit dans src/lib/geo/line-index.json (committé).
 *
 * POURQUOI : le champ `lineSlug` des mesures était mort (jamais renseigné). Cet
 * index permet, à l'ingestion, de rattacher une mesure à sa ligne en O(1)
 * (`Map.get(cellId)`), sans calcul géométrique par requête.
 *
 * LA SOURCE DU LIEN ligne → géométrie est le GTFS SNCF (mêmes feeds que
 * `data:lines`), via la chaîne de jointures :
 *   routes.txt     route_long_name (« Paris - Lyon ») → slug (parseCommercialRoute)
 *   trips.txt      route_id → courses
 *   stop_times.txt course → arrêts ordonnés (stop_sequence)
 *   stops.txt      arrêt → coordonnées de la gare (stop_lat / stop_lon)
 * On obtient ainsi, par ligne, la suite ORDONNÉE de ses gares (l'itinéraire le
 * plus riche parmi ses courses).
 *
 * GÉOMÉTRIE — pourquoi un routage et pas une simple corde gares-à-gares :
 * une corde droite entre deux gares très espacées (LGV) ne suit pas la voie et
 * laisse des trous / attribue des cellules à la mauvaise ligne. On route donc le
 * PLUS COURT CHEMIN sur le réseau ferré réel (static/data/rail-lines.geojson,
 * statut « Exploitée ») entre gares consécutives, puis on échantillonne ce tracé
 * en cellules H3 res 9. Le GeoJSON RFN n'étant PAS nœudé (les jonctions ne
 * partagent pas leurs sommets), on reconstruit la connectivité en reliant les
 * sommets distants de moins de CONNECT_KM (grille spatiale).
 *
 * DÉSAMBIGUÏSATION : une cellule de tronc commun est routée par plusieurs lignes ;
 * on l'attribue à la ligne dont l'itinéraire total est le plus COURT (la plus
 * « locale » / structurante du tronc — ex. le tronc LGV Sud-Est → `paris-lyon`).
 *
 * LIMITES (cf. docs/PRODUCT.md) :
 *  - seules les cellules SUR une voie reçoivent un slug ; une mesure dont la
 *    cellule n'est sur aucune voie connue reste sans slug (acceptée quand même).
 *  - si un segment gare-à-gare n'a pas de chemin sur le graphe (réseau localement
 *    disjoint), on retombe sur la corde droite pour ce segment (rare, journalisé).
 *
 * Le fichier produit est COMMITTÉ (comme commercial-lines.json) pour que le
 * runtime/prerender fonctionne sans rejouer l'import.
 *
 * Licence source : Licence Ouverte / Open Licence (Etalab).
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeatureCollection, LineString, MultiLineString } from 'geojson';
import { distance } from '@turf/turf';
import { latLngToCell } from 'h3-js';
import { H3_RESOLUTION } from '../src/lib/geo/h3';
import { RAIL_LINES } from '../src/lib/geo/lines';
import { GTFS_SOURCES, download, unzipTo, readCsv, parseCommercialRoute } from './lib/gtfs';

// --- Paramètres -------------------------------------------------------------

const TMP = '/tmp/sncf-gtfs-import';
const RAIL_FILE = 'static/data/rail-lines.geojson';
const OUT_FILE = 'src/lib/geo/line-index.json';

/** Seul le réseau en service nous intéresse (≠ Neutralisée / Fermée / Déclassée…). */
const RAIL_STATUS = 'Exploitée';
/** Distance max pour relier deux sommets RFN appartenant à des tronçons distincts (km). */
const CONNECT_KM = 0.35;
/** Pas d'échantillonnage du tracé routé en cellules (km). ≤ taille d'une cellule res 9. */
const STEP_KM = 0.12;
/** Distance max gare → réseau RFN ; au-delà la gare est ignorée (gares étrangères). */
const MAX_SNAP_KM = 8;
/** Un chemin plus long que RATIO×(vol d'oiseau) + marge est jugé invalide → corde droite. */
const DETOUR_RATIO = 4;
const DETOUR_SLACK_KM = 15;

type Coord = [number, number]; // [lng, lat]

const km = (a: Coord, b: Coord) => distance(a, b, { units: 'kilometers' });

// --- 1) GTFS : suite ordonnée des gares par slug ----------------------------

/** Renvoie, par slug de ligne du référentiel, l'itinéraire de gares le plus riche. */
async function stationsBySlug(): Promise<Map<string, Coord[]>> {
	const known = new Set(RAIL_LINES.map((l) => l.slug));
	await mkdir(TMP, { recursive: true });
	const best = new Map<string, Coord[]>();

	for (const src of GTFS_SOURCES) {
		const name = src.url.split('/').pop() ?? 'gtfs.zip';
		const archive = join(TMP, name);
		console.log(`[line-index] GTFS ${src.url}`);
		await download(src.url, archive);
		const dir = await unzipTo(archive, join(TMP, name.replace(/\.zip$/, '')));
		const files = await readdir(dir);
		if (
			!['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt'].every((f) => files.includes(f))
		) {
			console.warn(`[line-index]   ⚠ fichiers GTFS manquants dans ${name}, source ignorée`);
			continue;
		}

		// stops.txt : stop_id → [lng, lat]
		const coordOf = new Map<string, Coord>();
		for (const s of await readCsv(join(dir, 'stops.txt'))) {
			const lat = Number(s.stop_lat);
			const lng = Number(s.stop_lon);
			if (Number.isFinite(lat) && Number.isFinite(lng)) coordOf.set(s.stop_id, [lng, lat]);
		}

		// routes.txt : route_id → slug (uniquement les routes du référentiel)
		const slugOfRoute = new Map<string, string>();
		for (const r of await readCsv(join(dir, 'routes.txt'))) {
			const rel = parseCommercialRoute((r.route_long_name ?? '').trim());
			if (rel && known.has(rel.slug)) slugOfRoute.set(r.route_id, rel.slug);
		}

		// trips.txt : trip_id → slug
		const slugOfTrip = new Map<string, string>();
		for (const t of await readCsv(join(dir, 'trips.txt'))) {
			const slug = slugOfRoute.get(t.route_id);
			if (slug) slugOfTrip.set(t.trip_id, slug);
		}

		// stop_times.txt : course → arrêts ordonnés (uniquement les courses retenues)
		const seqByTrip = new Map<string, { seq: number; stopId: string }[]>();
		for (const st of await readCsv(join(dir, 'stop_times.txt'))) {
			if (!slugOfTrip.has(st.trip_id)) continue;
			const seq = Number(st.stop_sequence);
			if (!Number.isFinite(seq)) continue;
			let arr = seqByTrip.get(st.trip_id);
			if (!arr) seqByTrip.set(st.trip_id, (arr = []));
			arr.push({ seq, stopId: st.stop_id });
		}

		// Par course : coords ordonnées ; on garde par slug l'itinéraire le plus long.
		for (const [tripId, stopsOfTrip] of seqByTrip) {
			const slug = slugOfTrip.get(tripId)!;
			const coords: Coord[] = [];
			let prev: Coord | null = null;
			for (const { stopId } of stopsOfTrip.sort((a, b) => a.seq - b.seq)) {
				const c = coordOf.get(stopId);
				if (!c) continue;
				if (prev && prev[0] === c[0] && prev[1] === c[1]) continue;
				coords.push(c);
				prev = c;
			}
			if (coords.length < 2) continue;
			const cur = best.get(slug);
			if (!cur || coords.length > cur.length) best.set(slug, coords);
		}
	}
	return best;
}

// --- 2) Graphe routable du réseau RFN « Exploitée » -------------------------

class RailGraph {
	coords: Coord[] = [];
	adj: { to: number; w: number }[][] = [];
	private idOf = new Map<string, number>();
	private grid = new Map<string, number[]>();
	private cellDeg = CONNECT_KM / 111;

	private gkey(lng: number, lat: number): string {
		return `${Math.floor(lng / this.cellDeg)},${Math.floor(lat / this.cellDeg)}`;
	}

	private node(c: Coord): number {
		const key = `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
		let id = this.idOf.get(key);
		if (id === undefined) {
			id = this.coords.length;
			this.idOf.set(key, id);
			this.coords.push(c);
			this.adj.push([]);
			const gk = this.gkey(c[0], c[1]);
			(this.grid.get(gk) ?? this.grid.set(gk, []).get(gk)!).push(id);
		}
		return id;
	}

	private edge(a: number, b: number, w: number) {
		if (a === b) return;
		this.adj[a].push({ to: b, w });
		this.adj[b].push({ to: a, w });
	}

	/** Sommets dans les buckets voisins d'une position. */
	private near(lng: number, lat: number): number[] {
		const cx = Math.floor(lng / this.cellDeg);
		const cy = Math.floor(lat / this.cellDeg);
		const out: number[] = [];
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++) out.push(...(this.grid.get(`${cx + dx},${cy + dy}`) ?? []));
		return out;
	}

	static async fromRfn(): Promise<RailGraph> {
		const g = new RailGraph();
		const fc = JSON.parse(await readFile(RAIL_FILE, 'utf8')) as FeatureCollection;
		// Arêtes intra-tronçon (sommets consécutifs d'une même voie).
		for (const feat of fc.features) {
			if ((feat.properties?.label ?? '') !== RAIL_STATUS) continue;
			const geom = feat.geometry as LineString | MultiLineString;
			const parts: Coord[][] =
				geom.type === 'LineString'
					? [geom.coordinates as Coord[]]
					: geom.type === 'MultiLineString'
						? (geom.coordinates as Coord[][])
						: [];
			for (const coords of parts) {
				let prev = -1;
				for (const c of coords) {
					const id = g.node(c);
					if (prev >= 0) g.edge(prev, id, km(g.coords[prev], c));
					prev = id;
				}
			}
		}
		// Arêtes inter-tronçons : relie les sommets proches (< CONNECT_KM) pour
		// reconstituer les jonctions absentes du jeu de données.
		for (let i = 0; i < g.coords.length; i++) {
			const a = g.coords[i];
			for (const j of g.near(a[0], a[1])) {
				if (j <= i) continue;
				const d = km(a, g.coords[j]);
				if (d <= CONNECT_KM) g.edge(i, j, d);
			}
		}
		return g;
	}

	/** Sommet le plus proche d'une position, ou -1 si rien sous MAX_SNAP_KM. */
	nearestNode(c: Coord): number {
		let best = -1;
		let bestD = MAX_SNAP_KM;
		let foundRing = Infinity;
		const cx = Math.floor(c[0] / this.cellDeg);
		const cy = Math.floor(c[1] / this.cellDeg);
		// Élargit par anneaux de buckets. Un sommet trouvé à l'anneau `r` peut être
		// plus loin qu'un sommet de l'anneau `r+1` : on prolonge donc d'un anneau
		// après la première trouvaille avant de conclure.
		for (let ring = 1; ring <= 60 && ring <= foundRing + 1; ring++) {
			for (let dx = -ring; dx <= ring; dx++)
				for (let dy = -ring; dy <= ring; dy++) {
					if (ring > 1 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue; // anneau seulement
					for (const id of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
						const d = km(c, this.coords[id]);
						if (d < bestD) {
							bestD = d;
							best = id;
						}
					}
				}
			if (best >= 0 && foundRing === Infinity) foundRing = ring;
		}
		return best;
	}

	/** Plus court chemin (liste de sommets) entre deux nœuds, ou null. */
	shortestPath(src: number, dst: number): { dist: number; path: number[] } | null {
		const n = this.coords.length;
		const dist = new Float64Array(n).fill(Infinity);
		const prev = new Int32Array(n).fill(-1);
		dist[src] = 0;
		// tas binaire min sur (distance, nœud)
		const hd: number[] = [0];
		const hn: number[] = [src];
		const swap = (i: number, j: number) => {
			[hd[i], hd[j]] = [hd[j], hd[i]];
			[hn[i], hn[j]] = [hn[j], hn[i]];
		};
		const push = (d: number, x: number) => {
			hd.push(d);
			hn.push(x);
			let i = hd.length - 1;
			while (i > 0) {
				const p = (i - 1) >> 1;
				if (hd[p] <= hd[i]) break;
				swap(i, p);
				i = p;
			}
		};
		const pop = (): [number, number] => {
			const rd = hd[0];
			const rn = hn[0];
			const ld = hd.pop()!;
			const ln = hn.pop()!;
			if (hd.length) {
				hd[0] = ld;
				hn[0] = ln;
				let i = 0;
				for (;;) {
					const l = 2 * i + 1;
					const r = l + 1;
					let m = i;
					if (l < hd.length && hd[l] < hd[m]) m = l;
					if (r < hd.length && hd[r] < hd[m]) m = r;
					if (m === i) break;
					swap(i, m);
					i = m;
				}
			}
			return [rd, rn];
		};
		while (hd.length) {
			const [d, u] = pop();
			if (d > dist[u]) continue;
			if (u === dst) break;
			for (const { to, w } of this.adj[u]) {
				const nd = d + w;
				if (nd < dist[to]) {
					dist[to] = nd;
					prev[to] = u;
					push(nd, to);
				}
			}
		}
		if (!Number.isFinite(dist[dst])) return null;
		const path: number[] = [];
		for (let x = dst; x >= 0; x = prev[x]) path.push(x);
		path.reverse();
		return { dist: dist[dst], path };
	}
}

// --- 3) Tracé routé par ligne → cellules ------------------------------------

/** Échantillonne une polyligne tous les `stepKm` (interpolation linéaire lng/lat). */
function sampleLine(coords: Coord[], stepKm: number): Coord[] {
	const pts: Coord[] = [];
	if (coords.length === 0) return pts;
	pts.push(coords[0]);
	let carry = 0;
	for (let i = 1; i < coords.length; i++) {
		const a = coords[i - 1];
		const b = coords[i];
		const segLen = km(a, b);
		if (segLen === 0) continue;
		let d = stepKm - carry;
		while (d < segLen) {
			const f = d / segLen;
			pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
			d += stepKm;
		}
		carry = segLen - (d - stepKm);
	}
	// Garantit l'échantillonnage du dernier sommet (cellule de terminus), même si
	// la portion finale est plus courte que le pas restant. Doublon inoffensif
	// (les cellules sont dédupliquées par un Set en aval).
	pts.push(coords[coords.length - 1]);
	return pts;
}

/** Route une ligne (suite de gares) sur le graphe → polyligne suivant la voie. */
function routeLine(
	g: RailGraph,
	stations: Coord[]
): { coords: Coord[]; lengthKm: number; fallbacks: number } {
	// gares ramenées à un nœud du réseau (les gares hors RFN sont écartées)
	const nodes: number[] = [];
	for (const s of stations) {
		const id = g.nearestNode(s);
		if (id >= 0 && (nodes.length === 0 || nodes[nodes.length - 1] !== id)) nodes.push(id);
	}
	if (nodes.length < 2) return { coords: [], lengthKm: 0, fallbacks: 0 };

	const out: Coord[] = [g.coords[nodes[0]]];
	let fallbacks = 0;
	for (let i = 1; i < nodes.length; i++) {
		const a = nodes[i - 1];
		const b = nodes[i];
		const crow = km(g.coords[a], g.coords[b]);
		const sp = g.shortestPath(a, b);
		if (sp && sp.dist <= DETOUR_RATIO * crow + DETOUR_SLACK_KM) {
			for (let k = 1; k < sp.path.length; k++) out.push(g.coords[sp.path[k]]);
		} else {
			fallbacks++;
			out.push(g.coords[b]); // corde droite pour ce segment
		}
	}
	let lengthKm = 0;
	for (let i = 1; i < out.length; i++) lengthKm += km(out[i - 1], out[i]);
	return { coords: out, lengthKm, fallbacks };
}

// --- main -------------------------------------------------------------------

async function main() {
	console.log('[line-index] 1/3 — itinéraires de gares (GTFS)…');
	const stations = await stationsBySlug();
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
