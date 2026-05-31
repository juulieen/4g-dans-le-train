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

	// Chaque ligne + la répartition ARCEP de cet opérateur (null si pas de tracé).
	const lines = RAIL_LINES.map((line) => ({
		line,
		dist: lineStats(line.slug)?.arcep[operator.key] ?? null
	}));

	// Synthèse : part « utilisable » (TBC+BC) moyenne, pondérée par la longueur.
	let wSum = 0;
	let usableSum = 0;
	for (const line of RAIL_LINES) {
		const s = lineStats(line.slug);
		if (!s) continue;
		const d: LevelDist = s.arcep[operator.key];
		wSum += s.lengthKm;
		usableSum += (d.TBC + d.BC) * s.lengthKm;
	}
	const avgUsable = wSum > 0 ? usableSum / wSum : null;

	return { operator, lines, avgUsable };
};
