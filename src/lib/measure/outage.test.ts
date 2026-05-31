import { describe, it, expect } from 'vitest';
import { OutageDetector, detectOutages, type OutageSample } from './outage';

/** Fabrique un échantillon ; position par défaut fixe (Paris), 10 s d'intervalle. */
function sample(
	measuredAt: number,
	status: OutageSample['status'],
	o: Partial<OutageSample> = {}
): OutageSample {
	return { measuredAt, status, lat: 48.85, lng: 2.35, speedKmh: 120, ...o };
}

/** Pousse une séquence dans un détecteur et collecte les épisodes (avec finalize). */
function run(samples: OutageSample[]) {
	const d = new OutageDetector();
	const out = [];
	for (const s of samples) {
		const ep = d.observe(s);
		if (ep) out.push(ep);
	}
	const last = d.finalize();
	if (last) out.push(last);
	return out;
}

const S = 1000;

describe('OutageDetector', () => {
	it('détecte une coupure simple ok → none… → ok et calcule sa durée', () => {
		const eps = run([
			sample(0, 'ok'),
			sample(10 * S, 'none'),
			sample(20 * S, 'none'),
			sample(30 * S, 'none'),
			sample(40 * S, 'ok')
		]);
		expect(eps).toHaveLength(1);
		expect(eps[0].startedAt).toBe(10 * S);
		expect(eps[0].endedAt).toBe(40 * S);
		expect(eps[0].durationS).toBe(30);
		expect(eps[0].terminated).toBe(true);
	});

	it('garde un `none` isolé d’un seul échantillon (épisode court, informatif)', () => {
		const eps = run([sample(0, 'ok'), sample(10 * S, 'none'), sample(20 * S, 'ok')]);
		expect(eps).toHaveLength(1);
		expect(eps[0].durationS).toBe(10);
	});

	it('distingue deux coupures séparées dans une même session', () => {
		const eps = run([
			sample(0, 'ok'),
			sample(10 * S, 'none'),
			sample(20 * S, 'ok'),
			sample(30 * S, 'degraded'),
			sample(40 * S, 'none'),
			sample(50 * S, 'none'),
			sample(60 * S, 'ok')
		]);
		expect(eps).toHaveLength(2);
		expect(eps[0].durationS).toBe(10);
		expect(eps[1].durationS).toBe(20);
	});

	it('clôt proprement une coupure encore en cours via finalize (non terminée)', () => {
		const eps = run([sample(0, 'ok'), sample(10 * S, 'none'), sample(20 * S, 'none')]);
		expect(eps).toHaveLength(1);
		expect(eps[0].terminated).toBe(false);
		expect(eps[0].endedAt).toBe(20 * S);
		expect(eps[0].durationS).toBe(10);
	});

	it('ne déclenche aucune coupure sur degraded seul', () => {
		const eps = run([sample(0, 'ok'), sample(10 * S, 'degraded'), sample(20 * S, 'ok')]);
		expect(eps).toHaveLength(0);
	});

	it('GPS figé pendant la coupure : longueur estimée via vitesse × durée', () => {
		// Positions identiques (tunnel), vitesse 36 km/h = 10 m/s, durée 30 s → ~300 m.
		const frozen = { lat: 48.85, lng: 2.35, speedKmh: 36 };
		const eps = run([
			sample(0, 'ok'),
			sample(10 * S, 'none', frozen),
			sample(20 * S, 'none', frozen),
			sample(30 * S, 'none', frozen),
			sample(40 * S, 'ok', frozen)
		]);
		expect(eps).toHaveLength(1);
		expect(eps[0].lengthM).toBe(300);
	});

	it('GPS mobile : longueur = distance parcourue (path), supérieure au fallback', () => {
		// Déplacement réel le long d'une ligne, vitesse nulle déclarée → path domine.
		const eps = run([
			sample(0, 'ok'),
			sample(10 * S, 'none', { lat: 48.85, lng: 2.35, speedKmh: 0 }),
			sample(20 * S, 'none', { lat: 48.86, lng: 2.36, speedKmh: 0 }),
			sample(30 * S, 'ok', { lat: 48.87, lng: 2.37, speedKmh: 0 })
		]);
		expect(eps).toHaveLength(1);
		expect(eps[0].lengthM).toBeGreaterThan(2000); // ~2,7 km sur ce tracé
		expect(eps[0].cellStart).not.toBeNull();
		expect(eps[0].cellEnd).not.toBeNull();
	});

	it('cohérence batch / streaming : detectOutages == observe/finalize', () => {
		const seq = [
			sample(0, 'ok'),
			sample(10 * S, 'none'),
			sample(20 * S, 'none'),
			sample(30 * S, 'ok'),
			sample(40 * S, 'none')
		];
		expect(detectOutages(seq)).toEqual(run(seq));
	});

	it('detectOutages ordonne les échantillons reçus dans le désordre', () => {
		const ordered = detectOutages([
			sample(30 * S, 'ok'),
			sample(0, 'ok'),
			sample(20 * S, 'none'),
			sample(10 * S, 'none')
		]);
		expect(ordered).toHaveLength(1);
		expect(ordered[0].startedAt).toBe(10 * S);
		expect(ordered[0].durationS).toBe(20);
	});
});
