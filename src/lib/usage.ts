/**
 * Traduction « technique → usage concret » et palette de couleurs partagée.
 *
 * Le projet exprime la couverture par ce qu'on peut RÉELLEMENT y faire
 * (streaming / web / messages / rien) plutôt que par des chiffres bruts. Cette
 * palette était dupliquée dans Map.svelte ; on la centralise ici pour qu'elle
 * reste l'unique source de vérité (carte, légende, mode mesure).
 */

/** Niveaux d'usage, du meilleur au pire. */
export type UsageLevel = 'streaming' | 'web' | 'messages' | 'rien';

/**
 * Couleurs par niveau ARCEP (clé) → usage. Identiques aux variables CSS
 * --usage-* de +layout.svelte. Conservées avec les clés ARCEP (TBC/BC/CL/none)
 * car réutilisées telles quelles par les expressions MapLibre.
 */
export const USAGE_COLORS = {
	TBC: '#22c55e', // vert — streaming vidéo / visio
	BC: '#84cc16', // vert-clair — web, réseaux sociaux
	CL: '#f59e0b', // orange — messages, navigation lente
	none: '#ef4444' // rouge — zone blanche
} as const;

export interface UsageInfo {
	level: UsageLevel;
	label: string;
	color: string;
}

/** Correspondance niveau d'usage → (libellé, couleur). */
const USAGE_INFO: Record<UsageLevel, UsageInfo> = {
	streaming: { level: 'streaming', label: 'Streaming vidéo, visio', color: USAGE_COLORS.TBC },
	web: { level: 'web', label: 'Web, réseaux sociaux', color: USAGE_COLORS.BC },
	messages: { level: 'messages', label: 'Messages, navigation lente', color: USAGE_COLORS.CL },
	rien: { level: 'rien', label: 'Trop lent / pas de débit', color: USAGE_COLORS.none }
};

/**
 * Seuils de débit (kbps) → usage, ancrés sur le ressenti :
 * - ≥ 2000 kbps (2 Mb/s) : vidéo HD / visio confortable.
 * - ≥ 500 kbps : pages web et réseaux sociaux fluides.
 * - ≥ 100 kbps : messagerie texte, navigation lente.
 * - < 100 ou inconnu : trop lent / pas de débit.
 */
export const USAGE_KBPS_THRESHOLDS = { streaming: 2000, web: 500, messages: 100 } as const;

/** Traduit un débit descendant (kbps, ou null si non mesuré) en usage concret. */
export function usageFromKbps(kbps: number | null): UsageInfo {
	if (kbps == null) return USAGE_INFO.rien;
	if (kbps >= USAGE_KBPS_THRESHOLDS.streaming) return USAGE_INFO.streaming;
	if (kbps >= USAGE_KBPS_THRESHOLDS.web) return USAGE_INFO.web;
	if (kbps >= USAGE_KBPS_THRESHOLDS.messages) return USAGE_INFO.messages;
	return USAGE_INFO.rien;
}
