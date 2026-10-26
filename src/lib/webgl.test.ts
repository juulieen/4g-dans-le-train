import { describe, expect, it, vi } from 'vitest';
import { detectWebGL2, type CanvasFactory } from './webgl';

/** Faux `document` dont le canvas renvoie `ctx` (ou lève `error`) pour 'webgl2'. */
function fakeDoc(ctx: unknown, error?: Error) {
	const getContext = vi.fn((kind: string) => {
		if (error) throw error;
		return kind === 'webgl2' ? ctx : null;
	});
	const doc = { createElement: () => ({ getContext }) } as unknown as CanvasFactory;
	return { doc, getContext };
}

describe('detectWebGL2', () => {
	it('vrai quand un contexte webgl2 est créé, et le libère aussitôt', () => {
		const loseContext = vi.fn();
		const ctx = { getExtension: vi.fn(() => ({ loseContext })) };
		const { doc, getContext } = fakeDoc(ctx);
		expect(detectWebGL2(doc)).toBe(true);
		expect(getContext).toHaveBeenCalledWith('webgl2');
		expect(ctx.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
		expect(loseContext).toHaveBeenCalledOnce();
	});

	it('vrai même sans extension WEBGL_lose_context', () => {
		const { doc } = fakeDoc({ getExtension: () => null });
		expect(detectWebGL2(doc)).toBe(true);
	});

	it('vrai même si la libération du contexte de test lève', () => {
		const { doc } = fakeDoc({
			getExtension: () => {
				throw new Error('extension');
			}
		});
		expect(detectWebGL2(doc)).toBe(true);
	});

	it('faux quand getContext("webgl2") renvoie null', () => {
		expect(detectWebGL2(fakeDoc(null).doc)).toBe(false);
	});

	it('faux quand getContext lève une exception', () => {
		expect(detectWebGL2(fakeDoc(null, new Error('bloqué')).doc)).toBe(false);
	});

	it('faux sans DOM (SSR)', () => {
		expect(detectWebGL2(undefined)).toBe(false);
	});
});
