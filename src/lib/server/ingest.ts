import { and, eq } from 'drizzle-orm';
import { lineSlugForCell } from '$geo/line-snap';
import { db } from './db/client';
import { cellAggregates, measurements, type NewMeasurement } from './db/schema';

/** Type de l'enum opérateur, dérivé du schéma. */
type Operator = NonNullable<NewMeasurement['operator']>;

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

/**
 * Médiane (haute) des valeurs non nulles d'une colonne ; null si aucune.
 * Sur un nombre pair d'éléments on prend le central supérieur (pas de moyenne) :
 * micro-biais négligeable au volume, et garde une valeur entière pour rtt/débit.
 * Le filtrage des null est voulu : une cellule sans mesure de débit reste à null.
 */
function median(values: Array<number | null>): number | null {
	const nums = values.filter((v): v is number => v != null).sort((a, b) => a - b);
	return nums.length ? nums[Math.floor(nums.length / 2)] : null;
}

async function recomputeCell(cellId: string, operator: Operator): Promise<void> {
	const rows = await db
		.select({
			status: measurements.status,
			rttMs: measurements.rttMs,
			jitterMs: measurements.jitterMs,
			loss: measurements.loss,
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
	const medianJitter = median(rows.map((r) => r.jitterMs));
	const medianLoss = median(rows.map((r) => r.loss));
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

	const values = {
		cellId,
		operator,
		lat,
		lng,
		samples,
		successRate,
		medianRtt,
		medianJitter,
		medianLoss,
		medianDownlink,
		lineSlug
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
