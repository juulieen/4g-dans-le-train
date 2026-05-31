import { json } from '@sveltejs/kit';
import { aggregateOutages } from '$lib/server/outages';
import type { RequestHandler } from './$types';

/**
 * Coupures réseau agrégées au format GeoJSON (FeatureCollection de points, un par
 * cellule de début de coupure), prêt pour MapLibre et la vue « profil de trajet ».
 * Filtrable par ?operator= et ?line=.
 *
 * Vie privée : ne renvoie QUE des agrégats (médiane par cellule). Jamais les
 * points bruts ni les séquences par session — elles restent côté serveur.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const operator = url.searchParams.get('operator');
	const line = url.searchParams.get('line');

	const aggregates = await aggregateOutages({ operator, lineSlug: line });

	const features = aggregates.map((a) => ({
		type: 'Feature' as const,
		geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
		properties: {
			cellStart: a.cellStart,
			operator: a.operator,
			lineSlug: a.lineSlug,
			count: a.count,
			medianDurationS: a.medianDurationS,
			medianLengthM: a.medianLengthM
		}
	}));

	// Les agrégats changent lentement : court cache CDN/navigateur acceptable.
	setHeaders({ 'cache-control': 'public, max-age=60' });
	return json({ type: 'FeatureCollection', features });
};
