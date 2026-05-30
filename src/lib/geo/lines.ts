/**
 * Utilitaires sur les lignes ferroviaires (slugs SEO, chargement de la liste).
 */
import type { FeatureCollection } from 'geojson';

/** Transforme un libellé de ligne en slug d'URL SEO-friendly. */
export function slugifyLine(label: string): string {
	return label
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // retire les accents
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export interface RailLine {
	code: string | null;
	label: string;
	slug: string;
}

/**
 * Référentiel curaté des grandes lignes commerciales, pensé pour le SEO.
 *
 * Le GeoJSON RFN (loadLines) décrit le réseau *technique* avec des libellés peu
 * parlants ; ces entrées-là correspondent à ce que les voyageurs recherchent
 * réellement (« couverture Paris-Lyon ») et alimentent /ligne/[slug] + le sitemap.
 */
export interface CommercialLine {
	slug: string;
	name: string;
	/** Service principal exploité (TGV INOUI, OUIGO, Intercités, TER…). */
	service: string;
	from: string;
	to: string;
}

export const RAIL_LINES: CommercialLine[] = [
	{ slug: 'paris-lyon', name: 'Paris – Lyon', service: 'TGV INOUI', from: 'Paris', to: 'Lyon' },
	{
		slug: 'paris-marseille',
		name: 'Paris – Marseille',
		service: 'TGV INOUI',
		from: 'Paris',
		to: 'Marseille'
	},
	{
		slug: 'paris-bordeaux',
		name: 'Paris – Bordeaux',
		service: 'TGV INOUI',
		from: 'Paris',
		to: 'Bordeaux'
	},
	{
		slug: 'paris-nantes',
		name: 'Paris – Nantes',
		service: 'TGV INOUI',
		from: 'Paris',
		to: 'Nantes'
	},
	{
		slug: 'paris-rennes',
		name: 'Paris – Rennes',
		service: 'TGV INOUI',
		from: 'Paris',
		to: 'Rennes'
	},
	{ slug: 'paris-lille', name: 'Paris – Lille', service: 'TGV INOUI', from: 'Paris', to: 'Lille' },
	{
		slug: 'paris-strasbourg',
		name: 'Paris – Strasbourg',
		service: 'TGV INOUI',
		from: 'Paris',
		to: 'Strasbourg'
	},
	{
		slug: 'paris-toulouse',
		name: 'Paris – Toulouse',
		service: 'TGV INOUI / Intercités',
		from: 'Paris',
		to: 'Toulouse'
	},
	{
		slug: 'lyon-marseille',
		name: 'Lyon – Marseille',
		service: 'TGV INOUI',
		from: 'Lyon',
		to: 'Marseille'
	},
	{
		slug: 'paris-clermont-ferrand',
		name: 'Paris – Clermont-Ferrand',
		service: 'Intercités',
		from: 'Paris',
		to: 'Clermont-Ferrand'
	},
	{
		slug: 'bordeaux-marseille',
		name: 'Bordeaux – Marseille',
		service: 'Intercités',
		from: 'Bordeaux',
		to: 'Marseille'
	},
	{ slug: 'paris-nice', name: 'Paris – Nice', service: 'TGV INOUI', from: 'Paris', to: 'Nice' }
];

/** Les quatre opérateurs mobiles français, pour les pages SEO /operateur/[slug]. */
export interface MobileOperator {
	slug: string;
	name: string;
	/** Clé interne utilisée dans les données (mesures + ARCEP). */
	key: 'orange' | 'sfr' | 'free' | 'bouygues';
}

export const OPERATORS: MobileOperator[] = [
	{ slug: 'orange', name: 'Orange', key: 'orange' },
	{ slug: 'sfr', name: 'SFR', key: 'sfr' },
	{ slug: 'free', name: 'Free', key: 'free' },
	{ slug: 'bouygues', name: 'Bouygues Telecom', key: 'bouygues' }
];

/** Retrouve une ligne / un opérateur par slug (helpers pour les pages SEO). */
export const findLine = (slug: string) => RAIL_LINES.find((l) => l.slug === slug);
export const findOperator = (slug: string) => OPERATORS.find((o) => o.slug === slug);

/**
 * Lit static/data/rail-lines.geojson et renvoie la liste dédupliquée des lignes
 * (une entrée par slug). Utilisé pour générer les pages SEO /ligne/[slug] et le sitemap.
 */
export async function loadLines(fetchFn: typeof fetch): Promise<RailLine[]> {
	const res = await fetchFn('/data/rail-lines.geojson');
	if (!res.ok) return [];
	const fc = (await res.json()) as FeatureCollection;
	const bySlug = new Map<string, RailLine>();
	for (const f of fc.features) {
		const p = f.properties ?? {};
		const slug = (p.slug as string) ?? '';
		if (!slug || bySlug.has(slug)) continue;
		bySlug.set(slug, {
			code: (p.code as string) ?? null,
			label: (p.label as string) ?? slug,
			slug
		});
	}
	return [...bySlug.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}
