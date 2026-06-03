import { error } from '@sveltejs/kit';
import { findLine, findOperator } from '$geo/lines';
import { lineStats } from '$geo/line-stats';
import { loadLineReal } from '$lib/server/line-real';
import type { PageServerLoad } from './$types';

/**
 * Page SEO croisée ligne × opérateur — en **SSR** (comme `/ligne/[slug]`), pour le
 * **verdict par opérateur** calculé sur la base vive (`loadLineReal` filtré sur
 * l'opérateur). Cible les recherches « internet {opérateur} train {ligne} ».
 */
export const prerender = false;

export const load: PageServerLoad = async ({ params, fetch, setHeaders }) => {
	const line = findLine(params.slug);
	const operator = findOperator(params.operateur);
	if (!line || !operator) throw error(404, 'Page inconnue');

	const stats = lineStats(line.slug) ?? null;
	const dist = stats ? stats.arcep[operator.key] : null;

	const real = await loadLineReal(fetch, line.slug, operator.key);

	// Tronçon × opérateur : noindex SAUF s'il a du réel mesuré suffisant (contenu unique).
	const noindex = Boolean(line.segmentOf) && !real.sufficient;

	setHeaders({ 'cache-control': 'public, max-age=300' });

	return { line, operator, stats, dist, noindex, real };
};
