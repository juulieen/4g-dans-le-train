/**
 * Chargement serveur d'un « profil de trajet » (`static/data/route-profiles/<slug>.json`)
 * pour en exploiter la polyligne ordonnée `path` ([lng, lat, distKm]).
 *
 * On passe par le `fetch` de SvelteKit (sert l'asset statique) plutôt que par le
 * système de fichiers : robuste en dev comme en prod (adapter-node), sans dépendre du
 * chemin d'installation. Les profils sont IMMUABLES (régénérés au build) → on les
 * mémoïse pour la vie du process : la génération de segments à la volée ne relit donc
 * jamais deux fois le même profil.
 */
import type { PathPoint } from '$geo/interpolate';

/** Sous-ensemble du profil utile à la génération de segments. */
export interface RouteProfileGeometry {
	slug: string;
	lengthKm: number;
	path: PathPoint[];
}

type Fetch = typeof fetch;

// Mémo process : slug → profil (ou null si introuvable, mémoïsé aussi pour ne pas
// re-fetcher en boucle un slug sans fichier).
const cache = new Map<string, RouteProfileGeometry | null>();

/** Charge (et mémoïse) la géométrie du profil pour un slug, ou `null` si absent. */
export async function loadRouteProfile(
	fetchFn: Fetch,
	slug: string
): Promise<RouteProfileGeometry | null> {
	const cached = cache.get(slug);
	if (cached !== undefined) return cached;

	let result: RouteProfileGeometry | null = null;
	try {
		const res = await fetchFn(`/data/route-profiles/${slug}.json`);
		if (res.ok) {
			const data = (await res.json()) as RouteProfileGeometry;
			if (Array.isArray(data?.path) && data.path.length > 0) result = data;
		}
	} catch {
		/* asset absent / illisible : on mémoïse null */
	}
	cache.set(slug, result);
	return result;
}
