import { describe, expect, it, vi } from 'vitest';
import { supportsWebGL2, type CanvasFactory } from './webgl';

/** Faux `document` dont le canvas renvoie `ctx` (ou lève `error`) pour 'webgl2'. */
function fakeDoc(ctx: unknown, error?: Error) {
	const getContext = vi.fn((kind: string) => {
		if (error) throw error;
		return kind === 'webgl2' ? ctx : null;
	});
	const doc = { createElement: () => ({ getContext }) } as unknown as CanvasFactory;
	return { doc, getContext };
}

describe('supportsWebGL2', () => {
	it('vrai quand un contexte webgl2 est créé, et le libère aussitôt', () => {
		const loseContext = vi.fn();
		const ctx = { getExtension: vi.fn(() => ({ loseContext })) };
		const { doc, getContext } = fakeDoc(ctx);
		expect(supportsWebGL2(doc)).toBe(true);
		expect(getContext).toHaveBeenCalledWith('webgl2');
		expect(ctx.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
		expect(loseContext).toHaveBeenCalledOnce();
	});

	it('vrai même sans extension WEBGL_lose_context', () => {
		const { doc } = fakeDoc({ getExtension: () => null });
		expect(supportsWebGL2(doc)).toBe(true);
	});

	it('faux quand getContext("webgl2") renvoie null', () => {
		expect(supportsWebGL2(fakeDoc(null).doc)).toBe(false);
	});

	it('faux quand getContext lève une exception', () => {
		expect(supportsWebGL2(fakeDoc(null, new Error('bloqué')).doc)).toBe(false);
	});

	it('faux sans DOM (SSR : pas de document global sous vitest node)', () => {
		expect(supportsWebGL2()).toBe(false);
	});
});
