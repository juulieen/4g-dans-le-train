import { RAIL_LINES, OPERATORS } from '$geo/lines';
import type { RequestHandler } from './$types';

/** Génère le sitemap.xml à partir des routes statiques + pages lignes/opérateurs. */
export const prerender = true;

const BASE = 'https://4g-dans-le-train.juulieen.fr';

export const GET: RequestHandler = () => {
	const staticPaths = ['', '/lignes', '/operateurs', '/faq', '/confidentialite'];
	const linePaths = RAIL_LINES.map((l) => `/ligne/${l.slug}`);
	const operatorPaths = OPERATORS.map((o) => `/operateur/${o.slug}`);
	// Pages croisées ligne × opérateur.
	const crossPaths = RAIL_LINES.flatMap((l) => OPERATORS.map((o) => `/ligne/${l.slug}/${o.slug}`));
	const urls = [...staticPaths, ...linePaths, ...operatorPaths, ...crossPaths];

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${BASE}${u}</loc></url>`).join('\n')}
</urlset>`;

	return new Response(body, {
		headers: { 'Content-Type': 'application/xml' }
	});
};
