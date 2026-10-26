/**
 * Détection de WebGL2, requis par MapLibre GL JS ≥ 6 (WebGL1 n'est plus pris en charge).
 *
 * Sans WebGL2 (vieux navigateur, GPU en liste noire, accélération matérielle désactivée,
 * certains modes « durcis »), `new maplibregl.Map()` lève une exception et la carte reste
 * vide : on teste donc AVANT de créer la carte pour afficher un message de repli.
 *
 * Le contexte de test est libéré aussitôt (`WEBGL_lose_context`) : les navigateurs
 * plafonnent le nombre de contextes WebGL actifs (~16) et évincent les plus anciens.
 * Effet de bord assumé : Chrome journalise alors « WebGL: CONTEXT_LOST_WEBGL: loseContext »
 * en console. Le résultat est mis en cache (un seul contexte de test par page, même si
 * `MapPreview` puis `Map` interrogent tous deux).
 */

/** Sous-ensemble de `Document` utilisé (injectable pour les tests unitaires). */
export interface CanvasFactory {
	createElement(tag: 'canvas'): Pick<HTMLCanvasElement, 'getContext'>;
}

/** Test brut, sans cache. */
export function detectWebGL2(doc: CanvasFactory | undefined): boolean {
	if (!doc) return false; // SSR / environnement sans DOM
	let ctx: WebGL2RenderingContext | null;
	try {
		ctx = doc.createElement('canvas').getContext('webgl2');
	} catch {
		// Certains navigateurs lèvent au lieu de renvoyer null (politique de sécurité…).
		return false;
	}
	if (!ctx) return false;
	try {
		ctx.getExtension('WEBGL_lose_context')?.loseContext();
	} catch {
		/* libération best-effort : WebGL2 est bien disponible */
	}
	return true;
}

let cached: boolean | undefined;

/** WebGL2 disponible dans ce navigateur ? (testé une fois, puis mis en cache). */
export function supportsWebGL2(): boolean {
	return (cached ??= detectWebGL2(globalThis.document));
}
