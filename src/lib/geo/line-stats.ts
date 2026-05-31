/**
 * Statistiques de couverture ARCEP par ligne commerciale, pré-calculées au build
 * (`scripts/build-line-stats.ts` → line-stats.json, committé) et consommées par
 * les pages SEO prerendues — zéro coût runtime, données figées dans le HTML.
 *
 * POURQUOI : les pages /ligne, /operateur et croisées étaient des coquilles sans
 * aucun chiffre. On y injecte ici la couverture THÉORIQUE annoncée par l'ARCEP,
 * agrégée le long du tracé réel de chaque ligne (cf. docs/PRODUCT.md). La couche
 * RÉELLE (mesures communautaires, mouvante) reste chargée côté client
 * (CommunityComparison.svelte → /api/coverage?line=…), pas figée ici.
 *
 * Le JSON est généré : ne pas l'éditer à la main (exclu de Prettier).
 */
import raw from './line-stats.json';

/** Clé interne d'un opérateur (alignée sur MobileOperator.key de lines.ts). */
export type OperatorKey = 'orange' | 'sfr' | 'free' | 'bouygues';

/**
 * Répartition d'un opérateur (ou du meilleur des 4) le long du parcours, en
 * fractions de la longueur (somme ≈ 1) :
 *   TBC  très bonne couverture (streaming/visio)
 *   BC   bonne couverture (web, réseaux)
 *   CL   couverture limitée (messages, navigation lente)
 *   none zone blanche (aucune couverture annoncée)
 */
export interface LevelDist {
	TBC: number;
	BC: number;
	CL: number;
	none: number;
}

/** Une zone blanche connue : tronçon sans couverture, situé « après <gare> ». */
export interface WhiteZone {
	after: string;
	lengthKm: number;
}

/** Stats d'une ligne (clé = slug du référentiel). */
export interface LineStats {
	/** Longueur du tracé routé (km). */
	lengthKm: number;
	/** Nombre de points d'échantillonnage (≈ longueur / pas). */
	samples: number;
	/** Répartition ARCEP par opérateur. */
	arcep: Record<OperatorKey, LevelDist>;
	/** Répartition du meilleur opérateur en chaque point (couverture « au mieux »). */
	best: LevelDist;
	/** Zones blanches connues (best === none sur un tronçon contigu significatif). */
	zonesBlanches: { count: number; zones: WhiteZone[] };
}

export const LINE_STATS = raw as Record<string, LineStats>;

/** Stats d'une ligne par slug, ou `undefined` si la ligne n'a pas de tracé. */
export function lineStats(slug: string): LineStats | undefined {
	return LINE_STATS[slug];
}
