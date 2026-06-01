import { error } from '@sveltejs/kit';
import { RAIL_LINES } from '$geo/lines';
import { lineStats } from '$geo/line-stats';
import type { EntryGenerator, PageLoad } from './$types';

/**
 * Pages programmatiques par ligne — prerendues pour le SEO.
 * Chaque ligne du référentiel devient une URL statique indexable, enrichie des
 * stats ARCEP pré-calculées (line-stats.json) figées dans le HTML au build.
 */
export const prerender = true;

export const entries: EntryGenerator = () => RAIL_LINES.map((l) => ({ slug: l.slug }));

export const load: PageLoad = ({ params }) => {
	const line = RAIL_LINES.find((l) => l.slug === params.slug);
	if (!line) throw error(404, 'Ligne inconnue');
	const stats = lineStats(line.slug) ?? null;
	// Un tronçon (`segmentOf`) est une sous-relation d'une ligne parente, présentée
	// comme une page bidirectionnelle unique. On référence la parente (lien + portion).
	const parent = line.segmentOf
		? (RAIL_LINES.find((l) => l.slug === line.segmentOf) ?? null)
		: null;
	// Stratégie SEO « large + monitoring » : on INDEXE les tronçons riches (stats
	// ARCEP fiables) et on met en `noindex` les tronçons trop minces (sans stats),
	// candidats naturels au pruning. Réglable ensuite selon Google Search Console.
	const noindex = Boolean(line.segmentOf) && !stats;
	return { line, stats, parent, isTroncon: Boolean(line.segmentOf), noindex };
};
