import { describe, it, expect } from 'vitest';
import {
	encodeImuChunk,
	decodeImuChunk,
	bundleToJson,
	traceFilename,
	type TraceMeta,
	type TraceBundle
} from './exportTrace';
import type { ImuSample } from './motion';

const T0 = 1_700_000_000_000;

function sample(t: number, v: number): ImuSample {
	return { t, ax: v, ay: -v, az: 9.81, rax: v / 10, ray: null, raz: 0 };
}

describe('encodeImuChunk / decodeImuChunk', () => {
	it('round-trip : décoder rend les échantillons (timestamps exacts, valeurs arrondies)', () => {
		const samples = [sample(T0, 1.23456), sample(T0 + 100, -2.5), sample(T0 + 201, 0)];
		const decoded = decodeImuChunk(encodeImuChunk(samples));
		expect(decoded).toHaveLength(3);
		expect(decoded.map((s) => s.t)).toEqual([T0, T0 + 100, T0 + 201]);
		expect(decoded[0].ax).toBeCloseTo(1.235, 3); // arrondi 3 décimales
		expect(decoded[1].ay).toBe(2.5);
		expect(decoded[0].ray).toBeNull(); // les null traversent l'encodage
	});

	it('delta-encode les timestamps depuis t0 (ms entiers)', () => {
		const chunk = encodeImuChunk([sample(T0 + 0.4, 1), sample(T0 + 100.6, 1)]);
		expect(chunk.t0).toBe(T0);
		expect(chunk.dt).toEqual([0, 101]); // arrondis à la ms, cumul cohérent
	});

	it('chunk vide : t0 à 0, colonnes vides', () => {
		const chunk = encodeImuChunk([]);
		expect(chunk.dt).toEqual([]);
		expect(decodeImuChunk(chunk)).toEqual([]);
	});
});

describe('bundle et nom de fichier', () => {
	const meta: TraceMeta = {
		id: 'abc',
		startedAt: new Date(2026, 5, 12, 9, 5).getTime(), // 12 juin 2026 09:05 locale
		timeOrigin: T0,
		operator: 'sfr',
		lineSlug: 'paris-lyon',
		userAgent: 'test',
		imuHz: 10,
		accelField: 'accelerationIncludingGravity',
		schemaVersion: 1
	};

	it('bundleToJson : round-trip JSON complet', () => {
		const bundle: TraceBundle = {
			meta,
			imu: [encodeImuChunk([sample(T0, 1)])],
			windows: [{ t0: T0, t1: T0 + 1000, n: 60, accMean: 9.8, accStd: 0.2, rotStd: 1.1 }],
			gps: [{ t: T0, lat: 48.85, lng: 2.35, accuracy: 450, speedKmh: null }],
			events: [{ type: 'start', t: T0 }]
		};
		const parsed = JSON.parse(bundleToJson(bundle)) as TraceBundle;
		expect(parsed).toEqual(bundle);
		// Les fixes BRUTS au-delà du filtre de précision (300 m) doivent être présents.
		expect(parsed.gps[0].accuracy).toBe(450);
	});

	it('traceFilename : slug + horodatage local', () => {
		expect(traceFilename(meta)).toBe('trace-paris-lyon-20260612-0905.json');
		expect(traceFilename({ ...meta, lineSlug: null })).toBe(
			'trace-ligne-inconnue-20260612-0905.json'
		);
	});
});
