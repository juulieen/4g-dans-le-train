/**
 * Mesure de débit descendant léger.
 *
 * POURQUOI : « ça répond au ping » ≠ « ça streame ». Un 4G saturé en gare répond
 * au HEAD mais ne charge pas une vidéo. On télécharge donc un petit blob de taille
 * connue et on en déduit un débit (kbps), proxy de l'usage réellement possible.
 *
 * COÛT DATA : cette mesure consomme la data mobile de l'utilisateur → elle est
 * opt-in, cadencée (1 position sur N) et bornée en taille côté serveur. Le module
 * lui-même reste cross-navigateur (uniquement `fetch` + `performance.now()`).
 */

/** Convertit un volume téléchargé en débit (kbps). Pur → testable sans réseau. */
export function kbpsFrom(bytes: number, ms: number): number {
	if (ms <= 0) return 0;
	return Math.round((bytes * 8) / ms);
}

export interface ThroughputResult {
	/** Débit descendant estimé en kbps. null si échec/timeout. */
	downlinkKbps: number | null;
	/** Octets effectivement reçus. */
	bytes: number;
	/** Durée du téléchargement en ms. */
	ms: number;
}

/** Taille de blob par défaut (128 Ko) — compromis précision / coût data. */
const DEFAULT_SIZE = 128 * 1024;
const TIMEOUT_MS = 8000;

/**
 * Télécharge un blob de `size` octets depuis l'endpoint /api/probe et mesure le
 * débit descendant. Sur échec/timeout, renvoie `downlinkKbps: null`.
 */
export async function measureDownlink(
	endpoint = '/api/probe',
	size = DEFAULT_SIZE,
	timeoutMs = TIMEOUT_MS
): Promise<ThroughputResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const start = performance.now();
	try {
		const url = `${endpoint}?size=${size}&t=${start.toFixed(0)}`;
		const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
		if (!res.ok) return { downlinkKbps: null, bytes: 0, ms: 0 };
		const buf = await res.arrayBuffer();
		const ms = performance.now() - start;
		const bytes = buf.byteLength;
		return { downlinkKbps: kbpsFrom(bytes, ms), bytes, ms: Math.round(ms) };
	} catch {
		// Timeout/abort/erreur → `null` (et non un débit partiel) : un téléchargement
		// qui n'aboutit pas ne donne pas une mesure de débit fiable, mieux vaut « non
		// mesuré » qu'une valeur trompeuse.
		return { downlinkKbps: null, bytes: 0, ms: 0 };
	} finally {
		clearTimeout(timer);
	}
}
