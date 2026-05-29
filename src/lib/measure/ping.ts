/**
 * Mesure de connectivité par ping actif.
 *
 * Méthode volontairement cross-navigateur (iOS/Safari/Firefox inclus) : on fait
 * une petite requête réseau et on observe succès/échec + latence. C'est la seule
 * façon fiable de mesurer « ça capte ou pas » depuis un navigateur — l'API
 * Network Information n'est pas supportée partout (voir netinfo.ts).
 */

export type PingStatus = 'ok' | 'degraded' | 'none';

export interface PingResult {
	status: PingStatus;
	rttMs: number | null;
}

const TIMEOUT_MS = 5000;
/** Au-delà de ce RTT, la connexion est jugée dégradée (mais présente). */
const DEGRADED_RTT_MS = 1500;

/**
 * Effectue un ping vers l'endpoint léger /api/ping et en déduit l'état réseau.
 * @param endpoint chemin testé (par défaut l'endpoint maison /api/ping)
 */
export async function ping(endpoint = '/api/ping'): Promise<PingResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const start = performance.now();
	try {
		// cache-buster pour éviter toute réponse servie hors-ligne par le SW.
		const url = `${endpoint}?t=${start.toFixed(0)}`;
		const res = await fetch(url, {
			method: 'HEAD',
			cache: 'no-store',
			signal: controller.signal
		});
		const rttMs = Math.round(performance.now() - start);
		if (!res.ok) return { status: 'none', rttMs: null };
		return { status: rttMs > DEGRADED_RTT_MS ? 'degraded' : 'ok', rttMs };
	} catch {
		return { status: 'none', rttMs: null };
	} finally {
		clearTimeout(timer);
	}
}
