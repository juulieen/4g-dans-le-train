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

/**
 * Type de support de la connexion ('wifi', 'cellular'…) quand l'API l'expose.
 * Renseigné surtout sur Chrome Android ; ABSENT sur iOS/Safari et Firefox
 * (retourne alors null → on ne peut pas conclure, voir le rappel statique côté UI).
 */
export function readConnectionType(): string | null {
	if (typeof navigator === 'undefined') return null;
	return navigator.connection?.type ?? null;
}

/**
 * Le téléphone est-il (de façon détectable) sur du wifi — typiquement le wifi de
 * bord du train ? `false` quand l'info est indisponible : on n'avertit alors que
 * via le rappel statique, jamais à tort.
 */
export function isOnWifi(): boolean {
	return readConnectionType() === 'wifi';
}
