import { describe, it, expect } from 'vitest';
import { kbpsFrom } from './throughput';

describe('kbpsFrom', () => {
	it('128 Ko en 1 s ≈ 1049 kbps', () => {
		// 128*1024 octets * 8 bits / 1000 ms = 1048.576 → arrondi 1049
		expect(kbpsFrom(128 * 1024, 1000)).toBe(1049);
	});

	it('1 Mo en 1 s ≈ 8389 kbps', () => {
		expect(kbpsFrom(1024 * 1024, 1000)).toBe(8389);
	});

	it('plus rapide (même volume, moitié du temps) = double débit', () => {
		expect(kbpsFrom(128 * 1024, 500)).toBe(2097);
	});

	it('durée nulle ou négative → 0 (pas de division par zéro)', () => {
		expect(kbpsFrom(1000, 0)).toBe(0);
		expect(kbpsFrom(1000, -5)).toBe(0);
	});
});
