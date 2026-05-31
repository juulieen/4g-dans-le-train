import { error } from '@sveltejs/kit';
import { RAIL_LINES, OPERATORS, findLine, findOperator } from '$geo/lines';
import { lineStats } from '$geo/line-stats';
import type { EntryGenerator, PageLoad } from './$types';

/**
 * Pages SEO croisées ligne × opérateur — prerendues.
 * Cible les recherches long-tail « couverture <opérateur> <ligne> », enrichies
 * de la répartition ARCEP de cet opérateur sur la ligne (line-stats.json).
 */
export const prerender = true;

export const entries: EntryGenerator = () =>
	RAIL_LINES.flatMap((l) => OPERATORS.map((o) => ({ slug: l.slug, operateur: o.slug })));

export const load: PageLoad = ({ params }) => {
	const line = findLine(params.slug);
	const operator = findOperator(params.operateur);
	if (!line || !operator) throw error(404, 'Page inconnue');
	const stats = lineStats(line.slug) ?? null;
	return { line, operator, stats };
};
