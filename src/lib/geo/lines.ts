/**
 * Utilitaires sur les lignes ferroviaires (slugs SEO, chargement de la liste).
 *
 * Les briques de base (slugifyLine, CommercialLine, CURATED_LINES) vivent dans
 * `lines-base.ts`, qui ne dépend PAS du JSON généré, pour que les scripts d'import
 * puissent l'utiliser sans cycle. Ce module y ajoute le référentiel effectif
 * `RAIL_LINES`, chargé depuis `commercial-lines.json`.
 */
import type { FeatureCollection } from 'geojson';
import generatedLines from './commercial-lines.json';
import { CURATED_LINES, type CommercialLine } from './lines-base';

export { slugifyLine, CURATED_LINES, type CommercialLine } from './lines-base';

export interface RailLine {
	code: string | null;
	label: string;
	slug: string;
}

/**
 * Référentiel effectif des lignes commerciales, généré depuis le GTFS SNCF
 * (scripts/import-commercial-lines.ts → commercial-lines.json, committé) et
 * fusionné avec le noyau curaté. On retombe sur CURATED_LINES si le fichier
 * généré est vide (sécurité au cas où la génération n'a jamais tourné).
 */
const generated = generatedLines as CommercialLine[];
export const RAIL_LINES: CommercialLine[] = generated.length > 0 ? generated : CURATED_LINES;

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
