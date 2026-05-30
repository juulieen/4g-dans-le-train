/**
 * Rattachement d'une cellule H3 à sa (ses) ligne(s) commerciale(s).
 *
 * L'index est pré-calculé hors-ligne par `scripts/build-line-index.ts` à partir
 * du GTFS SNCF + du réseau RFN (cf. docs/DATA.md) et committé dans
 * `line-index.json`. Le rattachement à l'ingestion est donc un simple
 * `Map.get(cellId)` en O(1), sans aucun calcul géométrique par requête.
 *
 * Format de l'index (compact) : `{ slugs: string[], cells: { [cellId]: number[] } }`
 * où chaque entier indexe `slugs`. Les slugs d'une cellule sont ordonnés du plus
 * spécifique (primaire) au plus général : sur un tronc commun (ex. sortie de
 * Paris), une cellule appartient à plusieurs lignes. `lineSlugForCell` renvoie le
 * primaire (stocké dans `measurements.lineSlug`) ; `lineSlugsForCell` renvoie la
 * liste complète, utile aux pages de couverture par ligne.
 *
 * Module SERVEUR uniquement (importe un JSON de ~1 Mo) : ne pas importer côté client.
 */
import rawIndex from './line-index.json';

export interface LineIndex {
	slugs: string[];
	cells: Record<string, number[]>;
}

const DEFAULT_INDEX = rawIndex as LineIndex;

/**
 * Toutes les lignes commerciales passant par cette cellule, de la plus
 * spécifique à la plus générale. Tableau vide si la cellule n'est sur aucune
 * ligne du référentiel. `index` est injectable pour les tests.
 */
export function lineSlugsForCell(cellId: string, index: LineIndex = DEFAULT_INDEX): string[] {
	const idx = index.cells[cellId];
	return idx ? idx.map((i) => index.slugs[i]) : [];
}

/**
 * Ligne commerciale principale d'une cellule (slug stocké dans la mesure), ou
 * `null` si la cellule n'est sur aucune ligne connue.
 */
export function lineSlugForCell(cellId: string, index: LineIndex = DEFAULT_INDEX): string | null {
	return lineSlugsForCell(cellId, index)[0] ?? null;
}
