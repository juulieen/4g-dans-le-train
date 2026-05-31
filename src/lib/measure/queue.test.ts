import { describe, it, expect, beforeEach } from 'vitest';
import { MeasurementQueue, type KeyValueStore, type QueuedMeasurement } from './queue';

/** Store en mémoire pour tester la file sans DOM ni localStorage. */
class MemoryStore implements KeyValueStore {
	private map = new Map<string, string>();
	getItem(k: string): string | null {
		return this.map.get(k) ?? null;
	}
	setItem(k: string, v: string): void {
		this.map.set(k, v);
	}
}

function measure(overrides: Partial<QueuedMeasurement> = {}): QueuedMeasurement {
	return {
		lat: 48.85,
		lng: 2.35,
		status: 'ok',
		rttMs: 50,
		jitterMs: 12,
		loss: 0,
		downlinkKbps: null,
		operator: 'orange',
		netType: '4g',
		speedKmh: 120,
		gpsAccuracy: 20,
		measuredAt: 1_700_000_000_000,
		sessionId: 'test-session',
		...overrides
	};
}

describe('MeasurementQueue', () => {
	let store: MemoryStore;
	let queue: MeasurementQueue;

	beforeEach(() => {
		store = new MemoryStore();
		queue = new MeasurementQueue(store);
	});

	it('démarre vide', () => {
		expect(queue.size).toBe(0);
	});

	it('enfile et persiste les mesures (FIFO)', () => {
		queue.enqueue(measure({ status: 'ok' }));
		queue.enqueue(measure({ status: 'none' }));
		expect(queue.size).toBe(2);
		// Persistance : une nouvelle instance sur le même store retrouve la file.
		const reloaded = new MeasurementQueue(store);
		expect(reloaded.size).toBe(2);
	});

	it('conserve les mesures hors-ligne (send échoue) — pas de perte de zone blanche', async () => {
		queue.enqueue(measure({ status: 'none' }));
		queue.enqueue(measure({ status: 'none' }));
		const sent = await queue.flush(async () => false); // réseau coupé
		expect(sent).toBe(0);
		expect(queue.size).toBe(2); // rien n'est perdu
	});

	it('vide la file quand send réussit', async () => {
		queue.enqueue(measure());
		queue.enqueue(measure());
		queue.enqueue(measure());
		const sent = await queue.flush(async () => true);
		expect(sent).toBe(3);
		expect(queue.size).toBe(0);
	});

	it("s'arrête à la première erreur et garde le reste dans l'ordre", async () => {
		queue.enqueue(measure({ rttMs: 1 }));
		queue.enqueue(measure({ rttMs: 2 }));
		queue.enqueue(measure({ rttMs: 3 }));
		// Accepte la 1re, échoue sur la 2e.
		let calls = 0;
		const sent = await queue.flush(async () => {
			calls++;
			return calls === 1;
		});
		expect(sent).toBe(1);
		expect(queue.size).toBe(2);
		// La tête de file est bien l'ancienne 2e mesure (ordre préservé).
		let firstSeen: number | null = null;
		await queue.flush(async (m) => {
			firstSeen ??= m.rttMs;
			return false;
		});
		expect(firstSeen).toBe(2);
	});

	it('borne la taille de la file à 500 (garde les plus récentes)', () => {
		for (let i = 0; i < 520; i++) queue.enqueue(measure({ rttMs: i }));
		expect(queue.size).toBe(500);
		// La plus ancienne restante doit être la mesure #20 (les 20 premières jetées).
		let firstSeen: number | null = null;
		void queue.flush(async (m) => {
			firstSeen ??= m.rttMs;
			return false;
		});
		expect(firstSeen).toBe(20);
	});

	it('clear vide la file', () => {
		queue.enqueue(measure());
		queue.clear();
		expect(queue.size).toBe(0);
	});

	it('résiste à un contenu de storage corrompu', () => {
		store.setItem('4gdt.queue', '{pas du json valide');
		const q = new MeasurementQueue(store);
		expect(q.size).toBe(0); // pas de crash, file vide
		q.enqueue(measure());
		expect(q.size).toBe(1);
	});
});
