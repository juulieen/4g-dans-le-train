import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { cellAggregates } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * Renvoie les agrégats de couverture au format GeoJSON (FeatureCollection de
 * points), prêt à être affiché par MapLibre. Filtrable par opérateur via ?operator=
 * et par ligne via ?line= (slug commercial, ex. paris-lyon) — ce dernier alimente
 * la couche « réel » de la frise « profil de trajet ».
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const operator = url.searchParams.get('operator');
	const line = url.searchParams.get('line');

	const filters = [
		operator ? eq(cellAggregates.operator, operator) : undefined,
		line ? eq(cellAggregates.lineSlug, line) : undefined
	].filter((f) => f !== undefined);

	const rows = filters.length
		? await db
				.select()
				.from(cellAggregates)
				.where(filters.length === 1 ? filters[0] : and(...filters))
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
