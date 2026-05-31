import { describe, it, expect } from 'vitest';
import { usageFromKbps, USAGE_COLORS } from './usage';

describe('usageFromKbps', () => {
	it('≥ 2000 kbps → streaming (vert TBC)', () => {
		const u = usageFromKbps(2000);
		expect(u.level).toBe('streaming');
		expect(u.color).toBe(USAGE_COLORS.TBC);
	});

	it('≥ 500 et < 2000 → web (vert-clair BC)', () => {
		expect(usageFromKbps(500).level).toBe('web');
		expect(usageFromKbps(1999).level).toBe('web');
		expect(usageFromKbps(500).color).toBe(USAGE_COLORS.BC);
	});

	it('≥ 100 et < 500 → messages (orange CL)', () => {
		expect(usageFromKbps(100).level).toBe('messages');
		expect(usageFromKbps(499).level).toBe('messages');
		expect(usageFromKbps(100).color).toBe(USAGE_COLORS.CL);
	});

	it('< 100 → rien (rouge none)', () => {
		expect(usageFromKbps(99).level).toBe('rien');
		expect(usageFromKbps(0).level).toBe('rien');
		expect(usageFromKbps(99).color).toBe(USAGE_COLORS.none);
	});

	it('null (non mesuré) → rien', () => {
		expect(usageFromKbps(null).level).toBe('rien');
		expect(usageFromKbps(null).color).toBe(USAGE_COLORS.none);
	});
});
