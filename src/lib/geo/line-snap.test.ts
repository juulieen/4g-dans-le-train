import { describe, it, expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import { lineSlugForCell, lineSlugsForCell, type LineIndex } from './line-snap';
import { H3_RESOLUTION } from './h3';

/**
 * Tests de la logique de rattachement cellule → ligne. On injecte un index
 * synthétique (pattern « dépendance injectable » de measure/queue.test.ts) pour
 * tester la logique pure, puis on fait quelques assertions sur l'index réel
 * généré (src/lib/geo/line-index.json) pour détecter une régression du pipeline.
 */
describe('lineSlugForCell / lineSlugsForCell (index injecté)', () => {
	const index: LineIndex = {
		slugs: ['paris-lyon', 'paris-marseille', 'lyon-marseille'],
		cells: {
			// cellule de tronc commun : 3 lignes, primaire = paris-lyon (index 0)
			trunk: [0, 1, 2],
			// cellule mono-ligne
			solo: [1]
		}
	};

	it('renvoie le slug primaire (premier) pour une cellule connue', () => {
		expect(lineSlugForCell('trunk', index)).toBe('paris-lyon');
		expect(lineSlugForCell('solo', index)).toBe('paris-marseille');
	});

	it('renvoie toutes les lignes du tronc commun, dans l’ordre', () => {
		expect(lineSlugsForCell('trunk', index)).toEqual([
			'paris-lyon',
			'paris-marseille',
			'lyon-marseille'
		]);
		expect(lineSlugsForCell('solo', index)).toEqual(['paris-marseille']);
	});

	it('renvoie null / tableau vide pour une cellule hors de toute ligne', () => {
		expect(lineSlugForCell('inconnue', index)).toBeNull();
		expect(lineSlugsForCell('inconnue', index)).toEqual([]);
	});
});

describe('index réel (line-index.json)', () => {
	// Lyon Part-Dieu : sur la ligne Paris–Lyon (cf. scripts/build-line-index.ts).
	const lyon = latLngToCell(45.7603, 4.8595, H3_RESOLUTION);
	// Plein océan Atlantique : sur aucune voie.
	const ocean = latLngToCell(45.0, -10.0, H3_RESOLUTION);

	it('rattache une cellule sur voie à au moins une ligne', () => {
		expect(lineSlugForCell(lyon)).not.toBeNull();
		expect(lineSlugsForCell(lyon)).toContain('paris-lyon');
	});

	it('ne rattache rien à une cellule loin de toute voie', () => {
		expect(lineSlugForCell(ocean)).toBeNull();
	});
});
