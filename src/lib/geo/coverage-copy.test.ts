import { describe, it, expect } from 'vitest';
import {
	buildVerdict,
	blackspotLabel,
	groupBlackspots,
	buildBlackspots,
	freshnessLabel,
	clip,
	elideQue
} from './coverage-copy';
import type { LineStats } from './line-stats';
import type { LineReal, Blackspot } from './line-real';

const stats = (over: Partial<LineStats> = {}): LineStats => ({
	lengthKm: 100,
	arcep: {
		orange: { TBC: 0.9, BC: 0.05, CL: 0.03, none: 0.02 },
		sfr: { TBC: 0.8, BC: 0.1, CL: 0.05, none: 0.05 },
		free: { TBC: 0.7, BC: 0.1, CL: 0.1, none: 0.1 },
		bouygues: { TBC: 0.8, BC: 0.1, CL: 0.05, none: 0.05 }
	},
	best: { TBC: 0.92, BC: 0.05, CL: 0.02, none: 0.01 },
	zonesBlanches: { count: 0, zones: [] },
	...over
});

const real = (over: Partial<LineReal> = {}): LineReal => ({
	samples: 0,
	nFiables: 0,
	coveragePct: 0,
	sufficient: false,
	lastSeen: 0,
	goodPct: 0,
	bestOperator: null,
	operatorMix: null,
	blackspots: [],
	...over
});

const spot = (over: Partial<Blackspot> = {}): Blackspot => ({
	afterStation: 'Angoulême',
	distKm: 5,
	durationS: 0,
	lengthM: 2000,
	source: 'measured',
	...over
});

describe('buildVerdict', () => {
	it('réel suffisant → verdict « d’après les voyageurs », mention coupures et opérateur', () => {
		const v = buildVerdict(
			'Bordeaux',
			'Angoulême',
			stats(),
			real({
				sufficient: true,
				goodPct: 88,
				samples: 3352,
				bestOperator: 'orange',
				blackspots: [spot({ durationS: 120 })]
			})
		);
		expect(v.measured).toBe(true);
		expect(v.tone).toBe('good');
		expect(v.lead).toContain('88');
		expect(v.lead).toContain('les voyageurs');
		expect(v.cuts).toContain('Angoulême');
		expect(v.best).toContain('Orange');
	});

	it('réel suffisant + écart fort → phrase de comparaison annoncé/réel', () => {
		const v = buildVerdict(
			'A',
			'B',
			stats(),
			real({ sufficient: true, goodPct: 60, samples: 500 })
		);
		// ARCEP best.TBC = 92 %, réel 60 % → écart ≥ 10 → gap présent.
		expect(v.gap).not.toBeNull();
		expect(v.gap).toContain('92');
		expect(v.gap).toContain('60');
		expect(v.tone).toBe('mixed');
	});

	it('réel insuffisant → verdict ARCEP + invite à mesurer', () => {
		const v = buildVerdict(
			'A',
			'B',
			stats(),
			real({ sufficient: false, samples: 40, coveragePct: 12 })
		);
		expect(v.measured).toBe(false);
		expect(v.tone).toBe('unknown');
		expect(v.lead).toContain('annoncé');
		expect(v.source).toContain('partielles');
	});

	it('aucune mesure → invite « soyez le premier »', () => {
		const v = buildVerdict('A', 'B', stats(), real());
		expect(v.source).toContain('premier');
	});

	it('tonalité « bad » (goodPct faible) → PAS « capte bien »', () => {
		const v = buildVerdict(
			'A',
			'B',
			stats(),
			real({ sufficient: true, goodPct: 25, samples: 500 })
		);
		expect(v.tone).toBe('bad');
		expect(v.lead).toContain('ça capte mal');
		expect(v.lead).not.toContain('capte bien');
	});

	it('tonalité « mixed » → « inégale »', () => {
		const v = buildVerdict(
			'A',
			'B',
			stats(),
			real({ sufficient: true, goodPct: 55, samples: 500 })
		);
		expect(v.tone).toBe('mixed');
		expect(v.lead).toContain('inégale');
		expect(v.lead).not.toContain('capte bien');
	});

	it('variante opérateur (réel suffisant) → phrase « avec {op} », pas de « au mieux »', () => {
		const v = buildVerdict(
			'Bordeaux',
			'Angoulême',
			stats(),
			real({ sufficient: true, goodPct: 90, samples: 500, bestOperator: 'orange' }),
			{
				operatorName: 'Orange',
				arcepDist: { TBC: 0.95, BC: 0.03, CL: 0.01, none: 0.01 }
			}
		);
		expect(v.lead).toContain('avec Orange');
		expect(v.best).toBeNull();
		// gap compare au TBC de l'opérateur (95 %) vs réel (90 %) → < 10 → pas de gap.
		expect(v.gap).toBeNull();
	});

	it('variante opérateur (réel insuffisant) → « Avec {op} … annoncé »', () => {
		const v = buildVerdict('A', 'B', stats(), real({ sufficient: false }), {
			operatorName: 'SFR',
			arcepDist: { TBC: 0.6, BC: 0.2, CL: 0.1, none: 0.1 }
		});
		expect(v.lead).toContain('Avec SFR');
		expect(v.lead).toContain('80'); // (TBC+BC) = 80 %
	});
});

