/**
 * Interpolation d'une position le long d'un tracé ferroviaire.
 *
 * POURQUOI : pendant un trou GPS (tunnel, tranchée), on continue à mesurer la
 * connectivité mais sans position. Si l'utilisateur revient ensuite « sur les
 * rails » de la même ligne, on sait qu'il n'a pas quitté le train : on peut alors
 * reconstruire la position de chaque ping perdu en l'interpolant le long du tracé
 * entre le dernier point GPS connu avant le trou et le premier après.
 *
 * Module PUR (client + serveur), sur le modèle de `distance.ts`. Travaille sur le
 * `path` des profils de trajet (`static/data/route-profiles/<slug>.json`) :
 * une polyligne `[lng, lat, distKm]` où `distKm` est l'abscisse curviligne cumulée.
 */
import { distanceM } from './distance';

/** Point du tracé : `[lng, lat, distKm]` (format des profils de trajet). */
export type PathPoint = [number, number, number];

/** Résultat d'une projection d'un point sur le tracé. */
export interface Projection {
	/** Abscisse curviligne (km depuis l'origine du tracé) du point projeté. */
	distKm: number;
	/** Distance perpendiculaire (m) entre le point et le tracé — « suis-je sur les rails ? ». */
	offsetM: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Projette une position (lat, lng) sur la polyligne et renvoie son abscisse
 * curviligne (`distKm`) ainsi que sa distance au tracé (`offsetM`).
 *
 * On travaille dans un plan local (équirectangulaire, lng pondéré par cos(lat))
 * pour trouver le pied de la perpendiculaire sur chaque segment, puis on mesure le
 * vrai écart en mètres avec `distanceM` (haversine).
 */
export function projectOntoPath(path: PathPoint[], lat: number, lng: number): Projection {
	let best: Projection = { distKm: 0, offsetM: Infinity };
	if (path.length === 0) return best;
	if (path.length === 1) {
		return { distKm: path[0][2], offsetM: distanceM(lat, lng, path[0][1], path[0][0]) };
	}

	for (let i = 1; i < path.length; i++) {
		const [lng0, lat0, d0] = path[i - 1];
		const [lng1, lat1, d1] = path[i];
		// Facteur de compression des longitudes à la latitude du segment.
		const cosLat = Math.cos(toRad((lat0 + lat1) / 2));
		// Vecteur segment et vecteur point→origine du segment, en plan local.
		const bx = (lng1 - lng0) * cosLat;
		const by = lat1 - lat0;
		const lenSq = bx * bx + by * by;
		// Paramètre du pied de la perpendiculaire, clampé sur [0, 1] (segment fini).
		let t = 0;
		if (lenSq > 0) {
			const ax = (lng - lng0) * cosLat;
			const ay = lat - lat0;
			t = Math.max(0, Math.min(1, (ax * bx + ay * by) / lenSq));
		}
		const projLng = lng0 + t * (lng1 - lng0);
		const projLat = lat0 + t * (lat1 - lat0);
		const offsetM = distanceM(lat, lng, projLat, projLng);
		if (offsetM < best.offsetM) {
			best = { distKm: d0 + t * (d1 - d0), offsetM };
		}
	}
	return best;
}

/** Point GPS d'ancrage daté (entrée ou sortie d'un trou GPS). */
export interface Anchor {
	lat: number;
	lng: number;
	/** Instant du fix (époch ms). */
	t: number;
}

/** Options de reconstruction (garde-fous). */
export interface ReconstructOptions {
	/** Écart de temps max entre les deux ancres ET portée max de reconstruction (ms). */
	maxSpanMs: number;
	/** Distance max (m) d'une ancre au tracé pour la juger « sur les rails ». */
	snapMaxM: number;
}

/**
 * Reconstruit la position d'instants donnés le long du tracé, à partir de deux points
 * GPS d'ancrage. On projette les ancres sur le tracé, on en déduit un taux signé
 * (km/ms = sens du trajet), puis pour chaque instant `t` :
 *   `distKm = distKm(entry) + taux × (t − t(entry))`.
 *
 * Couvre les deux usages avec la même formule :
 *   - INTERPOLATION (tunnel) : `t` entre les deux ancres → `dt ∈ [0, span]` ;
 *   - EXTRAPOLATION (cold-start) : `t` antérieur à l'entrée → `dt < 0`.
 *
 * Renvoie `null` si les garde-fous ne tiennent pas (tracé vide, ancres trop espacées
 * dans le temps, ou une ancre trop loin du tracé). Sinon un tableau aligné sur `times` :
 * chaque élément est la position reconstruite, ou `null` si l'instant est à plus de
 * `maxSpanMs` de l'entrée (reconstruction jugée trop lointaine).
 */
export function reconstructAlongPath(
	path: PathPoint[],
	entry: Anchor,
	exit: Anchor,
	times: number[],
	opts: ReconstructOptions
): Array<{ lat: number; lng: number } | null> | null {
	if (path.length === 0) return null;
	const span = exit.t - entry.t;
	if (span <= 0 || span > opts.maxSpanMs) return null;

	const a = projectOntoPath(path, entry.lat, entry.lng);
	const b = projectOntoPath(path, exit.lat, exit.lng);
	if (a.offsetM > opts.snapMaxM || b.offsetM > opts.snapMaxM) return null;

	const ratePerMs = (b.distKm - a.distKm) / span;
	return times.map((t) => {
		const dt = t - entry.t;
		if (Math.abs(dt) > opts.maxSpanMs) return null; // reconstruction trop lointaine
		return positionAtDist(path, a.distKm + ratePerMs * dt);
	});
}

/**
 * Position (lat, lng) à une abscisse curviligne donnée sur le tracé.
 * Interpolation linéaire inverse ; `distKm` hors plage est clampé aux extrémités.
 */
export function positionAtDist(path: PathPoint[], distKm: number): { lat: number; lng: number } {
	if (path.length === 0) throw new Error('positionAtDist: tracé vide');
	const first = path[0];
	const last = path[path.length - 1];
	if (distKm <= first[2]) return { lat: first[1], lng: first[0] };
	if (distKm >= last[2]) return { lat: last[1], lng: last[0] };

	for (let i = 1; i < path.length; i++) {
		const [lng0, lat0, d0] = path[i - 1];
		const [lng1, lat1, d1] = path[i];
		if (distKm <= d1) {
			// Segment englobant : interpolation par fraction d'abscisse.
			const span = d1 - d0;
			const f = span > 0 ? (distKm - d0) / span : 0;
			return { lat: lat0 + f * (lat1 - lat0), lng: lng0 + f * (lng1 - lng0) };
		}
	}
	// Inatteignable (clamp ci-dessus), mais garde le typeur tranquille.
	return { lat: last[1], lng: last[0] };
}
