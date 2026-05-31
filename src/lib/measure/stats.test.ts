import { describe, it, expect } from 'vitest';
import {
	computeBurstStats,
	verdictFromBurst,
	DEFAULT_BURST_THRESHOLDS,
	type BurstStats
} from './stats';

describe('computeBurstStats', () => {
	it('tous succès : perte nulle, rtt + gigue calculés', () => {
		const s = computeBurstStats([100, 140, 120]);
		expect(s.total).toBe(3);
		expect(s.ok).toBe(3);
		expect(s.loss).toBe(0);
		expect(s.rttMin).toBe(100);
		// médiane (haute) de [100,120,140] = 120
		expect(s.rttMedian).toBe(120);
		// gigue = moyenne(|140-100|, |120-140|) = moyenne(40, 20) = 30
		expect(s.jitterMs).toBe(30);
	});

	it('tous échecs : perte totale, rtt et gigue null', () => {
		const s = computeBurstStats([null, null, null]);
		expect(s.total).toBe(3);
		expect(s.ok).toBe(0);
		expect(s.loss).toBe(1);
		expect(s.rttMin).toBeNull();
		expect(s.rttMedian).toBeNull();
		expect(s.jitterMs).toBeNull();
	});

	it('mixte : perte partielle, gigue sur les seuls succès', () => {
		const s = computeBurstStats([100, null, 200, null]);
		expect(s.total).toBe(4);
		expect(s.ok).toBe(2);
		expect(s.loss).toBe(0.5);
		expect(s.rttMin).toBe(100);
		// gigue sur [100, 200] = |200-100| = 100
		expect(s.jitterMs).toBe(100);
	});

	it('un seul succès : gigue null (pas de variation calculable)', () => {
		const s = computeBurstStats([null, 150, null]);
		expect(s.ok).toBe(1);
		expect(s.rttMin).toBe(150);
		expect(s.rttMedian).toBe(150);
		expect(s.jitterMs).toBeNull();
	});

	it('liste vide : perte = 1, tout null', () => {
		const s = computeBurstStats([]);
		expect(s.total).toBe(0);
		expect(s.ok).toBe(0);
		expect(s.loss).toBe(1);
		expect(s.rttMin).toBeNull();
		expect(s.rttMedian).toBeNull();
		expect(s.jitterMs).toBeNull();
	});

	it('médiane (haute) sur un nombre pair de succès', () => {
		// [10,20,30,40] → élément central supérieur = index 2 = 30
		expect(computeBurstStats([10, 20, 30, 40]).rttMedian).toBe(30);
	});
});

/** Construit un BurstStats minimal pour tester verdictFromBurst isolément. */
function stats(overrides: Partial<BurstStats> = {}): BurstStats {
	return { rttMin: 50, rttMedian: 50, jitterMs: 10, loss: 0, total: 4, ok: 4, ...overrides };
}

describe('verdictFromBurst', () => {
	it('connexion saine → ok', () => {
		expect(verdictFromBurst(stats())).toBe('ok');
	});

	it('perte ≥ seuil dégradé → degraded', () => {
		expect(verdictFromBurst(stats({ loss: DEFAULT_BURST_THRESHOLDS.degradedLoss }))).toBe(
			'degraded'
		);
	});

	it('RTT médian élevé → degraded', () => {
		expect(verdictFromBurst(stats({ rttMedian: 1600 }))).toBe('degraded');
	});

	it('gigue élevée → degraded même si RTT bas', () => {
		expect(verdictFromBurst(stats({ rttMedian: 80, jitterMs: 250 }))).toBe('degraded');
	});

	it('perte partielle élevée (1 ping passe sur 4) → degraded, pas none', () => {
		// loss 0.75 mais un ping a répondu → réseau présent mais dégradé.
		expect(verdictFromBurst(stats({ loss: 0.75, ok: 1, rttMedian: 80, jitterMs: null }))).toBe(
			'degraded'
		);
	});

	it('perte totale → none', () => {
		expect(verdictFromBurst(stats({ loss: 1, ok: 0, rttMedian: null, jitterMs: null }))).toBe(
			'none'
		);
	});

	it('aucune tentative (total 0) → none', () => {
		expect(verdictFromBurst(computeBurstStats([]))).toBe('none');
	});
});
