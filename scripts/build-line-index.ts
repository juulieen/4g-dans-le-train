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
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeatureCollection, LineString, MultiLineString } from 'geojson';
import { distance } from '@turf/turf';
import { latLngToCell } from 'h3-js';
import { H3_RESOLUTION } from '../src/lib/geo/h3';
import { RAIL_LINES, slugifyLine } from '../src/lib/geo/lines';
import { bestLevel, toLevel, type Level, type UsageOp } from '../src/lib/usage';
import { itinerariesBySlug, cityMatches, type Station } from './lib/gtfs';
import { makeCityResolver } from './lib/troncons';

// --- Paramètres -------------------------------------------------------------

const RAIL_FILE = 'static/data/rail-lines.geojson';
const OUT_FILE = 'src/lib/geo/line-index.json';
/**
 * Rattachement des tronçons à leur ligne parente : `{ <slug>: { parent, cells } }`.
 * Sert aux API mesures à afficher, sur une page tronçon, les mesures de la portion
 * correspondante de la parente (le tronçon n'est PAS dans line-index.json, pour ne
 * pas détourner l'attribution primaire des mesures de la parente).
 */
const TRONCON_CELLS_FILE = 'src/lib/geo/troncon-cells.json';

/** Couverture ARCEP par cellule H3 res 7 (source du fond théorique de la frise). */
const ARCEP_FILE = 'static/data/arcep-coverage.geojson';
const ARCEP_RES = 7;
/** Dossier des profils de trajet par ligne (frise « profil de trajet », handoff B1). */
const PROFILES_DIR = 'static/data/route-profiles';
/** Pas de la polyligne simplifiée embarquée dans chaque profil (km) — sert à situer
 *  mesures réelles et coupures sur l'axe distance sans embarquer de map de cellules. */
const PATH_STEP_KM = 1;

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

/**
 * Niveaux de couverture ARCEP par opérateur d'une cellule (`none` = zone blanche).
 * Les types et helpers d'usage (`Level`, `bestLevel`, `toLevel`) sont partagés avec
 * le front via `src/lib/usage.ts` — source unique des couleurs/rangs/labels.
 */
type OpLevels = Record<UsageOp, Level>;

const km = (a: Coord, b: Coord) => distance(a, b, { units: 'kilometers' });

// --- 1) GTFS : suite ordonnée des gares par slug ----------------------------

/**
 * Découpe un itinéraire entre les gares résolues vers les villes `fromSlug` /
 * `toSlug`, orienté de from → to. Renvoie null si l'une des deux est absente.
 * `cityOf` est le résolveur gare→ville PARTAGÉ avec la découverte des tronçons :
 * un tronçon issu d'une course de sa parente est donc toujours redécoupable ici.
 */
function sliceItinerary(
	stops: Station[],
	fromSlug: string,
	toSlug: string,
	cityOf: (name: string) => { slug: string } | null
): Station[] | null {
	const iFrom = stops.findIndex((s) => cityOf(s.name)?.slug === fromSlug);
	const iTo = stops.findIndex((s) => cityOf(s.name)?.slug === toSlug);
	if (iFrom < 0 || iTo < 0 || iFrom === iTo) return null;
	const [lo, hi] = iFrom < iTo ? [iFrom, iTo] : [iTo, iFrom];
	let seg = stops.slice(lo, hi + 1);
	if (iFrom > iTo) seg = seg.slice().reverse(); // oriente from → to
	return seg.length >= 2 ? seg : null;
}

/**
 * Itinéraires de gares par slug :
 *  - `parents` : une entrée par ligne GTFS « réelle » (via `itinerariesBySlug`) —
 *    alimente l'index spatial ET les profils ;
 *  - `segments` : une entrée par tronçon (`segmentOf`), découpée depuis
 *    l'itinéraire de sa ligne parente — alimente UNIQUEMENT les profils (jamais
 *    l'index spatial des mesures, cf. CommercialLine.segmentOf). Le découpage
 *    utilise le MÊME résolveur de ville que la découverte des tronçons.
 */
