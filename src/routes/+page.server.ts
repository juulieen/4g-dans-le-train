import { db } from '$lib/server/db/client';
import { cellAggregates } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

/**
 * Charge les agrégats de couverture pour l'affichage initial de la carte
 * (rendu côté serveur). Le client rafraîchit ensuite via /api/coverage.
 */
export const load: PageServerLoad = async ({ setHeaders }) => {
	const rows = await db.select().from(cellAggregates);

	const coverage = {
		type: 'FeatureCollection' as const,
		features: rows.map((r) => ({
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
			properties: {
				cellId: r.cellId,
				operator: r.operator,
				samples: r.samples,
				successRate: r.successRate,
				medianRtt: r.medianRtt
			}
		}))
	};

	setHeaders({ 'cache-control': 'public, max-age=60' });
	return { coverage, cells: rows.length };
};
