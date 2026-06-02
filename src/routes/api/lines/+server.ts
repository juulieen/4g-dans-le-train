import { json, error } from '@sveltejs/kit';
import { gridDisk } from 'h3-js';
import { toCell } from '$geo/h3';
import { lineSlugsForCell } from '$geo/line-snap';
import { findLine } from '$geo/lines';
import type { RequestHandler } from './$types';

/**
 * Lignes commerciales passant par une position cliquée sur la carte.
 *
 * Reçoit `?lat=&lng=` (un clic sur une voie), convertit la position en cellule
 * H3 (rés. 9, comme l'ingestion) et renvoie les lignes du référentiel qui la
 * traversent, ordonnées de la plus spécifique à la plus générale.
 *
 * Robustesse : un clic atterrit rarement pile sur le centre de cellule
 * échantillonné dans `line-index.json`. On élargit donc anneau par anneau
 * (gridDisk k=0, puis 1, puis 2) jusqu'à trouver une cellule rattachée à une
 * ligne — les lignes de la cellule la plus proche restent en tête.
 *
 * Réponse : `{ lines: [{ slug, name, service }] }` — chaque entrée alimente un
 * lien vers `/ligne/{slug}` dans la popup de la carte.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const lat = Number(url.searchParams.get('lat'));
	const lng = Number(url.searchParams.get('lng'));
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		throw error(400, 'Paramètres lat/lng invalides');
	}

	const center = toCell(lat, lng);

	// On élargit la recherche anneau par anneau et on accumule les slugs en
	// préservant l'ordre (cellule centrale d'abord, puis voisines). On s'arrête
	// dès qu'un anneau apporte au moins une ligne.
	const slugs: string[] = [];
	const seen = new Set<string>();
	const cellsSeen = new Set<string>();
	for (let k = 0; k <= 2 && slugs.length === 0; k++) {
		// gridDisk(k) inclut les anneaux 0..k ; on saute les cellules déjà traitées.
		const ring = k === 0 ? [center] : gridDisk(center, k).filter((c) => !cellsSeen.has(c));
		for (const cell of ring) {
			cellsSeen.add(cell);
			for (const slug of lineSlugsForCell(cell)) {
				if (!seen.has(slug)) {
					seen.add(slug);
					slugs.push(slug);
				}
			}
		}
	}

	const lines = slugs
		.map((slug) => {
			const l = findLine(slug);
			return l ? { slug: l.slug, name: l.name, service: l.service } : null;
		})
		.filter((l): l is { slug: string; name: string; service: string } => l !== null);

	// Données statiques (dérivées du référentiel committé) : cache long côté CDN.
	setHeaders({ 'cache-control': 'public, max-age=3600' });
	return json({ lines });
};
