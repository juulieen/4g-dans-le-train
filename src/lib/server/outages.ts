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
import { resolveLineFilter } from '$geo/troncon-snap';
import { detectOutages, type OutageSample } from '$lib/measure/outage';

/** Opérateurs valides (doit suivre l'enum du schéma). */
const OPERATORS = ['orange', 'sfr', 'free', 'bouygues', 'autre', 'inconnu'] as const;
type Operator = (typeof OPERATORS)[number];

/** Valide une chaîne arbitraire (query) contre l'enum opérateur ; null sinon. */
export function parseOperator(value: string | null | undefined): Operator | null {
	return value && (OPERATORS as readonly string[]).includes(value) ? (value as Operator) : null;
}

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

/** Une mesure brute, telle que lue en base, pour la dérivation. */
export interface OutageMeasurementRow {
	status: OutageSample['status'];
	measuredAt: number;
	lat: number | null;
	lng: number | null;
	speedKmh: number | null;
	operator: string;
	sessionId: string;
}

interface AggregateOptions {
	operator?: string | null;
	lineSlug?: string | null;
	/** Restreint aux cellules d'un tronçon (filtre de portion, cf. troncon-snap). */
	cells?: Set<string>;
}

/** Médiane « haute » (élément central supérieur), cohérente avec recomputeCell. */
function median(values: number[]): number {
	if (!values.length) return 0; // garde : aucun bucket vide n'est créé en pratique
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Cœur PUR (sans DB) : à partir des mesures brutes (déjà filtrées/ordonnées),
 * reconstruit les épisodes par session × opérateur et les agrège par cellule de
 * début. Testable sans base. Les épisodes **non terminés** (coupés par l'arrêt de
 * session ou un trou de mesure) sont exclus : on ne connaît pas leur vraie fin,
 * ils biaiseraient la durée médiane vers le bas.
 */
export function buildOutageAggregates(
	rows: OutageMeasurementRow[],
	opts: AggregateOptions = {}
): OutageCellAggregate[] {
	// Groupe par (session × opérateur) : un opérateur unique par groupe garantit
	// un épisode cohérent même si l'utilisateur change d'opérateur en cours de route.
	const groups = new Map<string, { operator: string; samples: OutageSample[] }>();
	for (const r of rows) {
		const key = `${r.sessionId}|${r.operator}`;
		let g = groups.get(key);
		if (!g) {
			g = { operator: r.operator, samples: [] };
			groups.set(key, g);
		}
		g.samples.push({
			measuredAt: r.measuredAt,
			status: r.status,
			lat: r.lat,
			lng: r.lng,
			speedKmh: r.speedKmh
		});
	}

	// Dérive les épisodes par groupe puis agrège par (cellStart × opérateur).
	const buckets = new Map<
		string,
		{ cellStart: string; operator: string; durations: number[]; lengths: number[] }
	>();
	for (const { operator, samples } of groups.values()) {
		for (const ep of detectOutages(samples)) {
			if (!ep.terminated) continue; // fin inconnue → exclu de l'agrégat
			if (!ep.cellStart) continue; // pas de position de début connue → inagrégeable
			const key = `${ep.cellStart}|${operator}`;
			let b = buckets.get(key);
			if (!b) {
				b = { cellStart: ep.cellStart, operator, durations: [], lengths: [] };
				buckets.set(key, b);
			}
			b.durations.push(ep.durationS);
			b.lengths.push(ep.lengthM);
		}
	}

	const result: OutageCellAggregate[] = [];
	for (const b of buckets.values()) {
		const lineSlug = lineSlugForCell(b.cellStart);
		if (opts.lineSlug && lineSlug !== opts.lineSlug) continue; // filtre ligne
		if (opts.cells && !opts.cells.has(b.cellStart)) continue; // filtre portion (tronçon)
		const { lat, lng } = cellCenter(b.cellStart);
		result.push({
			cellStart: b.cellStart,
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

/**
 * Lit les mesures brutes horodatées et les agrège en coupures par tronçon.
 * Fine couche DB autour de `buildOutageAggregates`.
 */
export async function aggregateOutages(
	opts: AggregateOptions = {}
): Promise<OutageCellAggregate[]> {
	const operator = parseOperator(opts.operator);
	// On ne dérive que sur les mesures horodatées (les anciennes, sans measured_at,
	// ne permettent pas de reconstruire la chronologie). Filtre opérateur en SQL.
	const where = operator
		? and(
				isNotNull(measurements.measuredAt),
				eq(measurements.operator, operator as Measurement['operator'])
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

	// `measuredAt` est non-null (garanti par le WHERE isNotNull).
	const typed: OutageMeasurementRow[] = rows.map((r) => ({
		...r,
		measuredAt: r.measuredAt as number
	}));
	// Tronçon : on filtre par les CELLULES de la portion (et NON par `lineSlug`, qui
	// est le slug primaire de la cellule — pas la parente du tronçon sur un tronc
	// commun). Ligne normale : filtre classique par `lineSlug`.
	const lineFilter = resolveLineFilter(opts.lineSlug ?? null);
	return buildOutageAggregates(
		typed,
		lineFilter?.cells ? { cells: lineFilter.cells } : { lineSlug: lineFilter?.lineSlug ?? null }
	);
}
