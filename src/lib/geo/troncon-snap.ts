/**
 * Résolution d'un slug de TRONÇON vers sa ligne parente + l'ensemble de ses
 * cellules (généré par build-line-index → troncon-cells.json).
 *
 * POURQUOI : un tronçon (sous-relation ville↔ville, cf. CommercialLine.segmentOf)
 * n'a PAS de mesures propres — il partage la voie de sa ligne parente, qui reste
 * le slug primaire des mesures (line-index.json). Pour afficher, sur une page
 * tronçon, les mesures communautaires de la PORTION correspondante, les API
 * `coverage`/`outages` filtrent les agrégats de la parente sur les cellules du
 * tronçon. Une ligne normale est renvoyée telle quelle (pas de filtre cellules).
 *
 * Usage serveur uniquement (le JSON n'est pas embarqué côté client).
 */
import tronconCells from './troncon-cells.json';

interface TronconEntry {
	parent: string;
	cells: string[];
}

const MAP = tronconCells as Record<string, TronconEntry>;
const cellSetCache = new Map<string, Set<string>>();

/** Filtre d'agrégats résolu pour un slug de ligne. */
export interface LineFilter {
	/** Slug sous lequel les mesures sont stockées (la parente pour un tronçon). */
	lineSlug: string;
	/** Restreint aux cellules du tronçon (absent pour une ligne normale). */
	cells?: Set<string>;
}

/**
 * Résout un slug de ligne en filtre d'agrégats :
 *  - tronçon → `{ lineSlug: <parente>, cells: <cellules du tronçon> }` ;
 *  - ligne normale → `{ lineSlug: <slug> }` ;
 *  - `null`/inconnu → `null` (pas de filtre ligne).
 */
export function resolveLineFilter(slug: string | null | undefined): LineFilter | null {
	if (!slug) return null;
	const t = MAP[slug];
	if (!t) return { lineSlug: slug };
	let cells = cellSetCache.get(slug);
	if (!cells) {
		cells = new Set(t.cells);
		cellSetCache.set(slug, cells);
	}
	return { lineSlug: t.parent, cells };
}
