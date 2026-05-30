import { db } from '$lib/server/db/client';
import { cellAggregates } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

// La carte dépend de la base : pas de prerender, rendu serveur à la volée.
export const prerender = false;

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/**
 * Charge les agrégats de couverture pour l'affichage initial de la carte
 * (rendu côté serveur). Le client rafraîchit ensuite via /api/coverage.
 *
 * Résilient : si la base n'est pas encore migrée (premier déploiement, build),
 * on renvoie une couverture vide plutôt que de faire échouer le rendu.
 */
export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'public, max-age=60' });

	let rows: (typeof cellAggregates.$inferSelect)[] = [];
	try {
		rows = await db.select().from(cellAggregates);
	} catch (e) {
		console.warn('[coverage] base indisponible, couverture vide :', (e as Error).message);
		return { coverage: EMPTY, cells: 0 };
	}

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

	return { coverage, cells: rows.length };
};
