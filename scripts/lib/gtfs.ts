/**
 * Helpers partagés pour lire les feeds GTFS SNCF (OpenDataSoft).
 *
 * Mutualisés entre `scripts/import-commercial-lines.ts` (référentiel des lignes)
 * et `scripts/build-line-index.ts` (index spatial cellule → ligne). Le point
 * CRUCIAL est que les deux scripts dérivent le slug d'une route avec EXACTEMENT
 * la même logique (`parseCommercialRoute`) : sinon l'index spatial pointerait
 * vers des slugs absents de `commercial-lines.json`.
 *
 * Source : GTFS « Voyages » (TGV INOUI) et « Intercités » SNCF Open Data.
 * Licence : Licence Ouverte / Open Licence (Etalab).
 */
import { mkdir, readFile, writeFile, rm, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sevenZip from '7zip-min';
import { slugifyLine, type CommercialLine } from '../../src/lib/geo/lines-base';

const unpack = promisify(sevenZip.unpack);

/** Dossier de travail partagé pour les téléchargements/décompressions GTFS. */
export const GTFS_TMP = '/tmp/sncf-gtfs-import';

/** Sources GTFS à agréger, dans l'ordre de priorité (1re source gagne en cas de slug identique). */
export const GTFS_SOURCES: { url: string; service: string }[] = [
	{
		url: 'https://eu.ftp.opendatasoft.com/sncf/gtfs/export_gtfs_voyages.zip',
		service: 'TGV INOUI'
	},
	{
		url: 'https://eu.ftp.opendatasoft.com/sncf/gtfs/export-intercites-gtfs-last.zip',
		service: 'Intercités'
	}
];

// --- Téléchargement / décompression ----------------------------------------

/** Télécharge `url` vers `dest` (no-op si déjà présent — partagé entre scripts). */
export async function download(url: string, dest: string): Promise<void> {
	if (existsSync(dest)) {
		console.log(`[gtfs]   déjà téléchargé : ${dest}`);
		return;
	}
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
	// Écriture atomique : on n'expose `dest` (réutilisé tel quel aux runs suivants)
	// qu'une fois le téléchargement complet, pour ne jamais réutiliser un ZIP tronqué.
	const part = `${dest}.part`;
	await writeFile(part, Buffer.from(await res.arrayBuffer()));
	await rename(part, dest);
}

/** Décompresse un .zip GTFS dans un dossier (recréé) et renvoie ce dossier. */
export async function unzipTo(archive: string, outDir: string): Promise<string> {
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	await unpack(archive, outDir);
	return outDir;
}

// --- Parsing CSV (GTFS) -----------------------------------------------------

/** Découpe une ligne CSV en respectant les champs entre guillemets. */
export function splitCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (inQuotes) {
			if (c === '"') {
				if (line[i + 1] === '"') {
					cur += '"';
					i++;
				} else inQuotes = false;
			} else cur += c;
		} else if (c === '"') inQuotes = true;
		else if (c === ',') {
			out.push(cur);
			cur = '';
		} else cur += c;
	}
	out.push(cur);
	return out;
}

/** Lit un fichier GTFS (CSV à entête) en tableau d'objets. */
export async function readCsv(path: string): Promise<Record<string, string>[]> {
	const text = await readFile(path, 'utf8');
	const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
	if (lines.length === 0) return [];
	const header = splitCsvLine(lines[0]).map((h) => h.trim());
	return lines.slice(1).map((line) => {
		const cells = splitCsvLine(line);
		const row: Record<string, string> = {};
		header.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()));
		return row;
	});
}

// --- Normalisation des libellés de relation --------------------------------

/** Qualificatif de service/itinéraire en suffixe à retirer (« … TGV », « … Route Nord »). */
const SUFFIX_RE = /\s+(TGV|SEA|BPL|Route\s+(Nord|Sud))$/i;

/**
 * Canonicalisation des extrémités : corrige les libellés GTFS (noms de gare,
 * abréviations, accents manquants, fautes) vers un nom de ville unique. Évite
 * notamment les pages SEO en double (« Clermont » vs « Clermont-Ferrand »).
 */
const CITY_ALIASES: Record<string, string> = {
	Clermont: 'Clermont-Ferrand',
	'Besançon Viotte': 'Besançon',
	'Saint-Etienne': 'Saint-Étienne',
	"Les Sables d'Olonnes": "Les Sables-d'Olonne"
};

