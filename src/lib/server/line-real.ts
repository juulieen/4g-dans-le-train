/**
 * Calcule l'instantané du RÉEL communautaire d'une ligne depuis la base VIVE, pour
 * le **SSR** de la page `/ligne/[slug]` (verdict + points noirs rendus côté serveur,
 * indexables et toujours frais — pas de prérendu nocturne). Fine couche DB autour du
 * module pur `computeLineReal` (cf. `$geo/line-real`).
 *
 * PERFORMANCE : `aggregateOutages` scanne les mesures brutes à chaque appel ; combiné
 * au `cache-control` de la page (quelques minutes) et au volume actuel, c'est borné.
 * Si ça grossit : matérialiser un agrégat de coupures (cf. note dans `outages.ts`).
 */
import { and, eq, ne } from 'drizzle-orm';
import { db } from './db/client';
import { cellAggregates } from './db/schema';
import { aggregateOutages } from './outages';
import { resolveLineFilter } from '$geo/troncon-snap';
import { WIFI_TRAIN_OPERATOR } from '$lib/operators';
import { computeLineReal, type LineReal, type RealCell, type RealOutage } from '$geo/line-real';

/**
 * Instantané réel d'une ligne (calcul live). `fetch` sert à lire le profil de trajet.
 * `operator` (clé `orange|sfr|free|bouygues`) restreint au réseau d'un opérateur (page
 * ligne × opérateur) ; sinon vue « tous opérateurs » (hors wifi de bord).
 */
export async function loadLineReal(
	fetchFn: typeof fetch,
	slug: string,
	operator?: string
): Promise<LineReal> {
	// Géométrie du trajet (tracé + gares + longueur), depuis l'asset statique.
	const res = await fetchFn(`/data/route-profiles/${slug}.json`);
	if (!res.ok) return computeLineReal([], [], { path: [], stations: [], lengthKm: 0 });
	const profile = (await res.json()) as {
		path: [number, number, number][];
		stations: { name: string; distKm: number }[];
		lengthKm: number;
	};

	// Cellules mesurées de la ligne (hors wifi de bord). Tronçon : filtre par cellules.
	const lineFilter = resolveLineFilter(slug);
	const filters = [
		// Opérateur précis → filtre exact ; sinon tous, hors wifi de bord.
		operator
			? eq(cellAggregates.operator, operator)
			: ne(cellAggregates.operator, WIFI_TRAIN_OPERATOR),
		lineFilter && !lineFilter.cells ? eq(cellAggregates.lineSlug, lineFilter.lineSlug) : undefined
	].filter((f) => f !== undefined);
	const allRows = await db
		.select()
		.from(cellAggregates)
		.where(filters.length === 1 ? filters[0] : and(...filters));
	const rows = lineFilter?.cells ? allRows.filter((r) => lineFilter.cells!.has(r.cellId)) : allRows;

	const cells: RealCell[] = rows.map((r) => ({
		cellId: r.cellId,
		operator: r.operator,
		successRate: r.successRate,
		samples: r.samples,
		lat: r.lat,
		lng: r.lng,
		lastSeen: r.lastSeen
	}));

	// Coupures agrégées (durées médianes) → points noirs enrichis « ça coupe ~N min ».
	const outages: RealOutage[] = (await aggregateOutages({ lineSlug: slug, operator })).map((o) => ({
		lat: o.lat,
		lng: o.lng,
		medianDurationS: o.medianDurationS,
		medianLengthM: o.medianLengthM
	}));

	return computeLineReal(cells, outages, {
		path: profile.path,
		stations: profile.stations,
		lengthKm: profile.lengthKm
	});
}