describe('blackspotLabel', () => {
	it('coupure avec durée → « ça coupe ~N »', () => {
		const l = blackspotLabel(spot({ durationS: 120, lengthM: 1500 }));
		expect(l.head).toContain('ça coupe');
		expect(l.head).toContain('min');
		expect(l.detail).toContain('km');
	});
	it('zone sans durée → « pas de réseau »', () => {
		const l = blackspotLabel(spot({ durationS: 0, lengthM: 800 }));
		expect(l.head).toContain('pas de réseau');
	});
});

describe('groupBlackspots', () => {
	it('plusieurs coupures à la même gare → une seule entrée « Après … »', () => {
		const g = groupBlackspots([
			spot({ afterStation: 'Angoulême', distKm: 5, durationS: 120, lengthM: 4800 }),
			spot({ afterStation: 'Angoulême', distKm: 10, durationS: 40, lengthM: 2300 }),
			spot({ afterStation: 'Angoulême', distKm: 15, durationS: 30, lengthM: 1500 })
		]);
		expect(g).toHaveLength(1);
		expect(g[0].head).toContain('Après Angoulême');
		expect(g[0].head).toContain('3 coupures');
		expect(g[0].detail).toContain('la plus longue');
	});
	it('coupures à des gares différentes → entrées distinctes', () => {
		const g = groupBlackspots([
			spot({ afterStation: 'Angoulême', durationS: 120 }),
			spot({ afterStation: 'Libourne', durationS: 60 })
		]);
		expect(g).toHaveLength(2);
	});
});

describe('buildBlackspots', () => {
	it('réel mesuré → coupures regroupées', () => {
		const r = buildBlackspots(
			real({ blackspots: [spot({ durationS: 120 }), spot({ durationS: 40 })] }),
			stats()
		);
		expect(r[0].head).toContain('Après Angoulême');
	});
	it('réel vide → repli zones blanches ARCEP', () => {
		const r = buildBlackspots(
			real({ blackspots: [] }),
			stats({ zonesBlanches: { count: 1, zones: [{ after: 'Vierzon', lengthKm: 5 }] } })
		);
		expect(r).toHaveLength(1);
		expect(r[0].head).toContain('Vierzon');
		expect(r[0].head).toContain('aucun réseau annoncé');
	});
});

describe('freshnessLabel', () => {
	const day = 86400;
	it('jamais mesuré → null', () => {
		expect(freshnessLabel(0, 1000 * day)).toBeNull();
	});
	it('aujourd’hui / hier / il y a N jours', () => {
		expect(freshnessLabel(1000 * day, 1000 * day)).toContain("aujourd'hui");
		expect(freshnessLabel(1000 * day - 1 * day, 1000 * day)).toBe('mesuré hier');
		expect(freshnessLabel(1000 * day - 5 * day, 1000 * day)).toContain('il y a 5 jours');
	});
});

describe('clip', () => {
	it('chaîne courte → inchangée', () => {
		expect(clip('court', 100)).toBe('court');
	});
	it('chaîne longue → coupée au mot + « … »', () => {
		const out = clip('le réseau coupe souvent après Angoulême', 20);
		expect(out.length).toBeLessThanOrEqual(21);
		expect(out.endsWith('…')).toBe(true);
		expect(out).not.toContain('souv'); // le mot tronqué « souv(ent) » a été retiré
	});
});

describe('elideQue', () => {
	it("voyelle → qu'", () => {
		expect(elideQue('Orange')).toBe("qu'Orange");
	});
	it('consonne → que', () => {
		expect(elideQue('SFR')).toBe('que SFR');
		expect(elideQue('Bouygues')).toBe('que Bouygues');
	});
});

describe('buildVerdict — biais opérateur', () => {
	it('mesures concentrées sur un opérateur (≥ 70 %) → « (principalement …) »', () => {
		const v = buildVerdict(
			'A',
			'B',
			stats(),
			real({
				sufficient: true,
				goodPct: 90,
				samples: 1000,
				operatorMix: { operator: 'orange', share: 0.95 }
			})
		);
		expect(v.source).toContain('principalement Orange');
	});
});
