import { describe, it, expect, beforeEach } from 'vitest';
import { GapStore, type GapPing, type GapState } from './gapStore';
import type { KeyValueStore } from './queue';

/** Store en mémoire pour tester sans DOM ni localStorage. */
class MemoryStore implements KeyValueStore {
	private map = new Map<string, string>();
	getItem(k: string): string | null {
		return this.map.get(k) ?? null;
	}
	setItem(k: string, v: string): void {
		this.map.set(k, v);
	}
}

const NOW = 1_700_000_000_000;
const MAX_AGE = 5 * 60_000;

function ping(measuredAt: number, overrides: Partial<GapPing> = {}): GapPing {
	return { measuredAt, status: 'none', rttMs: null, netType: null, ...overrides };
}

function state(overrides: Partial<GapState> = {}): GapState {
	return {
		entry: { lat: 48.85, lng: 2.35, accuracy: 20, speedKmh: 250, timestamp: NOW - 60_000 },
		pings: [ping(NOW - 30_000), ping(NOW - 10_000)],
		profileSlug: 'paris-lyon',
		...overrides
	};
}

describe('GapStore', () => {
	let store: MemoryStore;
	let gap: GapStore;

	beforeEach(() => {
		store = new MemoryStore();
		gap = new GapStore(store);
	});

	it('démarre vide', () => {
		expect(gap.load(NOW, MAX_AGE)).toBeNull();
	});

	it('sauvegarde puis restaure le buffer avec ancre et slug (cas refresh)', () => {
		gap.save(state());
		// Persistance : une nouvelle instance sur le même store retrouve tout.
		const restored = new GapStore(store).load(NOW, MAX_AGE);
		expect(restored).not.toBeNull();
		expect(restored!.pings).toHaveLength(2);
		expect(restored!.entry?.lat).toBe(48.85);
		expect(restored!.profileSlug).toBe('paris-lyon');
	});

	it('élague les pings devenus trop vieux pour être recalés', () => {
		gap.save(state({ pings: [ping(NOW - 6 * 60_000), ping(NOW - 30_000)] }));
		const restored = gap.load(NOW, MAX_AGE);
		expect(restored!.pings).toHaveLength(1);
		expect(restored!.pings[0].measuredAt).toBe(NOW - 30_000);
	});

	it("jette une ancre d'entrée périmée mais garde les pings récents (repartent en cold-start)", () => {
		gap.save(
			state({
				entry: { lat: 48.85, lng: 2.35, accuracy: 20, speedKmh: null, timestamp: NOW - 10 * 60_000 }
			})
		);
		const restored = gap.load(NOW, MAX_AGE);
		expect(restored).not.toBeNull();
		expect(restored!.entry).toBeNull();
		expect(restored!.pings).toHaveLength(2);
	});

	it("renvoie null s'il ne reste aucun ping utile", () => {
		gap.save(state({ pings: [ping(NOW - 20 * 60_000)] }));
		expect(gap.load(NOW, MAX_AGE)).toBeNull();
	});

	it('clear vide la sauvegarde', () => {
		gap.save(state());
		gap.clear();
		expect(gap.load(NOW, MAX_AGE)).toBeNull();
	});

	it('résiste à un contenu de storage corrompu', () => {
		store.setItem('4gdt.gap', '{pas du json valide');
		expect(gap.load(NOW, MAX_AGE)).toBeNull(); // pas de crash
	});
});
