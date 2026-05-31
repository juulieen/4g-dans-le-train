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

/**
 * Bornes de taille pour rester économe en data mobile (64 Ko – 512 Ko). Le
 * bornage est aussi la garde anti-abus : pas de rate-limit par IP ici, car ce
 * serait la seule donnée ré-identifiante du projet (vie privée non négociable) ;
 * on borne plutôt le coût unitaire (bande passante).
 */
const MIN_SIZE = 64 * 1024;
const MAX_SIZE = 512 * 1024;
const DEFAULT_SIZE = 128 * 1024;
/** crypto.getRandomValues impose ≤ 65536 octets par appel. */
const CHUNK = 65536;

/**
 * Pool aléatoire pré-généré UNE fois au chargement du module : on en renvoie une
 * vue tronquée par requête. Évite le coût CPU `getRandomValues` + l'allocation à
 * chaque appel (l'endpoint est public, autant qu'un appel reste bon marché).
 * Aléatoire ⇒ incompressible, donc le débit mesuré reste un vrai débit.
 */
const POOL = new Uint8Array(MAX_SIZE);
for (let off = 0; off < MAX_SIZE; off += CHUNK) {
	crypto.getRandomValues(POOL.subarray(off, Math.min(off + CHUNK, MAX_SIZE)));
}

export const GET: RequestHandler = ({ url }) => {
	const requested = Number(url.searchParams.get('size'));
	const size = Number.isFinite(requested)
		? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.floor(requested)))
		: DEFAULT_SIZE;

	// Pas d'en-tête CORS : l'app appelle /api/probe en same-origin. Ne pas exposer
	// `access-control-allow-origin: *` évite que des sites tiers s'en servent
	// comme cible de test de débit (abus de bande passante).
	return new Response(POOL.subarray(0, size), {
		status: 200,
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(size),
			'cache-control': 'no-store, no-cache, must-revalidate'
		}
	});
};
