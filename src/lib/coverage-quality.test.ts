import { describe, it, expect } from 'vitest';
import { worstByCell, type CellRate } from './coverage-quality';

const cell = (over: Partial<CellRate>): CellRate => ({
	cellId: 'a',
	operator: 'orange',
	successRate: 1,
	samples: 1,
	lat: 44,
	lng: -0.5,
	...over
});

describe('worstByCell', () => {
	it('une seule cellule/opérateur → reprise telle quelle', () => {
		const m = worstByCell([cell({ successRate: 0.9, samples: 3 })]);
		const w = m.get('a')!;
		expect(w.rate).toBe(0.9);
		expect(w.samples).toBe(3);
		expect(w.operator).toBe('orange');
		expect(w.operatorCount).toBe(1);
	});

	it('plusieurs opérateurs sur la même cellule → retient le PIRE taux', () => {
		const m = worstByCell([
			cell({ operator: 'orange', successRate: 0.9, samples: 50 }),
			cell({ operator: 'sfr', successRate: 0.2, samples: 10 })
		]);
		const w = m.get('a')!;
		expect(w.rate).toBe(0.2); // le pire
		expect(w.operator).toBe('sfr'); // opérateur du pire
		expect(w.samples).toBe(60); // cumul
		expect(w.operatorCount).toBe(2);
	});

	it("l'ordre d'arrivée ne change pas le pire retenu", () => {
		const a = worstByCell([
			cell({ operator: 'sfr', successRate: 0.2 }),
			cell({ operator: 'orange', successRate: 0.9 })
		]).get('a')!;
		expect(a.rate).toBe(0.2);
		expect(a.operator).toBe('sfr');
	});

	it('cellules distinctes → entrées distinctes', () => {
		const m = worstByCell([
			cell({ cellId: 'a', successRate: 0.5 }),
			cell({ cellId: 'b', successRate: 0.1 })
		]);
		expect(m.size).toBe(2);
		expect(m.get('a')!.rate).toBe(0.5);
		expect(m.get('b')!.rate).toBe(0.1);
	});

	it('conserve lat/lng (centre de cellule)', () => {
		const w = worstByCell([cell({ lat: 43.6, lng: 1.44 })]).get('a')!;
		expect(w.lat).toBe(43.6);
		expect(w.lng).toBe(1.44);
	});

	it('entrée vide → map vide', () => {
		expect(worstByCell([]).size).toBe(0);
	});
});
