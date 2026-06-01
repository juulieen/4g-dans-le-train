import { and, eq, sql } from 'drizzle-orm';
import { lineSlugForCell } from '$geo/line-snap';
import { db } from './db/client';
import { cellAggregates, measurements, type NewMeasurement } from './db/schema';

/** Type de l'enum opérateur, dérivé du schéma. */
type Operator = NonNullable<NewMeasurement['operator']>;

/** Médiane (haute) des valeurs non nulles ; null si aucune. Le filtrage des null
 *  est voulu : une cellule sans mesure de débit reste à null. */
function median(values: Array<number | null>): number | null {
	const nums = values.filter((v): v is number => v != null).sort((a, b) => a - b);
	return nums.length ? nums[Math.floor(nums.length / 2)] : null;
}

/**
 * Insère une mesure puis recalcule l'agrégat (cellule × opérateur).
 *
 * On garde les mesures brutes (utiles pour recalcul/debug) ET un agrégat
 * dénormalisé que l'API /api/coverage sert directement à la carte.
 */
export async function ingestMeasurement(m: NewMeasurement): Promise<void> {
	await db.insert(measurements).values(m);
	await recomputeCell(m.cellId, m.operator ?? 'inconnu');
}

async function recomputeCell(cellId: string, operator: Operator): Promise<void> {
	const rows = await db
		.select({
			status: measurements.status,
			rttMs: measurements.rttMs,
			downlinkKbps: measurements.downlinkKbps,
			lat: measurements.lat,
			lng: measurements.lng
		})
		.from(measurements)
		.where(and(eq(measurements.cellId, cellId), eq(measurements.operator, operator)));

	if (rows.length === 0) return;

	const samples = rows.length;
	const okCount = rows.filter((r) => r.status === 'ok').length;
	const successRate = okCount / samples;
	const medianRtt = median(rows.map((r) => r.rttMs));
	// Débit médian : ne compte que les mesures qui en portent (opt-in/cadencé) →
	// null si la cellule n'a aucune mesure de débit.
	const medianDownlink = median(rows.map((r) => r.downlinkKbps));
	const { lat, lng } = rows[0];
	// `lineSlug` est une fonction déterministe de la cellule : on le dérive de
	// l'index plutôt que de `rows[0]` (dont l'ordre n'est pas garanti). Reste
	// cohérent même pour les mesures historiques insérées sans lineSlug.
	const lineSlug = lineSlugForCell(cellId);

	const existing = await db
		.select({ cellId: cellAggregates.cellId })
		.from(cellAggregates)
		.where(and(eq(cellAggregates.cellId, cellId), eq(cellAggregates.operator, operator)))
		.limit(1);

	// `lastSeen` = instant de la dernière mesure : à réécrire à CHAQUE recalcul
	// (sinon l'UPDATE garderait l'instant du premier insert, faussant la fraîcheur
	// affichée par les pages SEO / la frise).
	const values = {
		cellId,
		operator,
		lat,
		lng,
		samples,
		successRate,
		medianRtt,
		medianDownlink,
		lineSlug,
		lastSeen: sql`(unixepoch())`
	};

	if (existing.length) {
		await db
			.update(cellAggregates)
			.set(values)
			.where(and(eq(cellAggregates.cellId, cellId), eq(cellAggregates.operator, operator)));
	} else {
		await db.insert(cellAggregates).values(values);
	}
}
