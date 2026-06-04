import { describe, it, expect } from 'vitest';
import { computeLineReal, type RealCell, type RealOutage, type LineGeometry } from './line-real';
import type { PathPoint } from './interpolate';

/** Tracé droit nord-sud de `lengthKm` km le long du méridien lng=0. */
function straightLine(lengthKm: number): LineGeometry {
	const latEnd = lengthKm / 111; // ~111 km par degré de latitude
	const path: PathPoint[] = [
		[0, 0, 0],
		[0, latEnd, lengthKm]
	];
	return {
		path,
		lengthKm,
		stations: [
			{ name: 'Départ', distKm: 0 },
			{ name: 'Milieu', distKm: lengthKm / 2 },
			{ name: 'Arrivée', distKm: lengthKm }
		]
	};
}

/** Une cellule placée à l'abscisse `km` sur le tracé droit (offset ~0). */
function cellAt(km: number, lengthKm: number, over: Partial<RealCell> = {}): RealCell {
	const latEnd = lengthKm / 111;
	return {
		cellId: `c${km}`,
		operator: 'orange',
		successRate: 0.9,
		samples: 5,
		lat: (km / lengthKm) * latEnd,
		lng: 0,
		lastSeen: 1000,
		...over
	};
}

describe('computeLineReal', () => {
	it('aucune cellule → instantané vide', () => {
		const r = computeLineReal([], [], straightLine(50));
		expect(r.samples).toBe(0);
		expect(r.sufficient).toBe(false);
		expect(r.blackspots).toEqual([]);
		expect(r.bestOperator).toBeNull();
	});

	it('couverture dense → suffisant, bon goodPct, métriques cohérentes', () => {
		const geom = straightLine(10);
		// 10 cellules fiables réparties tous les ~1 km, toutes « ça capte bien ».
		const cells = Array.from({ length: 10 }, (_, i) =>
			cellAt(i, 10, { cellId: `c${i}`, successRate: 0.9, samples: 5, lastSeen: 2000 + i })
		);
		const r = computeLineReal(cells, [], geom);
		expect(r.samples).toBe(50);
		expect(r.nFiables).toBe(10);
		expect(r.lastSeen).toBe(2009);
		expect(r.bestOperator).toBe('orange');
		expect(r.coveragePct).toBeGreaterThanOrEqual(50);
		expect(r.sufficient).toBe(true);
		expect(r.goodPct).toBeGreaterThanOrEqual(90);
	});

	it('cellules peu nombreuses → couverture insuffisante (partiel)', () => {
		const geom = straightLine(100);
		const cells = [0, 1, 2].map((i) => cellAt(i, 100, { cellId: `c${i}`, samples: 5 }));
		const r = computeLineReal(cells, [], geom);
		expect(r.nFiables).toBe(3);
		expect(r.sufficient).toBe(false); // < MIN_CELLS et couverture faible
	});

	it('cellules sous le seuil de pings → non fiables', () => {
		const geom = straightLine(10);
		const cells = Array.from({ length: 10 }, (_, i) =>
			cellAt(i, 10, { cellId: `c${i}`, samples: 2 })
		);
		const r = computeLineReal(cells, [], geom);
		expect(r.samples).toBe(20);
		expect(r.nFiables).toBe(0); // 2 < MIN_SAMPLES_CELL (3)
		expect(r.sufficient).toBe(false);
	});

	it('zone « rien » mesurée → point noir (sans durée au build)', () => {
		const geom = straightLine(30);
		// Bon réseau, puis deux cellules « rien » contiguës (~1 km → zone blanche).
		const cells = [
			cellAt(5, 30, { cellId: 'ok1', successRate: 0.9 }),
			cellAt(14, 30, { cellId: 'none1', successRate: 0.1 }),
			cellAt(15, 30, { cellId: 'none2', successRate: 0.1 }),
			cellAt(25, 30, { cellId: 'ok2', successRate: 0.9 })
		];
		const r = computeLineReal(cells, [], geom);
		const spot = r.blackspots.find((b) => b.durationS === 0);
		expect(spot).toBeDefined();
		expect(spot!.afterStation).toBeTruthy();
		expect(spot!.lengthM).toBeGreaterThan(0);
	});

	it('coupure mesurée → enrichit le point noir d’une durée', () => {
		const geom = straightLine(30);
		const cells = [
			cellAt(14, 30, { cellId: 'none1', successRate: 0.1 }),
			cellAt(15, 30, { cellId: 'none2', successRate: 0.1 })
		];
		const latEnd = 30 / 111;
		const outages: RealOutage[] = [
			{ lat: (14.5 / 30) * latEnd, lng: 0, medianDurationS: 120, medianLengthM: 1500 }
		];
		const r = computeLineReal(cells, outages, geom);
		const cut = r.blackspots.find((b) => b.durationS === 120);
		expect(cut).toBeDefined();
	});
});
