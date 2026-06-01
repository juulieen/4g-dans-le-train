/**
 * Niveaux d'usage ARCEP et leur représentation — source unique partagée par la
 * carte (`Map.svelte`) et la frise « profil de trajet » (`RouteProfile.svelte`).
 *
 * Convention produit (cf. docs/PRODUCT.md) : on classe par USAGE concret (« ce
 * qu'on peut faire »), pas par jargon technique. Quatre niveaux, du meilleur au
 * pire : TBC > BC > CL > none (zone blanche).
 *
 * Les couleurs existent en deux formes : `USAGE_COLORS` (hex, pour les
 * expressions MapLibre / le rendu inline) et les variables CSS `--usage-*`
 * (thématisées clair/sombre, définies dans `+layout.svelte`) — à préférer en CSS.
 */

export type Level = 'TBC' | 'BC' | 'CL' | 'none';

/** Tous les opérateurs mobiles suivis dans les données ARCEP. */
export const USAGE_OPS = ['orange', 'sfr', 'free', 'bouygues'] as const;
export type UsageOp = (typeof USAGE_OPS)[number];

/** Couleurs par niveau (hex). En CSS, préférer `var(--usage-*)` (thématisées). */
export const USAGE_COLORS: Record<Level, string> = {
	TBC: '#22c55e', // vert — streaming vidéo / visio
	BC: '#84cc16', // vert-clair — web, réseaux sociaux
	CL: '#f59e0b', // orange — messages, navigation lente
	none: '#ef4444' // rouge — zone blanche
};

/** Variable CSS thématisée correspondante (clair/sombre via `+layout.svelte`). */
export const USAGE_CSS_VAR: Record<Level, string> = {
	TBC: 'var(--usage-tbc)',
	BC: 'var(--usage-bc)',
	CL: 'var(--usage-cl)',
	none: 'var(--usage-none)'
};

/** Rang ordinal (3 = meilleur) — pour comparer / calculer le « meilleur » niveau. */
export const USAGE_RANK: Record<Level, number> = { TBC: 3, BC: 2, CL: 1, none: 0 };

/** Libellé d'usage concret, sans emoji. */
export const USAGE_TEXT: Record<Level, string> = {
	TBC: 'Streaming vidéo, visio',
	BC: 'Web, réseaux sociaux',
	CL: 'Messages, navigation lente',
	none: 'Zone blanche — pas de réseau'
};

/** Libellé court pour les légendes. */
export const USAGE_SHORT: Record<Level, string> = {
	TBC: 'Streaming vidéo',
	BC: 'Web & réseaux sociaux',
	CL: 'Messages seulement',
	none: 'Rien (zone blanche)'
};

/** Pastille emoji par niveau (badges, popups). */
export const USAGE_EMOJI: Record<Level, string> = { TBC: '🟢', BC: '🟡', CL: '🟠', none: '🔴' };

/** Normalise une valeur quelconque en niveau connu (défaut : zone blanche). */
export function toLevel(v: unknown): Level {
	return v === 'TBC' || v === 'BC' || v === 'CL' ? v : 'none';
}

/** Niveau d'usage emoji + texte (libellé des popups / résumés). */
export function usageLabel(lvl: string | null | undefined): string {
	const l = toLevel(lvl);
	return `${USAGE_EMOJI[l]} ${USAGE_TEXT[l]}`;
}

/** Meilleur niveau parmi des niveaux par opérateur (équivalent du champ `best` ARCEP). */
export function bestLevel(levels: Partial<Record<UsageOp, Level>>): Level {
	let best: Level = 'none';
	for (const op of USAGE_OPS) {
		const l = levels[op];
		if (l && USAGE_RANK[l] > USAGE_RANK[best]) best = l;
	}
	return best;
}

/**
 * Seuils de débit descendant mesuré (kbps) → niveau ARCEP. On classe le RÉEL sur
 * la MÊME échelle que la couverture théorique ARCEP (TBC/BC/CL/none) : la carte et
 * le mode mesure parlent ainsi le même langage, et l'écart théorie/réel — le cœur
 * du projet — se lit au même code couleur. Seuils exigeants (visio/HD confortable) :
 * - ≥ 4000 kbps → TBC (streaming vidéo, visio)
 * - ≥ 1000 kbps → BC (web, réseaux sociaux)
 * - ≥ 200 kbps → CL (messages, navigation lente)
 * - < 200 ou inconnu → none
 */
export const KBPS_THRESHOLDS: Record<Exclude<Level, 'none'>, number> = {
	TBC: 4000,
	BC: 1000,
	CL: 200
};

/** Traduit un débit descendant mesuré (kbps, ou null si non mesuré) en niveau ARCEP. */
export function levelFromKbps(kbps: number | null): Level {
	if (kbps == null) return 'none';
	if (kbps >= KBPS_THRESHOLDS.TBC) return 'TBC';
	if (kbps >= KBPS_THRESHOLDS.BC) return 'BC';
	if (kbps >= KBPS_THRESHOLDS.CL) return 'CL';
	return 'none';
}
