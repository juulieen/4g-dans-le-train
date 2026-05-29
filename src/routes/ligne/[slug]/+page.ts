import { error } from '@sveltejs/kit';
import { RAIL_LINES } from '$geo/lines';
import type { EntryGenerator, PageLoad } from './$types';

/**
 * Pages programmatiques par ligne — prerendues pour le SEO.
 * Chaque ligne du référentiel devient une URL statique indexable.
 */
export const prerender = true;

export const entries: EntryGenerator = () => RAIL_LINES.map((l) => ({ slug: l.slug }));

export const load: PageLoad = ({ params }) => {
	const line = RAIL_LINES.find((l) => l.slug === params.slug);
	if (!line) throw error(404, 'Ligne inconnue');
	return { line };
};