/** Nettoie une extrémité : retire suffixes/qualificatifs, normalise les espaces. */
export function cleanEndpoint(raw: string): string {
	let s = raw
		.replace(/\s+/g, ' ')
		.trim()
		// retire un complément de parcours en fin (« Via … », « par … »)
		.replace(/\s+(via|par)\s+.+$/i, '');
	// retire les qualificatifs en suffixe, y compris empilés (« … TGV Route Sud »)
	let prev: string;
	do {
		prev = s;
		s = s.replace(SUFFIX_RE, '').trim();
	} while (s !== prev);
	// « Paris Austerlitz », « Paris Gare de Lyon »… → « Paris » (gares parisiennes)
	s = s.replace(/^Paris\s+\S.*$/, 'Paris');
	// canonicalisation finale (gare→ville, accents, fautes, dédoublonnage)
	return CITY_ALIASES[s] ?? s;
}

/**
 * Extrait { from, to } d'un `route_long_name`.
 * Sépare uniquement sur un tiret entouré d'espaces pour ne pas couper les noms
 * composés (« Saint-Malo », « Bas-Rhin »). Renvoie null si non exploitable.
 */
function parseRelation(longName: string): { from: string; to: string } | null {
	const parts = longName
		.split(/\s+[-–—]\s+/)
		.map(cleanEndpoint)
		.filter((p) => p.length > 0);
	if (parts.length < 2) return null;
	const from = parts[0];
	const to = parts[parts.length - 1];
	if (!from || !to) return null;
	return { from, to };
}

/**
 * Jetons régionaux / abréviations qui ne sont pas des villes exploitables pour
 * des pages SEO « ville → ville ». Les relations dont une extrémité est dans
 * cette liste (ou abrégée) sont écartées.
 */
const REGION_TOKENS = new Set(
	[
		'LR',
		'PACA',
		'IS',
		'IDF',
		'Atlantique',
		'Est',
		'Nord',
		'Sud Est',
		'Pays de la Loire',
		'Normandie',
		'Littoral',
		'Bretagne',
		'Vallée de la Marne',
		'Vallée du Rhône',
		'Côte d’Azur',
		"Côte d'Azur",
		'Languedoc Roussillon',
		'Lux',
		'Alsace',
		'Lorraine',
		'Loraine', // variante fautive présente dans le GTFS (« Lux/Alsace/Loraine »)
		'Bas-Rhin',
		'Haut-Rhin',
		'Vosges',
		// massifs / aires touristiques (pas des villes exploitables)
		'Alpes',
		'Arves',
		'Chablais',
		'Maurienne',
		'Tarentaise',
		'Mediterranee',
		'Méditerranée'
	].map((s) => s.toLowerCase())
);

/**
 * Destinations hors de France : on recentre le SEO sur « la 4G dans le train en
 * France ». Une relation dont une extrémité est étrangère est écartée (cela
 * élimine aussi des libellés bruités comme « Stuttgart Munich »).
 */
const FOREIGN_TOKENS = new Set(
	[
		'Francfort',
		'Bruxelles',
		'Genève',
		'Lausanne',
		'Luxembourg',
		'Zurich',
		'Milan',
		'Stuttgart Munich'
	].map((s) => s.toLowerCase())
);

/** Une extrémité est-elle une vraie ville française exploitable (≠ région/étranger) ? */
export function isUsableCity(name: string): boolean {
	if (name.length < 3) return false;
	if (name.includes('/')) return false; // « Lux/Alsace/Lorraine »
	if (/^[A-Z]{2,4}$/.test(name)) return false; // « LR », « IS », « BPL »
	const key = name.toLowerCase();
	if (REGION_TOKENS.has(key)) return false;
	if (FOREIGN_TOKENS.has(key)) return false; // recentrage France
	return true;
}

/**
 * Transforme un `route_long_name` GTFS en relation commerciale exploitable.
 * Renvoie `{ slug, name, from, to }` ou `null` si la relation n'est pas
 * exploitable. C'est la SOURCE DE VÉRITÉ du slug d'une route, partagée par
 * `import-commercial-lines.ts` et `build-line-index.ts`.
 */
export function parseCommercialRoute(
	longName: string
): { slug: string; name: string; from: string; to: string } | null {
	const rel = parseRelation(longName);
	if (!rel || rel.from === rel.to) return null;
	if (!isUsableCity(rel.from) || !isUsableCity(rel.to)) return null;
	const name = `${rel.from} – ${rel.to}`;
	const slug = slugifyLine(`${rel.from}-${rel.to}`);
	if (!slug) return null;
	return { slug, name, from: rel.from, to: rel.to };
}

// --- Itinéraires de gares par ligne (suite ordonnée des arrêts) -------------
//
// Mutualisé entre `import-commercial-lines.ts` (découverte des tronçons) et
// `build-line-index.ts` (index spatial + découpage des tronçons). LE POINT
// CRUCIAL — comme pour `parseCommercialRoute` — est que les deux scripts dérivent
// le MÊME itinéraire par ligne : sinon un tronçon découvert par l'un ne serait
// pas redécoupable par l'autre.

