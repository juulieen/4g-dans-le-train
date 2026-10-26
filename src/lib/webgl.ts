/**
 * Détection de WebGL2, requis par MapLibre GL JS ≥ 6 (WebGL1 n'est plus pris en charge).
 *
 * Sans WebGL2 (vieux navigateur, GPU en liste noire, accélération matérielle désactivée,
 * certains modes « durcis »), `new maplibregl.Map()` lève une exception et la carte reste
 * vide : on teste donc AVANT de créer la carte pour afficher un message de repli.
 *
 * Le contexte de test est libéré aussitôt (`WEBGL_lose_context`) : les navigateurs
 * plafonnent le nombre de contextes WebGL actifs (~16) et évincent les plus anciens.
 */

/** Sous-ensemble de `Document` utilisé (injectable pour les tests unitaires). */
export interface CanvasFactory {
	createElement(tag: 'canvas'): Pick<HTMLCanvasElement, 'getContext'>;
}

export function supportsWebGL2(doc: CanvasFactory | undefined = globalThis.document): boolean {
	if (!doc) return false; // SSR / environnement sans DOM
	try {
		const ctx = doc.createElement('canvas').getContext('webgl2');
		if (!ctx) return false;
		ctx.getExtension('WEBGL_lose_context')?.loseContext();
		return true;
	} catch {
		// Certains navigateurs lèvent au lieu de renvoyer null (politique de sécurité…).
		return false;
	}
}
