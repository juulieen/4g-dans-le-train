import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { cellAggregates } from '$lib/server/db/schema';
import { resolveLineFilter } from '$geo/troncon-snap';
import { loadRouteProfile } from '$lib/server/route-profile';
import { worstByCell, type CellRate } from '$lib/coverage-quality';
import { rateToLevel, type Level } from '$lib/usage';
import { projectOntoPath, positionAtDist, type PathPoint } from '$geo/interpolate';
import type { RequestHandler } from './$types';

/**
 * Renvoie les mesures communautaires sous forme de SEGMENTS colorés le long du tracé
 * ferroviaire (FeatureCollection de LineStrings), pour la couche « réel » de la carte
 * au zoom faible/intermédiaire (un ruban qui suit le rail, au lieu d'une traînée de
 * pastilles illisible). Au zoom fort, la carte bascule sur un quadrillage H3 construit
 * côté client à partir de `/api/coverage` (cf. Map.svelte) — pas servi ici.
 *
 * Principe : pour chaque ligne, on projette ses cellules mesurées sur la polyligne du
 * profil (`projectOntoPath`), on les trie par abscisse curviligne, on les classe en
 * 3 niveaux d'usage (`rateToLevel`) et on fusionne les cellules consécutives de même
 * niveau en un segment (run-length). En vue « tous opérateurs », chaque cellule prend
 * le PIRE taux parmi les opérateurs (`worstByCell`). Filtrable `?operator=` et `?line=`.
 */

/** Au-delà de cette distance au tracé, une cellule n'est pas « sur cette ligne ». */
const MAX_OFFSET_M = 600;
/** Trou de mesure au-delà duquel on coupe le ruban (km) plutôt que relier dans le vide. */
const MAX_GAP_KM = 3;
/** Demi-extension d'un segment (km) : ~taille d'une cellule, pour qu'une cellule isolée reste visible. */
const PAD_KM = 0.09;

interface ProjectedCell {
	distKm: number;
	level: Level;
	rate: number;
	samples: number;
	operator: string;
}

/** Coordonnées [lng, lat] d'un segment le long du tracé, épousant les courbes du rail. */
function segmentCoords(path: PathPoint[], fromKm: number, toKm: number): [number, number][] {
	const a = positionAtDist(path, fromKm);
	const raw: [number, number][] = [[a.lng, a.lat]];
	for (const [lng, lat, d] of path) {
		if (d > fromKm && d < toKm) raw.push([lng, lat]);
	}
	const b = positionAtDist(path, toKm);
	raw.push([b.lng, b.lat]);
	// Dédoublonne les points consécutifs identiques : aux extrémités du tracé, le PAD
	// est clampé par positionAtDist et peut coïncider avec un point intermédiaire →
	// éviter une LineString dégénérée (segments de longueur nulle).
	const coords: [number, number][] = [];
	for (const c of raw) {
		const prev = coords[coords.length - 1];
		if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) coords.push(c);
	}
	return coords;
}

export const GET: RequestHandler = async ({ url, fetch, setHeaders }) => {
	const operator = url.searchParams.get('operator');
	const line = url.searchParams.get('line');
	const lineFilter = resolveLineFilter(line);

	// Mêmes filtres SQL que /api/coverage (cohérence avec la couche points).
	const filters = [
		operator ? eq(cellAggregates.operator, operator) : undefined,
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
		const path = profile.path;
		if (path.length < 2) continue; // un seul point : pas de tracé à suivre

		// Cellules de cette ligne. En vue ligne/tronçon, `rows` est déjà restreint.
		const cellsForLine = line ? rows : rows.filter((r) => r.lineSlug === slug);

		// « Pire opérateur » par cellule (sauf si un opérateur est sélectionné : 1 valeur/cellule).
		const cells: Array<{
			cellId: string;
			rate: number;
			samples: number;
			operator: string;
			lat: number;
			lng: number;
		}> = operator
			? cellsForLine.map((r) => ({
					cellId: r.cellId,
					rate: r.successRate,
					samples: r.samples,
					operator: r.operator,
					lat: r.lat,
					lng: r.lng
				}))
			: [...worstByCell(cellsForLine as CellRate[]).values()];

		// Projeter sur le tracé, écarter les cellules hors ligne.
		const projected: ProjectedCell[] = [];
		for (const c of cells) {
			const proj = projectOntoPath(path, c.lat, c.lng);
			if (proj.offsetM > MAX_OFFSET_M) continue;
			projected.push({
				distKm: proj.distKm,
				level: rateToLevel(c.rate),
				rate: c.rate,
				samples: c.samples,
				operator: c.operator
			});
		}
		if (projected.length === 0) continue;
		projected.sort((a, b) => a.distKm - b.distKm);

		// Fusion run-length : cellules consécutives de même niveau et assez proches.
		let seg: {
			level: Level;
			fromKm: number;
			toKm: number;
			lastKm: number;
			samples: number;
			worstRate: number;
			worstOp: string;
		} | null = null;
		const flush = () => {
			if (!seg) return;
			const from = seg.fromKm - PAD_KM;
			const to = seg.toKm + PAD_KM;
			features.push({
				type: 'Feature',
				geometry: { type: 'LineString', coordinates: segmentCoords(path, from, to) },
				properties: {
					quality: seg.level,
					worstRate: seg.worstRate,
					samples: seg.samples,
					operator: seg.worstOp,
					lineSlug: slug,
					fromKm: Math.round(seg.fromKm * 10) / 10,
					toKm: Math.round(seg.toKm * 10) / 10
				}
			});
		};
		for (const p of projected) {
			if (seg && p.level === seg.level && p.distKm - seg.lastKm <= MAX_GAP_KM) {
				seg.toKm = p.distKm;
				seg.lastKm = p.distKm;
				seg.samples += p.samples;
				if (p.rate < seg.worstRate) {
					seg.worstRate = p.rate;
					seg.worstOp = p.operator;
				}
			} else {
				flush();
				seg = {
					level: p.level,
					fromKm: p.distKm,
					toKm: p.distKm,
					lastKm: p.distKm,
					samples: p.samples,
					worstRate: p.rate,
					worstOp: p.operator
				};
			}
		}
		flush();
	}

	// Les agrégats changent lentement : court cache CDN/navigateur, aligné sur /api/coverage.
	setHeaders({ 'cache-control': 'public, max-age=60' });
	return json({ type: 'FeatureCollection', features });
};
