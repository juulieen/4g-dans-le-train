import { describe, it, expect } from 'vitest';
import {
	projectOntoPath,
	positionAtDist,
	reconstructAlongPath,
	type PathPoint
} from './interpolate';

/**
 * Tracé synthétique : segment est-ouest le long du parallèle 48°, du méridien 2°
 * au méridien 2.1° (~7,4 km à cette latitude). On l'échantillonne en 3 points avec
 * des abscisses arbitraires pour vérifier que `distKm` suit bien le tracé.
 */
const PATH: PathPoint[] = [
	[2.0, 48.0, 0],
	[2.05, 48.0, 5],
	[2.1, 48.0, 10]
];

describe('projectOntoPath', () => {
	it('projette un point sur le tracé avec un offset quasi nul', () => {
		const p = projectOntoPath(PATH, 48.0, 2.05);
		expect(p.distKm).toBeCloseTo(5, 5);
		expect(p.offsetM).toBeLessThan(1);
	});

	it("mesure l'écart perpendiculaire en mètres (point au nord du tracé)", () => {
		// ~0.01° de latitude au nord ≈ 1,11 km.
		const p = projectOntoPath(PATH, 48.01, 2.05);
		expect(p.distKm).toBeCloseTo(5, 2);
		expect(p.offsetM).toBeGreaterThan(1000);
		expect(p.offsetM).toBeLessThan(1200);
	});

	it('clampe aux extrémités (point avant le début du tracé)', () => {
		const p = projectOntoPath(PATH, 48.0, 1.9);
		expect(p.distKm).toBe(0); // pied de perpendiculaire = 1er sommet
	});

	it('distKm est monotone croissant le long du tracé', () => {
		const a = projectOntoPath(PATH, 48.0, 2.01).distKm;
		const b = projectOntoPath(PATH, 48.0, 2.06).distKm;
		expect(b).toBeGreaterThan(a);
	});
});

describe('positionAtDist', () => {
	it('retrouve la position à une abscisse interne', () => {
		const pos = positionAtDist(PATH, 5);
		expect(pos.lng).toBeCloseTo(2.05, 6);
		expect(pos.lat).toBeCloseTo(48.0, 6);
	});

	it('interpole au milieu d’un segment', () => {
		const pos = positionAtDist(PATH, 2.5); // moitié du 1er segment (0→5 km)
		expect(pos.lng).toBeCloseTo(2.025, 4);
	});

	it('clampe en dessous et au-dessus de la plage', () => {
		expect(positionAtDist(PATH, -1)).toEqual({ lat: 48.0, lng: 2.0 });
		expect(positionAtDist(PATH, 999)).toEqual({ lat: 48.0, lng: 2.1 });
	});
});

describe('aller-retour projection ↔ position', () => {
	it('reprojeter une position interpolée redonne la même abscisse', () => {
		const pos = positionAtDist(PATH, 3.7);
		const back = projectOntoPath(PATH, pos.lat, pos.lng);
		expect(back.distKm).toBeCloseTo(3.7, 3);
		expect(back.offsetM).toBeLessThan(1);
	});
});

describe('reconstructAlongPath', () => {
	const OPTS = { maxSpanMs: 5 * 60_000, snapMaxM: 1_000 };
	// Ancres sur le tracé : entrée à distKm 0 (t=0), sortie à distKm 10 (t=100s).
	const entry = { lat: 48.0, lng: 2.0, t: 0 };
	const exit = { lat: 48.0, lng: 2.1, t: 100_000 };

	it('INTERPOLE un instant entre les deux ancres (cas tunnel)', () => {
		// t = 50 s → moitié du trajet → distKm 5 → lng 2.05.
		const out = reconstructAlongPath(PATH, entry, exit, [50_000], OPTS);
		expect(out).not.toBeNull();
		expect(out!.positions[0]!.lng).toBeCloseTo(2.05, 4);
	});

	it('renvoie la vitesse moyenne le long du tracé entre les deux ancres', () => {
		// 10 km parcourus en 100 s → 360 km/h (un TGV lancé, plausible).
		const out = reconstructAlongPath(PATH, entry, exit, [50_000], OPTS);
		expect(out!.speedKmh).toBeCloseTo(360, 1);
	});

	it('la vitesse est positive même pour un trajet en sens inverse', () => {
		const revEntry = { lat: 48.0, lng: 2.1, t: 0 };
		const revExit = { lat: 48.0, lng: 2.0, t: 100_000 };
		const out = reconstructAlongPath(PATH, revEntry, revExit, [50_000], OPTS);
		expect(out!.speedKmh).toBeCloseTo(360, 1);
	});

	it('EXTRAPOLE en arrière un instant antérieur à l’entrée (cas cold-start)', () => {
		// t = −50 s (avant l'entrée) avec un trajet à +10 km / 100 s vers les lng croissants
		// → distKm = 0 + (10/100s) × (−50s) = −5 km → clampé au début du tracé (lng 2.0).
		const out = reconstructAlongPath(PATH, entry, exit, [-50_000], OPTS);
		expect(out).not.toBeNull();
		expect(out!.positions[0]!.lng).toBeCloseTo(2.0, 6); // borné au 1er sommet
	});

	it('respecte le SENS du trajet pour l’extrapolation arrière', () => {
		// Trajet inverse : entrée à distKm 10, sortie à distKm 0 (lng décroissants).
		const revEntry = { lat: 48.0, lng: 2.1, t: 0 };
		const revExit = { lat: 48.0, lng: 2.0, t: 100_000 };
		// t = −20 s → distKm = 10 + (−10/100s)(−20s) = 12 → clampé à la fin (lng 2.1).
		const out = reconstructAlongPath(PATH, revEntry, revExit, [-20_000], OPTS);
		expect(out!.positions[0]!.lng).toBeCloseTo(2.1, 6);
	});

	it('rejette (null) un tracé dégénéré (< 2 points : rien le long de quoi interpoler)', () => {
		expect(reconstructAlongPath([], entry, exit, [50_000], OPTS)).toBeNull();
		expect(reconstructAlongPath([[2.0, 48.0, 0]], entry, exit, [50_000], OPTS)).toBeNull();
	});

	it('rejette (null) si les ancres sont espacées de plus de maxSpanMs', () => {
		const farExit = { ...exit, t: 6 * 60_000 };
		expect(reconstructAlongPath(PATH, entry, farExit, [0], OPTS)).toBeNull();
	});

	it('rejette (null) si une ancre est trop loin du tracé (hors rails)', () => {
		const offRails = { lat: 49.0, lng: 2.05, t: 100_000 }; // ~110 km au nord
		expect(reconstructAlongPath(PATH, entry, offRails, [50_000], OPTS)).toBeNull();
	});

	it('ignore (null) un instant à plus de maxSpanMs de l’entrée mais place les autres', () => {
		const out = reconstructAlongPath(PATH, entry, exit, [-6 * 60_000, 50_000], OPTS);
		expect(out).not.toBeNull();
		expect(out!.positions[0]).toBeNull(); // trop lointain
		expect(out!.positions[1]).not.toBeNull(); // placé
	});
});
