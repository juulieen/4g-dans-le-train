/**
 * Distance géodésique entre deux positions (formule de haversine).
 *
 * Util bas niveau partagé : sert à mesurer la longueur parcourue pendant une
 * coupure réseau (src/lib/measure/outage.ts) et, à terme, le profil de trajet.
 */

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Distance en mètres entre (aLat, aLng) et (bLat, bLng). */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
	const dLat = toRad(bLat - aLat);
	const dLng = toRad(bLng - aLng);
	const lat1 = toRad(aLat);
	const lat2 = toRad(bLat);

	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
