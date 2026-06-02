import { encode } from 'uqr';

/**
 * Génère un QR code SVG (chaîne) pour l'URL donnée. Rendu maison à partir de la
 * matrice de modules d'`uqr` (zéro dépendance lourde, SSR-safe). Un seul `<path>`
 * agrégé pour les modules noirs — léger et net à n'importe quelle taille.
 *
 * Le `viewBox` vaut la taille de la matrice : on dimensionne ensuite en CSS.
 */
export function buildQrSvg(url: string): string {
	const { size, data } = encode(url, { ecc: 'M' });

	let path = '';
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (data[y][x]) path += `M${x} ${y}h1v1h-1z`;
		}
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
		`shape-rendering="crispEdges" role="img" aria-label="QR code vers le site">` +
		`<path fill="#000" d="${path}"/></svg>`
	);
}
