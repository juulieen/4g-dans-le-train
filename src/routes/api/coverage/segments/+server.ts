import { json } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { cellAggregates } from '$lib/server/db/schema';
import { resolveLineFilter } from '$geo/troncon-snap';
import { WIFI_TRAIN_OPERATOR } from '$lib/operators';
import { loadRouteProfile } from '$lib/server/route-profile';
import { worstByCell, type CellRate } from '$lib/coverage-quality';
import { buildLineSegments, type SegmentCell } from '$lib/coverage-segments';
import type { RequestHandler } from './$types';

/**
 * Renvoie les mesures communautaires sous forme de SEGMENTS colorés le long du tracé
 * ferroviaire (FeatureCollection de LineStrings), pour la couche « réel » de la carte
 * au zoom faible/intermédiaire (un ruban qui suit le rail, au lieu d'une traînée de
 * pastilles illisible). Au zoom fort, la carte bascule sur un quadrillage H3 construit
 * côté client à partir de `/api/coverage` (cf. Map.svelte) — pas servi ici.
 *
 * Pour chaque ligne, on charge son profil (polyligne ordonnée) et on délègue la
 * construction des segments à `buildLineSegments` (projection + run-length, module pur
 * testé). En vue « tous opérateurs », chaque cellule prend le PIRE taux parmi les
 * opérateurs (`worstByCell`). Filtrable `?operator=` et `?line=` (mêmes filtres que
 * `/api/coverage`, via `resolveLineFilter`).
 *
 * PERFORMANCE (full-scan) : en vue globale (sans `?operator=`/`?line=`), on lit TOUTE
 * la table `cell_aggregates` à chaque requête (pas d'agrégat pré-calculé). C'est borné
 * et rapide au volume actuel (quelques milliers de cellules → ~10-50 ms), et atténué
 * par le cache HTTP 60 s + la mémoïsation des profils. Mais le coût croît linéairement
 * avec le volume de mesures, et le cache 60 s ne couvre pas l'instant juste après une
 * nouvelle mesure (`refreshCoverage` re-déclenche un fetch). Si ça devient lent :
 * pré-calculer les rubans (façon `route-profiles`) ou matérialiser une table d'agrégats
 * de segments recalculée à l'ingestion. Hors scope pour l'instant.
 */
export const GET: RequestHandler = async ({ url, fetch, setHeaders }) => {
	const operator = url.searchParams.get('operator');
	const line = url.searchParams.get('line');
	const lineFilter = resolveLineFilter(line);

	// Mêmes filtres SQL que /api/coverage (cohérence avec la couche points) : opérateur
	// précis exact, sinon exclusion du Wi-Fi de bord (cf. src/lib/operators.ts).
	const filters = [
		operator
			? eq(cellAggregates.operator, operator)
			: ne(cellAggregates.operator, WIFI_TRAIN_OPERATOR),
		lineFilter && !lineFilter.cells ? eq(cellAggregates.lineSlug, lineFilter.lineSlug) : undefined
	].filter((f) => f !== undefined);

	const allRows = filters.length
		? await db
				.select()
				.from(cellAggregates)
				.where(filters.length === 1 ? filters[0] : and(...filters))
		: await db.select().from(cellAggregates);
	// Tronçon : restreindre aux cellules de la portion.
	const rows = lineFilter?.cells ? allRows.filter((r) => lineFilter.cells!.has(r.cellId)) : allRows;

	// Slugs à tracer : le slug demandé (son profil, même pour un tronçon) ou, en vue
	// globale, toutes les lignes présentes dans les agrégats (cellules sans ligne ignorées).
	const targetSlugs = line
		? [line]
		: [...new Set(rows.map((r) => r.lineSlug).filter((s): s is string => !!s))];

	const features: GeoJSON.Feature[] = [];

	for (const slug of targetSlugs) {
		const profile = await loadRouteProfile(fetch, slug);
		if (!profile) continue;

		// Cellules de cette ligne. En vue ligne/tronçon, `rows` est déjà restreint.
		const cellsForLine = line ? rows : rows.filter((r) => r.lineSlug === slug);

		// « Pire opérateur » par cellule (sauf si un opérateur est sélectionné : 1 valeur/cellule).
		const cells: SegmentCell[] = operator
			? cellsForLine.map((r) => ({
					rate: r.successRate,
					samples: r.samples,
					operator: r.operator,
					lat: r.lat,
					lng: r.lng
				}))
			: [...worstByCell(cellsForLine as CellRate[]).values()].map((c) => ({
					rate: c.rate,
					samples: c.samples,
					operator: c.operator,
					lat: c.lat,
					lng: c.lng
				}));

		features.push(...buildLineSegments(profile.path, cells, slug));
	}

	// Les agrégats changent lentement : court cache CDN/navigateur, aligné sur /api/coverage.
	setHeaders({ 'cache-control': 'public, max-age=60' });
	return json({ type: 'FeatureCollection', features });
};
