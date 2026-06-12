import { describe, it, expect } from 'vitest';
import { vectorNorm, emptyWindow, pushToWindow, finalizeWindow } from './motion';

describe('vectorNorm', () => {
	it('calcule la norme euclidienne', () => {
		expect(vectorNorm(3, 4, 0)).toBe(5);
		expect(vectorNorm(0, 0, 9.81)).toBeCloseTo(9.81);
	});

	it('renvoie null dès qu une composante manque', () => {
		expect(vectorNorm(null, 4, 0)).toBeNull();
		expect(vectorNorm(3, null, 0)).toBeNull();
		expect(vectorNorm(3, 4, null)).toBeNull();
	});
});

describe('agrégation de fenêtre', () => {
	const T0 = 1_700_000_000_000;

	it('fenêtre vide → null', () => {
		expect(finalizeWindow(emptyWindow(T0))).toBeNull();
	});

	it('moyenne et écart-type sur une série constante (train à l arrêt)', () => {
		// À l'arrêt en gare : ‖acc‖ ≈ gravité constante, rotation nulle → écarts-types ~0.
		const acc = emptyWindow(T0);
		for (let i = 0; i < 60; i++) pushToWindow(acc, T0 + i * 16, 9.81, 0);
		const w = finalizeWindow(acc)!;
		expect(w.n).toBe(60);
		expect(w.t0).toBe(T0);
		expect(w.t1).toBe(T0 + 59 * 16);
		expect(w.accMean).toBeCloseTo(9.81);
		expect(w.accStd).toBeCloseTo(0);
		expect(w.rotStd).toBeCloseTo(0);
	});

	it('écart-type non nul sur une série qui vibre (train en marche)', () => {
		// En roulement : ‖acc‖ oscille autour de la gravité → accStd > 0.
		const acc = emptyWindow(T0);
		for (let i = 0; i < 60; i++) {
			pushToWindow(acc, T0 + i * 16, 9.81 + (i % 2 === 0 ? 1 : -1), i % 2 === 0 ? 2 : 0);
		}
		const w = finalizeWindow(acc)!;
		expect(w.accMean).toBeCloseTo(9.81);
		expect(w.accStd).toBeCloseTo(1);
		expect(w.rotStd).toBeCloseTo(1);
	});

	it('écart-type exact sur une petite série de référence', () => {
		// Série {2, 4, 4, 4, 5, 5, 7, 9} : moyenne 5, écart-type (population) 2.
		const acc = emptyWindow(T0);
		for (const [i, v] of [2, 4, 4, 4, 5, 5, 7, 9].entries()) {
			pushToWindow(acc, T0 + i, v, null);
		}
		const w = finalizeWindow(acc)!;
		expect(w.accMean).toBeCloseTo(5);
		expect(w.accStd).toBeCloseTo(2);
	});

	it('ignore les normes manquantes sans fausser les stats', () => {
		const acc = emptyWindow(T0);
		pushToWindow(acc, T0, 10, null);
		pushToWindow(acc, T0 + 16, null, null); // capteur muet sur cet événement
		pushToWindow(acc, T0 + 32, 10, null);
		const w = finalizeWindow(acc)!;
		expect(w.n).toBe(3); // tous les événements comptent dans n…
		expect(w.accMean).toBeCloseTo(10); // …mais seuls les présents dans les stats
		expect(w.accStd).toBeCloseTo(0);
	});
});
