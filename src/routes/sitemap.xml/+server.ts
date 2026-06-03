import { RAIL_LINES, OPERATORS } from '$geo/lines';
import { lineStats } from '$geo/line-stats';
import type { RequestHandler } from './$types';

/** Génère le sitemap.xml à partir des routes statiques + pages lignes/opérateurs. */
export const prerender = true;

const BASE = 'https://4g-dans-le-train.juulieen.fr';

export const GET: RequestHandler = () => {
	const staticPaths = ['', '/lignes', '/operateurs', '/faq', '/confidentialite'];
	// On n'inclut QUE les URLs indexables sur le critère ARCEP STABLE (connu au build) :
	// lignes complètes + tronçons riches en stats ARCEP. NB : depuis le passage en SSR,
	// la page peut AUSSI s'auto-indexer si le RÉEL mesuré est suffisant (`real.sufficient`,
	// inconnu au build) — ces tronçons-là ne figurent pas au sitemap mais restent
	// découvrables par crawl (le sitemap est un indice, pas la seule porte d'entrée).
	const indexableLines = RAIL_LINES.filter((l) => !l.segmentOf || lineStats(l.slug));
	const linePaths = indexableLines.map((l) => `/ligne/${l.slug}`);
	const operatorPaths = OPERATORS.map((o) => `/operateur/${o.slug}`);
	// Pages croisées ligne × opérateur : seulement les lignes complètes (les tronçons ×
	// opérateur sont en `noindex` sauf réel suffisant — laissés au crawl, cf. ci-dessus).
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
