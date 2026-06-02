import { describe, it, expect } from 'vitest';
import { levelFromKbps, rateToLevel } from './usage';

describe('levelFromKbps', () => {
	it('≥ 4000 kbps → TBC (streaming)', () => {
		expect(levelFromKbps(4000)).toBe('TBC');
		expect(levelFromKbps(10_000)).toBe('TBC');
	});

	it('≥ 1000 et < 4000 → BC (web)', () => {
		expect(levelFromKbps(1000)).toBe('BC');
		expect(levelFromKbps(3999)).toBe('BC');
	});

	it('≥ 200 et < 1000 → CL (messages)', () => {
		expect(levelFromKbps(200)).toBe('CL');
		expect(levelFromKbps(999)).toBe('CL');
	});

	it('< 200 → none (trop lent)', () => {
		expect(levelFromKbps(199)).toBe('none');
		expect(levelFromKbps(0)).toBe('none');
	});

	it('null (non mesuré) → none', () => {
		expect(levelFromKbps(null)).toBe('none');
	});
});

describe('rateToLevel', () => {
	it('≥ 0,8 → TBC (ça capte bien)', () => {
		expect(rateToLevel(0.8)).toBe('TBC');
		expect(rateToLevel(1)).toBe('TBC');
	});

	it('≥ 0,4 et < 0,8 → CL (réseau dégradé)', () => {
		expect(rateToLevel(0.4)).toBe('CL');
		expect(rateToLevel(0.79)).toBe('CL');
	});

	it('< 0,4 → none (ça coupe)', () => {
		expect(rateToLevel(0.39)).toBe('none');
		expect(rateToLevel(0)).toBe('none');
	});

	it('ne produit jamais BC (réel = ping binaire, 3 paliers)', () => {
		// Aucune valeur de taux ne doit donner BC : ce palier n'existe pas pour le réel.
		for (let r = 0; r <= 1.0001; r += 0.05) expect(rateToLevel(r)).not.toBe('BC');
	});
});
