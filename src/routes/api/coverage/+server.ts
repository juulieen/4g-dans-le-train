import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { cellAggregates } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * Renvoie les agrégats de couverture au format GeoJSON (FeatureCollection de
 * points), prêt à être affiché par MapLibre. Filtrable par opérateur (`?operator=`)
 * et/ou par ligne commerciale (`?line=<slug>`). Le filtre `?line=` alimente le
 * bloc « mesures réelles » des pages SEO (CommunityComparison.svelte), qui charge
 * la couche communautaire (mouvante) côté client par-dessus l'ARCEP prerendu.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const operator = url.searchParams.get('operator');
	const line = url.searchParams.get('line');

	const conds = [];
	if (operator) conds.push(eq(cellAggregates.operator, operator));
	if (line) conds.push(eq(cellAggregates.lineSlug, line));

	const base = db.select().from(cellAggregates);
	const rows = await (conds.length ? base.where(and(...conds)) : base);

	const features = rows.map((r) => ({
		type: 'Feature' as const,
		geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
		properties: {
			cellId: r.cellId,
			operator: r.operator,
			samples: r.samples,
			successRate: r.successRate,
			medianRtt: r.medianRtt,
			lineSlug: r.lineSlug,
			lastSeen: r.lastSeen
		}
	}));

	// Les agrégats changent lentement : court cache CDN/navigateur acceptable.
	setHeaders({ 'cache-control': 'public, max-age=60' });
	return json({ type: 'FeatureCollection', features });
};
