/**
 * Construction des SEGMENTS « réel » le long d'un tracé ferroviaire à partir des
 * cellules H3 mesurées d'une ligne. Logique PURE (sans DB ni I/O) → testable et
 * réutilisée par l'endpoint `/api/coverage/segments`.
 *
 * Pipeline : projeter chaque cellule sur la polyligne du profil (`projectOntoPath`),
 * écarter celles trop loin du tracé, trier par abscisse curviligne, classer en 3
 * niveaux d'usage (`rateToLevel`), fusionner les cellules consécutives de même niveau
 * (run-length, en coupant sur un trou > `MAX_GAP_KM`), puis reconstruire la géométrie
 * LineString le long du tracé.
 *
 * LIMITE CONNUE (lignes repliées) : `projectOntoPath` retient l'abscisse de plus
 * petit écart, sans contrainte de continuité. Sur une ligne qui repasse deux fois au
 * même endroit (aller-retour, ex. `paris-annecy`, troncs communs), une cellule peut se
 * projeter sur la mauvaise branche → un segment qui « saute ». Même limite que
 * `RouteProfile.distOf`. Impact faible au volume actuel ; un placement par continuité
 * serait nécessaire pour la lever.
 */
import { rateToLevel, type Level } from './usage';
import { projectOntoPath, positionAtDist, type PathPoint } from './geo/interpolate';

/** Un segment ARCEP du profil de trajet (run-length le long du tracé). */
export interface ArcepProfileSegment {
	fromKm: number;
	toKm: number;
	orange: Level;
	sfr: Level;
	free: Level;
	bouygues: Level;
	best: Level;
}

/**
 * Boîte englobante d'un tracé : `[[minLng,minLat],[maxLng,maxLat]]` (compatible
 * `maplibregl.LngLatBoundsLike`). Pure, sans dépendance carto — partagée par l'aperçu de
 * ligne et le deep-link de la carte pour caler le `fitBounds`.
 */
export function pathBounds(path: PathPoint[]): [[number, number], [number, number]] {
	if (!path.length)
		return [
			[0, 0],
			[0, 0]
		];
	let minLng = Infinity,
		minLat = Infinity,
		maxLng = -Infinity,
		maxLat = -Infinity;
	for (const [lng, lat] of path) {
		if (lng < minLng) minLng = lng;
		if (lng > maxLng) maxLng = lng;
		if (lat < minLat) minLat = lat;
		if (lat > maxLat) maxLat = lat;
	}
	return [
		[minLng, minLat],
		[maxLng, maxLat]
	];
}

/**
 * Construit la géométrie ARCEP « ligne seule » d'un trajet, à partir de son profil
 * (`path` + segments `arcep`), sous forme de Features LineString portant les niveaux par
 * opérateur (`orange/sfr/free/bouygues/best`).
 *
 * POURQUOI : permet d'INJECTER la couche ARCEP d'UNE ligne dans la carte (aperçu sur les
 * pages `/ligne`) au lieu de charger `arcep-lines.geojson` (national, 4,6 Mo). Les props
 * sont identiques à ce gros fichier → l'expression de couleur de `Map.svelte` (`arcepColor`)
 * les colore sans changement. Retourne `[]` si le tracé a moins de 2 points.
 */
export function buildArcepLineFeatures(
	path: PathPoint[],
	arcep: ArcepProfileSegment[]
): GeoJSON.Feature[] {
	if (path.length < 2) return [];
	const features: GeoJSON.Feature[] = [];
	for (const s of arcep) {
		const coordinates = segmentCoords(path, s.fromKm, s.toKm);
		if (coordinates.length < 2) continue; // segment dégénéré (bord de tracé) : on saute
		features.push({
			type: 'Feature',
			geometry: { type: 'LineString', coordinates },
			properties: {
				orange: s.orange,
				sfr: s.sfr,
				free: s.free,
				bouygues: s.bouygues,
				best: s.best
			}
		});
	}
	return features;
}

