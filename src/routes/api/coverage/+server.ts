import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { cellAggregates } from '$lib/server/db/schema';
import { resolveLineFilter } from '$geo/troncon-snap';
import type { RequestHandler } from './$types';

/**
 * Renvoie les agrégats de couverture au format GeoJSON (FeatureCollection de
 * points), prêt à être affiché par MapLibre. Filtrable par opérateur via ?operator=
 * et par ligne via ?line= (slug commercial, ex. paris-lyon) — ce dernier alimente
 * la couche « réel » de la frise « profil de trajet » et le bloc de comparaison
 * des pages SEO opérateur (CommunityComparison.svelte).
 *
 * Pour un slug de TRONÇON, on sert les mesures de sa ligne PARENTE restreintes aux
 * cellules du tronçon (cf. resolveLineFilter) : la page tronçon montre ainsi les
 * mesures de la portion correspondante.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const operator = url.searchParams.get('operator');
	const line = url.searchParams.get('line');
	const lineFilter = resolveLineFilter(line);

	const filters = [
		operator ? eq(cellAggregates.operator, operator) : undefined,
		// Ligne normale : filtre SQL par `lineSlug`. Tronçon : on NE filtre PAS par
		// `lineSlug` — le slug stocké est le PRIMAIRE de la cellule (ligne la plus
		// locale du tronc commun), pas la parente du tronçon ; on filtre par les
		// CELLULES de la portion (en mémoire ci-dessous), qui l'identifient exactement.
		lineFilter && !lineFilter.cells ? eq(cellAggregates.lineSlug, lineFilter.lineSlug) : undefined
	].filter((f) => f !== undefined);

	const allRows = filters.length
		? await db
				.select()
				.from(cellAggregates)
				.where(filters.length === 1 ? filters[0] : and(...filters))
		: await db.select().from(cellAggregates);
	// Tronçon : on ne garde que les cellules de la portion correspondante.
	const rows = lineFilter?.cells ? allRows.filter((r) => lineFilter.cells!.has(r.cellId)) : allRows;

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
