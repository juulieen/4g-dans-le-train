/**
 * Mesure de connectivité par ping actif.
 *
 * Méthode volontairement cross-navigateur (iOS/Safari/Firefox inclus) : on fait
 * une petite requête réseau et on observe succès/échec + latence. C'est la seule
 * façon fiable de mesurer « ça capte ou pas » depuis un navigateur — l'API
 * Network Information n'est pas supportée partout (voir netinfo.ts).
 *
 * Deux niveaux d'API :
 * - `pingBurst()` : une petite rafale de HEAD → gigue + perte + RTT médian, puis
 *   un verdict consolidé. C'est ce que le mode mesure utilise (robuste au bruit).
 * - `ping()` : un HEAD unique, conservé pour rétro-compat (verdict sur un seul RTT).
 */

import { computeBurstStats, verdictFromBurst, type BurstStats, type PingStatus } from './stats';

export type { PingStatus };

export interface PingResult {
	status: PingStatus;
	rttMs: number | null;
}

/** Résultat d'une rafale : les stats + le verdict consolidé. */
export interface BurstResult extends BurstStats {
	status: PingStatus;
}

const TIMEOUT_MS = 5000;
/** Au-delà de ce RTT, la connexion est jugée dégradée (mais présente). */
const DEGRADED_RTT_MS = 1500;
/** Nombre de pings par rafale (compromis robustesse / coût data). */
const BURST_COUNT = 4;
/** Espacement entre pings d'une rafale (ms) — laisse passer une vraie gigue. */
const BURST_SPACING_MS = 150;

/**
 * Effectue UN HEAD vers l'endpoint et renvoie le RTT en ms, ou `null` si échec
 * (timeout, réseau mort, statut non-ok). Brique bas niveau partagée par `ping`
 * et `pingBurst`.
 */
async function pingOnce(endpoint: string): Promise<number | null> {
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
		if (!res.ok) return null;
		return Math.round(performance.now() - start);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Effectue un ping unique vers l'endpoint léger /api/ping et en déduit l'état
 * réseau. Conservé pour rétro-compat (signature/comportement inchangés).
 * @param endpoint chemin testé (par défaut l'endpoint maison /api/ping)
 */
export async function ping(endpoint = '/api/ping'): Promise<PingResult> {
	const rttMs = await pingOnce(endpoint);
	if (rttMs == null) return { status: 'none', rttMs: null };
	return { status: rttMs > DEGRADED_RTT_MS ? 'degraded' : 'ok', rttMs };
}

/**
 * Effectue une rafale de `count` pings rapprochés et en tire des stats riches
 * (gigue, perte, RTT médian) + un verdict consolidé robuste au bruit.
 * Séquentiel (pas parallèle) avec un petit espacement pour mesurer une vraie
 * gigue et ne pas saturer le lien.
 */
export async function pingBurst(
	endpoint = '/api/ping',
	count = BURST_COUNT,
	spacingMs = BURST_SPACING_MS
): Promise<BurstResult> {
	const rtts: Array<number | null> = [];
	for (let i = 0; i < count; i++) {
		rtts.push(await pingOnce(endpoint));
		if (i < count - 1) await sleep(spacingMs);
	}
	const stats = computeBurstStats(rtts);
	return { ...stats, status: verdictFromBurst(stats) };
}
