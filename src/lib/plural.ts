/**
 * Suffixe de pluriel français (« s ») pour les accords simples : `point${pluralS(n)}`,
 * `enregistré${pluralS(n)}`. En français, le singulier couvre 0 et 1 (« 0 point »,
 * « 1 point »), d'où le seuil `> 1`.
 */
export const pluralS = (n: number): string => (n > 1 ? 's' : '');
