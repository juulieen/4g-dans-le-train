import { error } from '@sveltejs/kit';
import { OPERATORS, findOperator } from '$geo/lines';
import type { EntryGenerator, PageLoad } from './$types';

/** Pages programmatiques par opérateur — prerendues pour le SEO. */
export const prerender = true;

export const entries: EntryGenerator = () => OPERATORS.map((o) => ({ slug: o.slug }));

export const load: PageLoad = ({ params }) => {
	const operator = findOperator(params.slug);
	if (!operator) throw error(404, 'Opérateur inconnu');
	return { operator };
};
