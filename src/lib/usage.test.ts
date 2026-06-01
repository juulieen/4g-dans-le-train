import { describe, it, expect } from 'vitest';
import { levelFromKbps } from './usage';

describe('levelFromKbps', () => {
	it('≥ 4000 kbps → TBC (streaming)', () => {
		expect(levelFromKbps(4000)).toBe('TBC');
		expect(levelFromKbps(10_000)).toBe('TBC');
	});

	it('≥ 1000 et < 4000 → BC (web)', () => {
		expect(levelFromKbps(1000)).toBe('BC');
		expect(levelFromKbps(3999)).toBe('BC');
	});

	it('≥ 200 et < 1000 → CL (messages)', () => {
		expect(levelFromKbps(200)).toBe('CL');
		expect(levelFromKbps(999)).toBe('CL');
	});

	it('< 200 → none (trop lent)', () => {
		expect(levelFromKbps(199)).toBe('none');
		expect(levelFromKbps(0)).toBe('none');
	});

	it('null (non mesuré) → none', () => {
		expect(levelFromKbps(null)).toBe('none');
	});
});
