/**
 * Lecture défensive de la Network Information API.
 *
 * ⚠️ Non standard : absente sur Safari/iOS et Firefox, désactivée par Brave.
 * On l'utilise uniquement comme BONUS (type de réseau 4g/3g…) quand elle existe —
 * jamais comme source unique. La mesure réelle vient du ping actif (ping.ts).
 */
export function readNetworkType(): string | null {
	if (typeof navigator === 'undefined') return null;
	const c = navigator.connection;
	return c?.effectiveType ?? null;
}
