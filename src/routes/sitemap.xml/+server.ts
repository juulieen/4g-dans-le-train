import { RAIL_LINES, OPERATORS } from '$geo/lines';
import { lineStats } from '$geo/line-stats';
import { ORIGIN } from '$lib/site';
import type { RequestHandler } from './$types';

/** Génère le sitemap.xml à partir des routes statiques + pages lignes/opérateurs. */
export const prerender = true;

const BASE = ORIGIN;

export const GET: RequestHandler = () => {
	const staticPaths = ['', '/lignes', '/operateurs', '/faq', '/confidentialite'];
	// On n'inclut QUE les URLs indexables (cohérence avec les meta robots) : les
	// lignes complètes + les tronçons riches (stats ARCEP fiables). Les tronçons
	// minces et toutes les sous-pages opérateur × tronçon sont en noindex → exclus.
	const indexableLines = RAIL_LINES.filter((l) => !l.segmentOf || lineStats(l.slug));
	const linePaths = indexableLines.map((l) => `/ligne/${l.slug}`);
	const operatorPaths = OPERATORS.map((o) => `/operateur/${o.slug}`);
	// Pages croisées ligne × opérateur (hors tronçons, en noindex).
	const crossPaths = RAIL_LINES.filter((l) => !l.segmentOf).flatMap((l) =>
		OPERATORS.map((o) => `/ligne/${l.slug}/${o.slug}`)
	);
	const urls = [...staticPaths, ...linePaths, ...operatorPaths, ...crossPaths];

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${BASE}${u}</loc></url>`).join('\n')}
</urlset>`;

	return new Response(body, {
		headers: { 'Content-Type': 'application/xml' }
	});
};