async function stationsBySlug(): Promise<{
	parents: Map<string, Station[]>;
	segments: Map<string, Station[]>;
}> {
	const parentLines = RAIL_LINES.filter((l) => !l.segmentOf);
	const parents = await itinerariesBySlug(parentLines);

	const cityOf = makeCityResolver(parentLines);
	const segments = new Map<string, Station[]>();
	for (const l of RAIL_LINES) {
		if (!l.segmentOf) continue;
		const parent = parents.get(l.segmentOf);
		if (!parent) {
			console.warn(
				`[line-index]   ⚠ tronçon ${l.slug} : parente « ${l.segmentOf} » sans itinéraire GTFS, ignoré`
			);
			continue;
		}
		const seg = sliceItinerary(parent, slugifyLine(l.from), slugifyLine(l.to), cityOf);
		if (!seg) {
			console.warn(
				`[line-index]   ⚠ tronçon ${l.slug} : gares « ${l.from} »/« ${l.to} » introuvables dans « ${l.segmentOf} », ignoré`
			);
			continue;
		}
		segments.set(l.slug, seg);
	}
	return { parents, segments };
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

	/**
	 * Sommets candidats dans les buckets voisins d'une position. Fenêtre de ±2
	 * buckets (et non ±1) car `cellDeg` est dimensionné en degrés de LATITUDE :
	 * un degré de longitude vaut moins de km (~74 km à 48°N vs 111 km), donc
	 * CONNECT_KM peut s'étendre sur ~1,5 bucket en est-ouest. ±2 garantit qu'aucune
	 * paire à moins de CONNECT_KM n'est manquée (les fausses paires sont écartées
	 * ensuite par le filtre `km()` réel dans fromRfn).
	 */
	private near(lng: number, lat: number): number[] {
		const cx = Math.floor(lng / this.cellDeg);
		const cy = Math.floor(lat / this.cellDeg);
		const out: number[] = [];
		for (let dx = -2; dx <= 2; dx++)
			for (let dy = -2; dy <= 2; dy++) out.push(...(this.grid.get(`${cx + dx},${cy + dy}`) ?? []));
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

// --- 4) Profils de trajet par ligne (frise B1) ------------------------------

/** Point échantillonné le long du tracé, avec sa distance cumulée depuis l'origine. */
type DistPoint = { lng: number; lat: number; distKm: number };

/** Échantillonne une polyligne tous les `stepKm` en gardant la distance cumulée. */
function sampleWithDist(coords: Coord[], stepKm: number): DistPoint[] {
	const pts: DistPoint[] = [];
	if (coords.length === 0) return pts;
	pts.push({ lng: coords[0][0], lat: coords[0][1], distKm: 0 });
	let acc = 0; // distance cumulée jusqu'au sommet `i-1`
	let carry = 0;
	for (let i = 1; i < coords.length; i++) {
		const a = coords[i - 1];
		const b = coords[i];
		const segLen = km(a, b);
		if (segLen === 0) continue;
		let d = stepKm - carry;
		while (d < segLen) {
			const f = d / segLen;
			pts.push({ lng: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, distKm: acc + d });
			d += stepKm;
		}
		carry = segLen - (d - stepKm);
		acc += segLen;
	}
	pts.push({ lng: coords[coords.length - 1][0], lat: coords[coords.length - 1][1], distKm: acc });
	return pts;
}

/** Charge la couverture ARCEP (points H3 res 7) dans une map cellule → niveaux. */
async function loadArcep(): Promise<Map<string, OpLevels>> {
	const fc = JSON.parse(await readFile(ARCEP_FILE, 'utf8')) as FeatureCollection;
	const map = new Map<string, OpLevels>();
	for (const f of fc.features) {
		const p = f.properties ?? {};
		const cell = p.cellId as string | undefined;
		if (!cell) continue;
		map.set(cell, {
			orange: toLevel(p.orange),
			sfr: toLevel(p.sfr),
			free: toLevel(p.free),
			bouygues: toLevel(p.bouygues)
		});
	}
	return map;
}

/** Distance équirectangulaire approchée (km) — suffisante pour un plus-proche-point. */
function approxKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
	const mLat = ((aLat + bLat) / 2) * (Math.PI / 180);
	const x = (aLng - bLng) * Math.cos(mLat);
	const y = aLat - bLat;
	return Math.sqrt(x * x + y * y) * 111.32;
}

/** Projette une gare sur l'échantillonnage et renvoie sa distance cumulée (ou null si trop loin). */
function projectStation(s: Station, samples: DistPoint[]): number | null {
	let best = Infinity;
	let dist = 0;
	for (const pt of samples) {
		const d = approxKm(s.coord[0], s.coord[1], pt.lng, pt.lat);
		if (d < best) {
			best = d;
			dist = pt.distKm;
		}
	}
	// Une gare à plus de 3 km du tracé routé est probablement hors ligne (écartée).
	return best <= 3 ? dist : null;
}

const round = (n: number, d = 3) => Number(n.toFixed(d));

/**
 * Écrit un profil de trajet par ligne dans static/data/route-profiles/<slug>.json :
 * gares ordonnées + distance, segments ARCEP (run-length par niveaux d'opérateur),
 * et une polyligne simplifiée pour situer mesures réelles / coupures sur l'axe.
 */
async function writeRouteProfiles(
	routed: Map<string, { coords: Coord[]; lengthKm: number; stations: Station[] }>,
	arcep: Map<string, OpLevels>
): Promise<number> {
	const NONE: OpLevels = { orange: 'none', sfr: 'none', free: 'none', bouygues: 'none' };
	const meta = new Map(RAIL_LINES.map((l) => [l.slug, l]));
	await rm(PROFILES_DIR, { recursive: true, force: true });
	await mkdir(PROFILES_DIR, { recursive: true });
	let written = 0;

	for (const [slug, entry] of routed) {
		let { coords, stations } = entry;
		const { lengthKm } = entry;
		if (coords.length < 2) continue;

		// Oriente la frise de `from` → `to` (le libellé de ligne). L'ordre GTFS peut
		// être inverse (ex. itinéraire Lyon→Paris pour la ligne « Paris – Lyon ») :
		// on compare le slug des gares terminales aux villes from/to et on inverse
		// le tracé au besoin, pour que la distance croisse depuis la gare de départ.
		const m0 = meta.get(slug);
		if (m0 && stations.length >= 2) {
			const first = slugifyLine(stations[0].name);
			const last = slugifyLine(stations[stations.length - 1].name);
			const fromC = slugifyLine(m0.from);
			const toC = slugifyLine(m0.to);
			const startIsTo = cityMatches(first, toC);
			const startIsFrom = cityMatches(first, fromC);
			if (startIsTo && !startIsFrom) {
				coords = [...coords].reverse();
				stations = [...stations].reverse();
			} else if (!startIsFrom && !startIsTo) {
				// Aucune extrémité ne matche le référentiel (libellé GTFS divergent) :
				// on garde l'ordre GTFS, mais on le signale pour repérer les régressions.
				const endMatchesFrom = cityMatches(last, fromC);
				if (!endMatchesFrom)
					console.warn(
						`[line-index]   ⚠ ${slug} : orientation incertaine (gares « ${stations[0].name} » → « ${stations[stations.length - 1].name} » ≠ ${m0.from}/${m0.to}), ordre GTFS conservé`
					);
			}
		}

		const fine = sampleWithDist(coords, STEP_KM);

		// Segments ARCEP : fusion des points consécutifs de mêmes niveaux d'opérateur.
		type Seg = { fromKm: number } & OpLevels & { best: Level };
		const segs: Seg[] = [];
		const key = (l: OpLevels) => `${l.orange}|${l.sfr}|${l.free}|${l.bouygues}`;
		let prevKey = '';
		for (const pt of fine) {
			const lv = arcep.get(latLngToCell(pt.lat, pt.lng, ARCEP_RES)) ?? NONE;
			const k = key(lv);
			if (k !== prevKey) {
				segs.push({ fromKm: round(pt.distKm), ...lv, best: bestLevel(lv) });
				prevKey = k;
			}
		}
		// Borne `toKm` de chaque segment = début du suivant (dernier = longueur totale).
		const arcepSegs = segs.map((s, i) => ({
			fromKm: s.fromKm,
			toKm: round(i + 1 < segs.length ? segs[i + 1].fromKm : lengthKm),
			orange: s.orange,
			sfr: s.sfr,
			free: s.free,
			bouygues: s.bouygues,
			best: s.best
		}));

		// Gares ordonnées + distance cumulée (gares hors tracé écartées).
		const stationsOut: { name: string; distKm: number }[] = [];
		for (const s of stations) {
			const d = projectStation(s, fine);
			if (d !== null && s.name) stationsOut.push({ name: s.name, distKm: round(d, 2) });
		}
		stationsOut.sort((a, b) => a.distKm - b.distKm);

		// Polyligne simplifiée [lng, lat, distKm] pour situer mesures/coupures.
		const path = sampleWithDist(coords, PATH_STEP_KM).map(
			(p) => [round(p.lng, 5), round(p.lat, 5), round(p.distKm, 2)] as [number, number, number]
		);

		const m = meta.get(slug);
		const profile = {
			slug,
			name: m?.name ?? slug,
			from: m?.from ?? stationsOut[0]?.name ?? '',
			to: m?.to ?? stationsOut[stationsOut.length - 1]?.name ?? '',
			lengthKm: round(lengthKm, 1),
			stations: stationsOut,
			arcep: arcepSegs,
			path
		};
		await writeFile(join(PROFILES_DIR, `${slug}.json`), JSON.stringify(profile) + '\n');
		written++;
	}
	return written;
}

// --- main -------------------------------------------------------------------

async function main() {
	console.log('[line-index] 1/3 — itinéraires de gares (GTFS)…');
	const { parents: stations, segments } = await stationsBySlug();
	const parentCount = RAIL_LINES.filter((l) => !l.segmentOf).length;
	console.log(
		`[line-index]   ${stations.size}/${parentCount} lignes avec itinéraire ; ${segments.size} tronçons découpés`
	);

	console.log('[line-index] 2/3 — graphe routable du réseau RFN…');
	const graph = await RailGraph.fromRfn();
	const edges = graph.adj.reduce((s, a) => s + a.length, 0) / 2;
	console.log(`[line-index]   ${graph.coords.length} sommets, ${edges} arêtes`);

	console.log('[line-index] 3/3 — routage par ligne + rattachement des cellules…');
	// cellule → (slug → longueur d'itinéraire) : une cellule de tronc commun est
	// revendiquée par plusieurs lignes ; on conserve toutes les revendications.
	const claims = new Map<string, Map<string, number>>();
	const perSlug = new Map<string, number>();
	// Tracés routés conservés pour générer les profils de trajet (frise B1) sans
	// rejouer le routage (Dijkstra) une seconde fois.
	const routed = new Map<string, { coords: Coord[]; lengthKm: number; stations: Station[] }>();
	let totalFallbacks = 0;
	const debug = process.env.DEBUG_LINE_INDEX === '1';
	const diag: { slug: string; stops: number; len: number; cells: number; fb: number }[] = [];

	for (const [slug, sts] of [...stations].sort((a, b) => a[0].localeCompare(b[0]))) {
		const { coords, lengthKm, fallbacks } = routeLine(
			graph,
			sts.map((s) => s.coord)
		);
		totalFallbacks += fallbacks;
		if (coords.length < 2) {
			perSlug.set(slug, 0);
			if (debug) diag.push({ slug, stops: sts.length, len: 0, cells: 0, fb: fallbacks });
			continue;
		}
		routed.set(slug, { coords, lengthKm, stations: sts });
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

	// Tronçons : routés à part, UNIQUEMENT pour leur profil + leur rattachement à
	// la parente. Ils n'entrent PAS dans `claims` (index des mesures) → la parente
	// reste le slug primaire des cellules partagées (cf. CommercialLine.segmentOf).
	const segmentParent = new Map(
		RAIL_LINES.filter((l) => l.segmentOf).map((l) => [l.slug, l.segmentOf!])
	);
	const tronconCells: Record<string, { parent: string; cells: string[] }> = {};
	for (const [slug, sts] of [...segments].sort((a, b) => a[0].localeCompare(b[0]))) {
		const { coords, lengthKm, fallbacks } = routeLine(
			graph,
			sts.map((s) => s.coord)
		);
		totalFallbacks += fallbacks;
		if (coords.length < 2) {
			console.warn(`[line-index]   ⚠ tronçon ${slug} non routable, profil ignoré`);
			continue;
		}
		routed.set(slug, { coords, lengthKm, stations: sts });
		const cells = new Set<string>();
		for (const [lng, lat] of sampleLine(coords, STEP_KM))
			cells.add(latLngToCell(lat, lng, H3_RESOLUTION));
		const parent = segmentParent.get(slug);
		if (parent) tronconCells[slug] = { parent, cells: [...cells].sort() };
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
	await writeFile(TRONCON_CELLS_FILE, JSON.stringify(tronconCells) + '\n');

	const total = Object.keys(cells).length;
	console.log(
		`[line-index] écrit ${OUT_FILE} : ${total} cellules rattachées (${multi} sur tronc commun)`
	);
	console.log(
		`[line-index] écrit ${TRONCON_CELLS_FILE} : ${Object.keys(tronconCells).length} tronçons rattachés à leur parente`
	);
	const missing = RAIL_LINES.filter((l) => !l.segmentOf && !stations.has(l.slug)).map(
		(l) => l.slug
	);
	const zero = [...stations.keys()].filter((s) => !(perSlug.get(s) ?? 0));
	console.log(
		`[line-index] ${stations.size}/${parentCount} lignes routées ; ` +
			`${missing.length} sans itinéraire GTFS ; ${zero.length} sans cellule ; ${totalFallbacks} segments en repli corde`
	);
	if (missing.length) console.log(`[line-index]   sans itinéraire GTFS : ${missing.join(', ')}`);
	if (zero.length) console.log(`[line-index]   sans cellule : ${zero.join(', ')}`);

	// Profils de trajet par ligne (frise « profil de trajet », handoff B1).
	console.log('[line-index] 4/4 — profils de trajet (frise) + fond ARCEP…');
	const arcep = await loadArcep();
	const profiles = await writeRouteProfiles(routed, arcep);
	console.log(`[line-index] écrit ${profiles} profils dans ${PROFILES_DIR}/`);
	console.log('[line-index] ✅');
}

main().catch((e) => {
	console.error('[line-index] échec :', e);
	process.exit(1);
});