type Coord = [number, number]; // [lng, lat]

/** Une gare d'un itinéraire : sa position et son libellé GTFS. */
export interface Station {
	coord: Coord;
	name: string;
}

/**
 * Vrai si le slug d'une gare correspond à une ville (slug du référentiel), par
 * **segment** et non sous-chaîne brute : « latour-de-carol-enveitg » matche
 * « latour-de-carol », mais « tourcoing » ne matche PAS « tours ». Évite les faux
 * positifs silencieux de scoring/orientation/découpage.
 */
export function cityMatches(stationSlug: string, citySlug: string): boolean {
	if (!citySlug) return false;
	return (
		stationSlug === citySlug ||
		stationSlug.startsWith(citySlug + '-') ||
		stationSlug.endsWith('-' + citySlug) ||
		stationSlug.includes('-' + citySlug + '-')
	);
}

/**
 * Combien des deux terminus du référentiel (`from`/`to`) sont couverts par les
 * gares extrêmes d'un itinéraire (0, 1 ou 2). Sert à préférer un trajet qui va
 * VRAIMENT de la gare de départ à la gare d'arrivée, plutôt que le plus riche en
 * arrêts (qui peut dépasser le terminus ou bifurquer — ex. Paris–Saint-Brieuc
 * prolongé jusqu'à Saint-Malo).
 */
export function endpointScore(stops: Station[], from: string, to: string): number {
	if (stops.length < 2) return 0;
	const a = slugifyLine(stops[0].name);
	const b = slugifyLine(stops[stops.length - 1].name);
	const f = slugifyLine(from);
	const t = slugifyLine(to);
	const coversFrom = cityMatches(a, f) || cityMatches(b, f);
	const coversTo = cityMatches(a, t) || cityMatches(b, t);
	return (coversFrom ? 1 : 0) + (coversTo ? 1 : 0);
}

/**
 * Renvoie, par slug de ligne du référentiel, l'itinéraire de gares le plus
 * pertinent agrégé sur les feeds GTFS : d'abord la course dont les terminus
 * collent le mieux au `from`/`to` du référentiel, puis — à correspondance égale —
 * la plus riche en arrêts. Les slugs de tronçons (`segmentOf`) n'ont aucune route
 * GTFS et n'apparaissent donc jamais ici (ils sont découpés en aval).
 */
export async function itinerariesBySlug(lines: CommercialLine[]): Promise<Map<string, Station[]>> {
	const known = new Set(lines.map((l) => l.slug));
	const meta = new Map(lines.map((l) => [l.slug, l]));
	await mkdir(GTFS_TMP, { recursive: true });
	const best = new Map<string, Station[]>();

	for (const src of GTFS_SOURCES) {
		const name = src.url.split('/').pop() ?? 'gtfs.zip';
		const archive = join(GTFS_TMP, name);
		await download(src.url, archive);
		const dir = await unzipTo(archive, join(GTFS_TMP, name.replace(/\.zip$/, '')));
		const files = await readdir(dir);
		if (!['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt'].every((f) => files.includes(f)))
			continue;

		// stops.txt : stop_id → [lng, lat] + nom de la gare
		const coordOf = new Map<string, Coord>();
		const nameOf = new Map<string, string>();
		for (const s of await readCsv(join(dir, 'stops.txt'))) {
			const lat = Number(s.stop_lat);
			const lng = Number(s.stop_lon);
			if (Number.isFinite(lat) && Number.isFinite(lng)) {
				coordOf.set(s.stop_id, [lng, lat]);
				if (s.stop_name) nameOf.set(s.stop_id, s.stop_name.trim());
			}
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

		// Par course : gares ordonnées. On garde par slug le meilleur itinéraire.
		for (const [tripId, stopsOfTrip] of seqByTrip) {
			const slug = slugOfTrip.get(tripId)!;
			const stops: Station[] = [];
			let prev: Coord | null = null;
			for (const { stopId } of stopsOfTrip.sort((a, b) => a.seq - b.seq)) {
				const c = coordOf.get(stopId);
				if (!c) continue;
				if (prev && prev[0] === c[0] && prev[1] === c[1]) continue;
				stops.push({ coord: c, name: nameOf.get(stopId) ?? '' });
				prev = c;
			}
			if (stops.length < 2) continue;
			const m = meta.get(slug);
			const cur = best.get(slug);
			if (!cur) {
				best.set(slug, stops);
			} else if (m) {
				const sc = endpointScore(stops, m.from, m.to);
				const scCur = endpointScore(cur, m.from, m.to);
				if (sc > scCur || (sc === scCur && stops.length > cur.length)) best.set(slug, stops);
			} else if (stops.length > cur.length) {
				best.set(slug, stops);
			}
		}
	}
	return best;
}
