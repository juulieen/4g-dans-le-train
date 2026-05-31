import type { RequestHandler } from './$types';

/**
 * Cible du test de débit descendant (src/lib/measure/throughput.ts).
 *
 * Renvoie un blob de `size` octets de données ALÉATOIRES (donc incompressibles :
 * ni gzip ni brotli ne les réduisent → on mesure un vrai débit, pas l'efficacité
 * d'un compresseur). Non mis en cache.
 *
 * Vie privée : l'endpoint ne reçoit que `size` (aucune donnée client), ne logge
 * rien et ne peut donc pas servir à fingerprinter.
 */

/** Bornes de taille pour rester économe en data mobile (64 Ko – 512 Ko). */
const MIN_SIZE = 64 * 1024;
const MAX_SIZE = 512 * 1024;
const DEFAULT_SIZE = 128 * 1024;
/** crypto.getRandomValues impose ≤ 65536 octets par appel. */
const CHUNK = 65536;

export const GET: RequestHandler = ({ url }) => {
	const requested = Number(url.searchParams.get('size'));
	const size = Number.isFinite(requested)
		? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.floor(requested)))
		: DEFAULT_SIZE;

	const bytes = new Uint8Array(size);
	for (let off = 0; off < size; off += CHUNK) {
		crypto.getRandomValues(bytes.subarray(off, Math.min(off + CHUNK, size)));
	}

	return new Response(bytes, {
		status: 200,
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(size),
			'cache-control': 'no-store, no-cache, must-revalidate',
			'access-control-allow-origin': '*'
		}
	});
};
