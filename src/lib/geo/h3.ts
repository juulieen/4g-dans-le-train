import { latLngToCell, cellToLatLng } from 'h3-js';

/**
 * Résolution H3 utilisée pour agréger les mesures.
 * Résolution 9 ≈ arête de ~174 m → bon compromis vie privée / granularité le long
 * d'une voie ferrée. Voir https://h3geo.org/docs/core-library/restable
 */
export const H3_RESOLUTION = 9;

/** Convertit une position GPS en index de cellule H3. */
export function toCell(lat: number, lng: number, resolution = H3_RESOLUTION): string {
	return latLngToCell(lat, lng, resolution);
}

/** Centre (lat, lng) d'une cellule — utilisé pour anonymiser et pour le rendu. */
export function cellCenter(cellId: string): { lat: number; lng: number } {
	const [lat, lng] = cellToLatLng(cellId);
	return { lat, lng };
}

/**
 * Arrondit une position au centre de sa cellule H3.
 * C'est l'opération d'anonymisation appliquée AVANT tout stockage.
 */
export function snapToCell(
	lat: number,
	lng: number,
	resolution = H3_RESOLUTION
): { cellId: string; lat: number; lng: number } {
	const cellId = toCell(lat, lng, resolution);
	return { cellId, ...cellCenter(cellId) };
}