/** Au-delà de cette distance au tracé, une cellule n'est pas « sur cette ligne ». */
export const MAX_OFFSET_M = 600;
/** Trou de mesure au-delà duquel on coupe le ruban (km) plutôt que relier dans le vide. */
export const MAX_GAP_KM = 3;
/** Demi-extension d'un segment (km) : ~taille d'une cellule, pour qu'une cellule isolée reste visible. */
export const PAD_KM = 0.09;

/** Cellule mesurée prête à être placée sur le tracé. */
export interface SegmentCell {
	/** Taux de réussite (0..1) — déjà agrégé « pire opérateur » le cas échéant. */
	rate: number;
	samples: number;
	operator: string;
	lat: number;
	lng: number;
}

interface ProjectedCell {
	distKm: number;
	level: Level;
	rate: number;
	samples: number;
	operator: string;
}

/**
 * Coordonnées [lng, lat] d'un segment le long du tracé, épousant les courbes du rail.
 * Dédoublonne les points consécutifs identiques : aux extrémités du tracé, le PAD est
 * clampé par `positionAtDist` et peut coïncider avec un point intermédiaire → on évite
 * une LineString dégénérée (points à longueur nulle).
 */
export function segmentCoords(path: PathPoint[], fromKm: number, toKm: number): [number, number][] {
	const a = positionAtDist(path, fromKm);
	const raw: [number, number][] = [[a.lng, a.lat]];
	for (const [lng, lat, d] of path) {
		if (d > fromKm && d < toKm) raw.push([lng, lat]);
	}
	const b = positionAtDist(path, toKm);
	raw.push([b.lng, b.lat]);

	const coords: [number, number][] = [];
	for (const c of raw) {
		const prev = coords[coords.length - 1];
		if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) coords.push(c);
	}
	return coords;
}

/**
 * Transforme les cellules mesurées d'une ligne en Features LineString colorées par
 * niveau (`quality`). Retourne `[]` si le tracé a moins de 2 points ou si aucune
 * cellule n'est sur la ligne.
 */
export function buildLineSegments(
	path: PathPoint[],
	cells: SegmentCell[],
	lineSlug: string
): GeoJSON.Feature[] {
	if (path.length < 2) return []; // un seul point : pas de tracé à suivre

	// Projeter sur le tracé, écarter les cellules hors ligne.
	const projected: ProjectedCell[] = [];
	for (const c of cells) {
		const proj = projectOntoPath(path, c.lat, c.lng);
		if (proj.offsetM > MAX_OFFSET_M) continue;
		projected.push({
			distKm: proj.distKm,
			level: rateToLevel(c.rate),
			rate: c.rate,
			samples: c.samples,
			operator: c.operator
		});
	}
	if (projected.length === 0) return [];
	projected.sort((a, b) => a.distKm - b.distKm);

	// Fusion run-length : cellules consécutives de même niveau et assez proches.
	const features: GeoJSON.Feature[] = [];
	let seg: {
		level: Level;
		fromKm: number;
		toKm: number;
		lastKm: number;
		samples: number;
		worstRate: number;
		worstOp: string;
	} | null = null;
	const flush = () => {
		if (!seg) return;
		features.push({
			type: 'Feature',
			geometry: {
				type: 'LineString',
				coordinates: segmentCoords(path, seg.fromKm - PAD_KM, seg.toKm + PAD_KM)
			},
			properties: {
				quality: seg.level,
				worstRate: seg.worstRate,
				samples: seg.samples,
				operator: seg.worstOp,
				lineSlug,
				fromKm: Math.round(seg.fromKm * 10) / 10,
				toKm: Math.round(seg.toKm * 10) / 10
			}
		});
	};
	for (const p of projected) {
		if (seg && p.level === seg.level && p.distKm - seg.lastKm <= MAX_GAP_KM) {
			seg.toKm = p.distKm;
			seg.lastKm = p.distKm;
			seg.samples += p.samples;
			if (p.rate < seg.worstRate) {
				seg.worstRate = p.rate;
				seg.worstOp = p.operator;
			}
		} else {
			flush();
			seg = {
				level: p.level,
				fromKm: p.distKm,
				toKm: p.distKm,
				lastKm: p.distKm,
				samples: p.samples,
				worstRate: p.rate,
				worstOp: p.operator
			};
		}
	}
	flush();
	return features;
}
