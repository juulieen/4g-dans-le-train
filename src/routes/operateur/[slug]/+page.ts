import { error } from '@sveltejs/kit';
import { RAIL_LINES, OPERATORS, findOperator } from '$geo/lines';
import { lineStats, type LevelDist } from '$geo/line-stats';
import type { EntryGenerator, PageLoad } from './$types';

/**
 * Pages programmatiques par opérateur — prerendues pour le SEO.
 * On attache à chaque ligne la répartition ARCEP de l'opérateur (pour un chiffre
 * par ligne) et on calcule une moyenne pondérée par la longueur (synthèse).
 */
export const prerender = true;

export const entries: EntryGenerator = () => OPERATORS.map((o) => ({ slug: o.slug }));

export const load: PageLoad = ({ params }) => {
	const operator = findOperator(params.slug);
	if (!operator) throw error(404, 'Opérateur inconnu');

	// Pour chaque ligne : la répartition ARCEP de cet opérateur (null si pas de
	// tracé) ; et en parallèle la synthèse « utilisable » (TBC+BC) moyenne,
	// pondérée par la longueur.
	let wSum = 0;
	let usableSum = 0;
	const lines = RAIL_LINES.map((line) => {
		const s = lineStats(line.slug);
		const dist: LevelDist | null = s?.arcep[operator.key] ?? null;
		if (s && dist) {
			wSum += s.lengthKm;
			usableSum += (dist.TBC + dist.BC) * s.lengthKm;
		}
		return { line, dist };
	});
	const avgUsable = wSum > 0 ? usableSum / wSum : null;

	return { operator, lines, avgUsable };
};
