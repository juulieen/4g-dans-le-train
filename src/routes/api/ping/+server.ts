import type { RequestHandler } from './$types';

/**
 * Endpoint ultra-léger servant de cible au ping actif (src/lib/measure/ping.ts).
 * Répond 204 sans corps ; non mis en cache pour mesurer le vrai RTT réseau.
 */
const headers = {
	'cache-control': 'no-store, no-cache, must-revalidate',
	'access-control-allow-origin': '*'
};

export const HEAD: RequestHandler = () => new Response(null, { status: 204, headers });
export const GET: RequestHandler = () => new Response(null, { status: 204, headers });
