import { describe, it, expect } from 'vitest';
import {
	segmentCoords,
	buildLineSegments,
	buildArcepLineFeatures,
	pathBounds,
	type SegmentCell,
	type ArcepProfileSegment
} from './coverage-segments';
import type { PathPoint } from './geo/interpolate';

// Tracé droit (latitude constante) ; distKm explicite et croissant. Les longitudes
// sont espacées de 0,02° (~1,5 km à cette latitude) → cellules posées sur les sommets.
const PATH: PathPoint[] = [
	[0.0, 45, 0],
	[0.02, 45, 2],
	[0.04, 45, 4],
	[0.06, 45, 6],
	[0.08, 45, 8],
	[0.1, 45, 10]
];

const cell = (over: Partial<SegmentCell>): SegmentCell => ({
	rate: 1,
	samples: 1,
	operator: 'orange',
	lat: 45,
	lng: 0,
	...over
});

const noConsecutiveDups = (coords: [number, number][]) =>
	coords.every((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]);

describe('segmentCoords', () => {
	it('renvoie au moins 2 points sans doublon consécutif', () => {
		const coords = segmentCoords(PATH, 1, 5);
		expect(coords.length).toBeGreaterThanOrEqual(2);
		expect(noConsecutiveDups(coords)).toBe(true);
	});

	it('aux extrémités (PAD clampé), pas de point dégénéré', () => {
		// fromKm sous le 1er point → positionAtDist clampe sur path[0], qui est aussi
		// poussé comme point intermédiaire (d=0) : doit être dédoublonné.
		const coords = segmentCoords(PATH, -0.09, 0.09);
		expect(noConsecutiveDups(coords)).toBe(true);
		expect(coords.length).toBeGreaterThanOrEqual(2);
	});
});

describe('buildLineSegments', () => {
	it('cellules adjacentes de même niveau → un seul segment (run-length)', () => {
		const feats = buildLineSegments(
			PATH,
			[cell({ lng: 0, rate: 1 }), cell({ lng: 0.02, rate: 0.9, samples: 2 })],
			'ligne'
		);
		expect(feats).toHaveLength(1);
		const p = feats[0].properties!;
		expect(p.quality).toBe('TBC');
		expect(p.samples).toBe(3); // 1 + 2
		expect(p.worstRate).toBe(0.9); // pire des deux
	});

	it('niveaux différents → segments distincts', () => {
		const feats = buildLineSegments(
			PATH,
			[cell({ lng: 0, rate: 1 }), cell({ lng: 0.02, rate: 0.5 })],
			'ligne'
		);
		expect(feats).toHaveLength(2);
		expect(feats.map((f) => f.properties!.quality).sort()).toEqual(['CL', 'TBC']);
	});

	it('trou > MAX_GAP_KM coupe le ruban même à niveau égal', () => {
		// distKm 0 puis 8 → écart 8 km > 3 km.
		const feats = buildLineSegments(
			PATH,
			[cell({ lng: 0, rate: 1 }), cell({ lng: 0.08, rate: 1 })],
			'ligne'
		);
		expect(feats).toHaveLength(2);
	});

	it('cellule trop loin du tracé → ignorée (offset > MAX_OFFSET_M)', () => {
		// lat 45,05 ≈ 5,5 km du tracé → écartée ; reste 1 cellule → 1 segment.
		const feats = buildLineSegments(
			PATH,
			[cell({ lng: 0, lat: 45, rate: 1, samples: 4 }), cell({ lng: 0.02, lat: 45.05, rate: 1 })],
			'ligne'
		);
		expect(feats).toHaveLength(1);
		expect(feats[0].properties!.samples).toBe(4); // seule la cellule proche compte
	});

	it('cellule isolée → segment valide (≥ 2 points, paddé)', () => {
		const feats = buildLineSegments(PATH, [cell({ lng: 0.04, rate: 1 })], 'ligne');
		expect(feats).toHaveLength(1);
		const coords = (feats[0].geometry as GeoJSON.LineString).coordinates as [number, number][];
		expect(coords.length).toBeGreaterThanOrEqual(2);
		expect(noConsecutiveDups(coords)).toBe(true);
	});

	it('tracé < 2 points → aucun segment', () => {
		expect(buildLineSegments([[0, 45, 0]], [cell({})], 'ligne')).toEqual([]);
	});

	it('aucune cellule → aucun segment', () => {
		expect(buildLineSegments(PATH, [], 'ligne')).toEqual([]);
	});

	it('reporte le lineSlug dans les propriétés', () => {
		const feats = buildLineSegments(PATH, [cell({ lng: 0 })], 'paris-arcachon');
		expect(feats[0].properties!.lineSlug).toBe('paris-arcachon');
	});
});

describe('buildArcepLineFeatures', () => {
	const seg = (over: Partial<ArcepProfileSegment>): ArcepProfileSegment => ({
		fromKm: 0,
		toKm: 4,
		orange: 'TBC',
		sfr: 'TBC',
		free: 'TBC',
		bouygues: 'TBC',
		best: 'TBC',
		...over
	});

	it('un segment ARCEP → une Feature LineString portant les niveaux par opérateur', () => {
		const feats = buildArcepLineFeatures(PATH, [
			seg({ fromKm: 0, toKm: 4, best: 'BC', orange: 'CL' })
		]);
		expect(feats).toHaveLength(1);
		expect(feats[0].geometry.type).toBe('LineString');
		const coords = (feats[0].geometry as GeoJSON.LineString).coordinates as [number, number][];
		expect(coords.length).toBeGreaterThanOrEqual(2);
		expect(noConsecutiveDups(coords)).toBe(true);
		expect(feats[0].properties!.best).toBe('BC');
		expect(feats[0].properties!.orange).toBe('CL');
	});

	it('plusieurs segments → autant de Features', () => {
		const feats = buildArcepLineFeatures(PATH, [
			seg({ fromKm: 0, toKm: 4, best: 'TBC' }),
			seg({ fromKm: 4, toKm: 8, best: 'none' })
		]);
		expect(feats).toHaveLength(2);
		expect(feats.map((f) => f.properties!.best)).toEqual(['TBC', 'none']);
	});

	it('segment dégénéré (longueur nulle) → ignoré', () => {
		const feats = buildArcepLineFeatures(PATH, [seg({ fromKm: 2, toKm: 2 })]);
		expect(feats).toEqual([]);
	});

	it('tracé < 2 points → aucune Feature', () => {
		expect(buildArcepLineFeatures([[0, 45, 0]], [seg({})])).toEqual([]);
	});
});

describe('pathBounds', () => {
	it('renvoie [[minLng,minLat],[maxLng,maxLat]]', () => {
		expect(
			pathBounds([
				[2, 48, 0],
				[4, 45, 10],
				[3, 46, 5]
			])
		).toEqual([
			[2, 45],
			[4, 48]
		]);
	});

	it('tracé vide → [[0,0],[0,0]] (garde, pas d’Infinity)', () => {
		expect(pathBounds([])).toEqual([
			[0, 0],
			[0, 0]
		]);
	});
});
