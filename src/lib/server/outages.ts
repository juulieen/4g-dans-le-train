/**
 * Agrégation des épisodes de coupure réseau, côté serveur, À LA LECTURE.
 *
 * Principe (cf. docs/PRODUCT.md) : on ne stocke jamais un objet « coupure ». On
 * persiste les mesures brutes horodatées (`measured_at`) et on RECONSTRUIT les
 * épisodes à la demande via la brique pure `detectOutages`, groupés par session.
 * On ne renvoie que des AGRÉGATS (médiane par cellule) — jamais les points bruts
 * ni les séquences par session (vie privée).
 *
 * v1 : scan + dérivation à la lecture (suffisant au volume actuel). Si ça devient
 * lent, matérialiser une table d'agrégats recalculée à l'ingestion (hors scope).
 */
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { db } from './db/client';
import { measurements, type Measurement } from './db/schema';
import { cellCenter } from '$geo/h3';
import { lineSlugForCell } from '$geo/line-snap';
import { detectOutages, type OutageSample } from '$lib/measure/outage';

export interface OutageCellAggregate {
	/** Cellule H3 où la coupure commence. */
	cellStart: string;
	operator: string;
	/** Ligne ferroviaire rattachée (dérivée de la cellule), si connue. */
	lineSlug: string | null;
	/** Centre de la cellule (pour le rendu carte). */
	lat: number;
	lng: number;
	/** Nombre d'épisodes observés démarrant sur cette cellule. */
	count: number;
	/** Durée médiane de coupure (secondes). */
	medianDurationS: number;
	/** Longueur médiane parcourue (mètres). */
	medianLengthM: number;
}

interface AggregateOptions {
	operator?: string | null;
	lineSlug?: string | null;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Reconstruit les épisodes de coupure depuis les mesures brutes et les agrège
 * par (cellule de début × opérateur).
 */
export async function aggregateOutages(
	opts: AggregateOptions = {}
): Promise<OutageCellAggregate[]> {
	// On ne dérive que sur les mesures horodatées (les anciennes, sans measured_at,
	// ne permettent pas de reconstruire la chronologie). Filtre opérateur en SQL.
	const where = opts.operator
		? and(
				isNotNull(measurements.measuredAt),
				eq(measurements.operator, opts.operator as Measurement['operator'])
			)
		: isNotNull(measurements.measuredAt);

	const rows = await db
		.select({
			status: measurements.status,
			measuredAt: measurements.measuredAt,
			lat: measurements.lat,
			lng: measurements.lng,
			speedKmh: measurements.speedKmh,
			operator: measurements.operator,
			sessionId: measurements.sessionId
		})
		.from(measurements)
		.where(where)
		.orderBy(asc(measurements.sessionId), asc(measurements.measuredAt));

	// Groupe par (session × opérateur) : un même opérateur par groupe garantit que
	// l'épisode dérivé porte un opérateur cohérent.
	const groups = new Map<string, { operator: string; samples: OutageSample[] }>();
	for (const r of rows) {
		const key = `${r.sessionId}|${r.operator}`;
		let g = groups.get(key);
		if (!g) {
			g = { operator: r.operator, samples: [] };
			groups.set(key, g);
		}
		g.samples.push({
			measuredAt: r.measuredAt as number,
			status: r.status,
			lat: r.lat,
			lng: r.lng,
			speedKmh: r.speedKmh
		});
	}

	// Dérive les épisodes par groupe puis agrège par (cellStart × opérateur).
	const buckets = new Map<string, { operator: string; durations: number[]; lengths: number[] }>();
	for (const { operator, samples } of groups.values()) {
		for (const ep of detectOutages(samples)) {
			if (!ep.cellStart) continue; // pas de position de début connue → inagrégeable
			const key = `${ep.cellStart}|${operator}`;
			let b = buckets.get(key);
			if (!b) {
				b = { operator, durations: [], lengths: [] };
				buckets.set(key, b);
			}
			b.durations.push(ep.durationS);
			b.lengths.push(ep.lengthM);
		}
	}

	const result: OutageCellAggregate[] = [];
	for (const [key, b] of buckets) {
		const cellStart = key.slice(0, key.lastIndexOf('|'));
		const lineSlug = lineSlugForCell(cellStart);
		if (opts.lineSlug && lineSlug !== opts.lineSlug) continue; // filtre ligne
		const { lat, lng } = cellCenter(cellStart);
		result.push({
			cellStart,
			operator: b.operator,
			lineSlug,
			lat,
			lng,
			count: b.durations.length,
			medianDurationS: median(b.durations),
			medianLengthM: median(b.lengths)
		});
	}
	return result;
}
