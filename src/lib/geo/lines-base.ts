/**
 * Briques de base sur les lignes commerciales — SANS dépendance au JSON généré.
 *
 * Ce module est volontairement isolé de `commercial-lines.json` : les scripts
 * d'import (scripts/import-commercial-lines.ts) en ont besoin pour *régénérer*
 * ce JSON. S'il importait le JSON, un fichier absent/corrompu empêcherait le
 * script de démarrer — impossible alors de le réparer. `lines.ts` réexporte tout
 * ceci et ajoute le référentiel effectif chargé depuis le JSON.
 */

/** Transforme un libellé de ligne en slug d'URL SEO-friendly. */
export function slugifyLine(label: string): string {
	return label
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // retire les accents
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Une ligne commerciale = une relation origine→destination présentée aux
 * voyageurs (« Paris – Lyon »). Alimente /ligne/[slug], /lignes, le sitemap et
 * les pages /operateur/[slug]. Le GeoJSON RFN (loadLines) décrit le réseau
 * *technique* avec des libellés peu parlants ; ce référentiel-ci correspond à ce
 * que les gens recherchent réellement (« couverture Paris-Lyon »).
 */
export interface CommercialLine {
	slug: string;
	name: string;
	/** Service principal exploité (TGV INOUI, OUIGO, Intercités, TER…). */
	service: string;
	from: string;
	to: string;
}

/**
 * Noyau curaté des grandes relations, maintenu à la main pour la qualité
 * éditoriale et le SEO. Sert aussi de tête de liste « featured » et de source
 * d'override / fallback pour le référentiel généré (cf. scripts/import-commercial-lines.ts).
 */
export const CURATED_LINES: CommercialLine[] = [
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
