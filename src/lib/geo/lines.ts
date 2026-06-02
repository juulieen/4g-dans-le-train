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
import { USAGE_OPS, OPERATOR_LABEL } from '../usage';

export { slugifyLine, CURATED_LINES, type CommercialLine } from './lines-base';

export interface RailLine {
	code: string | null;
	label: string;
	slug: string;
}

/**
 * Référentiel effectif des lignes commerciales, généré depuis le GTFS SNCF
 * (scripts/import-commercial-lines.ts → commercial-lines.json, committé) et
 * fusionné avec le noyau curaté.
 *
 * `commercial-lines.json` est importé statiquement : il est committé, donc
 * toujours présent à la compilation (un fichier absent/corrompu ferait échouer
 * le build, pas un fallback runtime). Le repli sur CURATED_LINES ne couvre donc
 * que le cas « JSON présent mais tableau vide » (placeholder non régénéré).
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

export const OPERATORS: MobileOperator[] = USAGE_OPS.map((key) => ({
	slug: key,
	name: OPERATOR_LABEL[key],
	key
}));

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
