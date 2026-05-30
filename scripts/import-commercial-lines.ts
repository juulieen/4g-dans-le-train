/**
 * Génère le référentiel des lignes *commerciales* (relations origine→destination)
 * à partir du GTFS « Voyages » de la SNCF, et écrit src/lib/geo/commercial-lines.json.
 *
 * Pourquoi : les pages SEO /ligne/[slug] (+ /lignes, sitemap, /operateur/[slug])
 * étaient alimentées par 12 lignes écrites à la main. Ce script les génère depuis
 * une source ouverte pour élargir la couverture et la maintenir facilement.
 *
 * Sources : GTFS SNCF Open Data (OpenDataSoft) — « Voyages » (TGV INOUI) et
 * « Intercités », agrégés via `GTFS_SOURCES`. Les libellés `route_long_name`
 * sont des relations commerciales (« Paris - Lyon ») exploitées pour le SEO.
 *
 * Le fichier produit est COMMITTÉ (≠ static/data/, gitignoré) pour que le build et
 * le prerender fonctionnent sans rejouer l'import. À régénérer périodiquement
 * (cf. `bun run data:all` et docs/DATA.md).
 *
 * Le téléchargement, le parsing CSV et surtout la dérivation du slug d'une route
 * sont mutualisés dans `scripts/lib/gtfs.ts` (mêmes helpers que build-line-index)
 * pour garantir des slugs identiques entre le référentiel et l'index spatial.
 *
 * Licence source : Licence Ouverte / Open Licence (Etalab).
 */
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CURATED_LINES, type CommercialLine } from '../src/lib/geo/lines-base';
import { GTFS_SOURCES, download, unzipTo, readCsv, parseCommercialRoute } from './lib/gtfs';

const TMP = '/tmp/sncf-gtfs-import';
const OUT_FILE = 'src/lib/geo/commercial-lines.json';

// --- Pipeline ---------------------------------------------------------------

async function main() {
	await mkdir(TMP, { recursive: true });

	const bySlug = new Map<string, CommercialLine>();
	const dropped: string[] = [];

	for (const src of GTFS_SOURCES) {
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
			const rel = parseCommercialRoute(longName);
			if (!rel) {
				dropped.push(longName || r.route_short_name || r.route_id);
				continue;
			}
			if (bySlug.has(rel.slug)) continue;
			bySlug.set(rel.slug, {
				slug: rel.slug,
				name: rel.name,
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

	// Indentation par tabulation pour coller au style Prettier (useTabs) du repo :
	// évite qu'une régénération casse `bun run lint` ou crée un diff de reformatage.
	await writeFile(OUT_FILE, JSON.stringify(merged, null, '\t') + '\n');

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
