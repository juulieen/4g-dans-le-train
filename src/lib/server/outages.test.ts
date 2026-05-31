import { describe, it, expect } from 'vitest';
import { buildOutageAggregates, type OutageMeasurementRow } from './outages';

/** Fabrique une ligne de mesure brute (position par défaut à Paris). */
function row(
	sessionId: string,
	measuredAt: number,
	status: OutageMeasurementRow['status'],
	o: Partial<OutageMeasurementRow> = {}
): OutageMeasurementRow {
	return {
		sessionId,
		measuredAt,
		status,
		lat: 48.85,
		lng: 2.35,
		speedKmh: 120,
		operator: 'orange',
		...o
	};
}

const S = 1000;

describe('buildOutageAggregates', () => {
	it('agrège deux sessions ayant une coupure sur la même cellule', () => {
		const rows = [
			...['s1', 's2'].flatMap((sid) => [
				row(sid, 0, 'ok'),
				row(sid, 10 * S, 'none'),
				row(sid, 30 * S, 'ok') // coupure de 20 s
			])
		];
		const agg = buildOutageAggregates(rows);
		expect(agg).toHaveLength(1);
		expect(agg[0].count).toBe(2);
		expect(agg[0].operator).toBe('orange');
		expect(agg[0].medianDurationS).toBe(20);
	});

	it('exclut les épisodes non terminés (fin inconnue)', () => {
		// Une session se termine sur des `none` (app quittée) : aucun agrégat.
		const rows = [row('s1', 0, 'ok'), row('s1', 10 * S, 'none'), row('s1', 20 * S, 'none')];
		expect(buildOutageAggregates(rows)).toHaveLength(0);
	});

	it('ignore les épisodes sans position de début (cellStart null)', () => {
		const rows = [
			row('s1', 0, 'ok', { lat: null, lng: null }),
			row('s1', 10 * S, 'none', { lat: null, lng: null }),
			row('s1', 30 * S, 'ok', { lat: null, lng: null })
		];
		expect(buildOutageAggregates(rows)).toHaveLength(0);
	});

	it('sépare les opérateurs distincts d’une même session', () => {
		const rows = [
			row('s1', 0, 'ok', { operator: 'orange' }),
			row('s1', 10 * S, 'none', { operator: 'orange' }),
			row('s1', 30 * S, 'ok', { operator: 'orange' }),
			row('s1', 40 * S, 'ok', { operator: 'free' }),
			row('s1', 50 * S, 'none', { operator: 'free' }),
			row('s1', 70 * S, 'ok', { operator: 'free' })
		];
		const agg = buildOutageAggregates(rows);
		expect(agg.map((a) => a.operator).sort()).toEqual(['free', 'orange']);
	});

	it('filtre par ligne inexistante → aucun résultat', () => {
		const rows = [row('s1', 0, 'ok'), row('s1', 10 * S, 'none'), row('s1', 30 * S, 'ok')];
		expect(buildOutageAggregates(rows, { lineSlug: 'ligne-qui-nexiste-pas' })).toHaveLength(0);
	});

	it('ne renvoie aucune donnée brute (ni sessionId, ni timestamp)', () => {
		const rows = [row('s1', 0, 'ok'), row('s1', 10 * S, 'none'), row('s1', 30 * S, 'ok')];
		const agg = buildOutageAggregates(rows);
		const keys = Object.keys(agg[0]).sort();
		expect(keys).toEqual(
			[
				'cellStart',
				'count',
				'lat',
				'lineSlug',
				'lng',
				'medianDurationS',
				'medianLengthM',
				'operator'
			].sort()
		);
	});
});
