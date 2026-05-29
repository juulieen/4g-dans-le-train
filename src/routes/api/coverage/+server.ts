import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { cellAggregates } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * Renvoie les agrégats de couverture au format GeoJSON (FeatureCollection de
 * points), prêt à être affiché par MapLibre. Filtrable par opérateur via ?operator=.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const operator = url.searchParams.get('operator');

	const rows = operator
		? await db.select().from(cellAggregates).where(eq(cellAggregates.operator, operator))
		: await db.select().from(cellAggregates);

	const features = rows.map((r) => ({
		type: 'Feature' as const,
		geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
		properties: {
			cellId: r.cellId,
			operator: r.operator,
			samples: r.samples,
			successRate: r.successRate,
			medianRtt: r.medianRtt,
			lineSlug: r.lineSlug
		}
	}));

	// Les agrégats changent lentement : court cache CDN/navigateur acceptable.
	setHeaders({ 'cache-control': 'public, max-age=60' });
	return json({ type: 'FeatureCollection', features });
};
