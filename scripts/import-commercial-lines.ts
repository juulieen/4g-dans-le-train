/**
 * Génère le référentiel des lignes *commerciales* (relations origine→destination)
 * à partir du GTFS « Voyages » de la SNCF, et écrit src/lib/geo/commercial-lines.json.
 *
 * Pourquoi : les pages SEO /ligne/[slug] (+ /lignes, sitemap, /operateur/[slug])
 * étaient alimentées par 12 lignes écrites à la main. Ce script les génère depuis
 * une source ouverte pour élargir la couverture et la maintenir facilement.
 *
 * Source : « Horaires des TGV (GTFS) » — SNCF Open Data (OpenDataSoft).
 * Le flux ne contient que des TGV (route_type=2, agence « SNCF VOYAGEURS ») ; les
 * libellés `route_long_name` sont des relations commerciales (« Paris - Lyon »).
 *
 * Le fichier produit est COMMITTÉ (≠ static/data/, gitignoré) pour que le build et
 * le prerender fonctionnent sans rejouer l'import. À régénérer périodiquement
 * (cf. `bun run data:all` et docs/DATA.md).
 *
 * Licence source : Licence Ouverte / Open Licence (Etalab).
 */
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sevenZip from '7zip-min';
import { slugifyLine, CURATED_LINES, type CommercialLine } from '../src/lib/geo/lines';

const unpack = promisify(sevenZip.unpack);

// --- Configuration ---------------------------------------------------------

/**
 * Sources GTFS à agréger, dans l'ordre de priorité (en cas de slug identique,
 * la première source l'emporte). Chaque source impose le `service` affiché.
 * Pour élargir (TER…), ajouter ici une entrée avec l'URL du GTFS correspondant :
 * le reste du pipeline est générique.
 */
const SOURCES: { url: string; service: string }[] = [
	{
		url: 'https://eu.ftp.opendatasoft.com/sncf/gtfs/export_gtfs_voyages.zip',
		service: 'TGV INOUI'
	},
	{
		url: 'https://eu.ftp.opendatasoft.com/sncf/gtfs/export-intercites-gtfs-last.zip',
		service: 'Intercités'
	}
];

const TMP = '/tmp/sncf-gtfs-import';
const OUT_FILE = 'src/lib/geo/commercial-lines.json';

/**
 * Jetons régionaux / abréviations qui ne sont pas des villes exploitables pour
 * des pages SEO « ville → ville ». Les relations dont une extrémité est dans
 * cette liste (ou abrégée) sont écartées.
 */
const REGION_TOKENS = new Set(
	[
		'LR',
		'PACA',
		'Paca',
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
		'Loraine',
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

// --- Téléchargement / décompression ----------------------------------------

async function download(url: string, dest: string): Promise<void> {
	if (existsSync(dest)) {
		console.log(`[lines]   déjà téléchargé : ${dest}`);
		return;
	}
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
	await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** Décompresse un .zip GTFS dans un dossier et renvoie ce dossier. */
async function unzipTo(archive: string, outDir: string): Promise<string> {
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	await unpack(archive, outDir);
	return outDir;
}

// --- Parsing CSV (GTFS) -----------------------------------------------------

/** Découpe une ligne CSV en respectant les champs entre guillemets. */
function splitCsvLine(line: string): string[] {
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
async function readCsv(path: string): Promise<Record<string, string>[]> {
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

// --- Normalisation des libellés --------------------------------------------

/** Nettoie une extrémité : retire suffixes/qualificatifs, normalise les espaces. */
function cleanEndpoint(raw: string): string {
	return (
		raw
			.replace(/\s+/g, ' ')
			.trim()
			// retire un complément de parcours en fin (« Via … », « par … »)
			.replace(/\s+(via|par)\s+.+$/i, '')
			// retire des qualificatifs de service/itinéraire en suffixe
			.replace(/\s+(TGV|SEA|BPL|Route\s+(Nord|Sud))$/i, '')
			.replace(/\s+(TGV|SEA|BPL)$/i, '')
			.trim()
			// « Paris Austerlitz », « Paris Gare de Lyon »… → « Paris » (gares parisiennes)
			.replace(/^Paris\s+\S.*$/, 'Paris')
	);
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

/** Une extrémité est-elle une vraie ville exploitable (≠ région/abréviation) ? */
function isUsableCity(name: string): boolean {
	if (name.length < 3) return false;
	if (name.includes('/')) return false; // « Lux/Alsace/Loraine »
	if (/^[A-Z]{2,4}$/.test(name)) return false; // « LR », « IS », « BPL »
	if (REGION_TOKENS.has(name.toLowerCase())) return false;
	return true;
}

// --- Pipeline ---------------------------------------------------------------

async function main() {
	await mkdir(TMP, { recursive: true });

	const bySlug = new Map<string, CommercialLine>();
	const dropped: string[] = [];

	for (const src of SOURCES) {
		const name = src.url.split('/').pop() ?? 'gtfs.zip';
		const archive = join(TMP, name);
		console.log(`[lines] téléchargement ${src.url}`);
		await download(src.url, archive);

		const dir = await unzipTo(archive, join(TMP, name.replace(/\.zip$/, '')));
		const files = await readdir(dir);
		if (!files.includes('routes.txt')) {
			console.warn(`[lines]   ⚠ routes.txt absent dans ${name}, ignoré`);
			continue;
		}

		const routes = await readCsv(join(dir, 'routes.txt'));
		console.log(`[lines]   ${routes.length} routes dans ${name}`);

		for (const r of routes) {
			const longName = (r.route_long_name ?? '').trim();
			if (!longName) continue;
			const rel = parseRelation(longName);
			if (!rel || rel.from === rel.to) {
				dropped.push(longName || r.route_short_name || r.route_id);
				continue;
			}
			if (!isUsableCity(rel.from) || !isUsableCity(rel.to)) {
				dropped.push(longName);
				continue;
			}
			const displayName = `${rel.from} – ${rel.to}`;
			const slug = slugifyLine(`${rel.from}-${rel.to}`);
			if (!slug || bySlug.has(slug)) continue;
			bySlug.set(slug, {
				slug,
				name: displayName,
				service: src.service,
				from: rel.from,
				to: rel.to
			});
		}
	}

	// Fusion : le noyau curaté prime (libellés soignés + ordre « featured »).
	const generated = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
	const curatedSlugs = new Set(CURATED_LINES.map((l) => l.slug));
	const merged: CommercialLine[] = [
		...CURATED_LINES,
		...generated.filter((l) => !curatedSlugs.has(l.slug))
	];

	await writeFile(OUT_FILE, JSON.stringify(merged, null, 2) + '\n');

	console.log(
		`[lines] écrit ${OUT_FILE} : ${merged.length} lignes ` +
			`(${CURATED_LINES.length} curatées + ${merged.length - CURATED_LINES.length} générées)`
	);
	if (dropped.length) {
		console.log(`[lines] ${dropped.length} relations écartées (non exploitables) :`);
		for (const d of dropped.sort()) console.log(`          – ${d}`);
	}
	console.log('[lines] ✅');
}

main().catch((e) => {
	console.error('[lines] échec :', e);
	process.exit(1);
});
