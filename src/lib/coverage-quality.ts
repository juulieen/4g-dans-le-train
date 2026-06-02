/**
 * Agrégation « pire opérateur » d'une cellule mesurée.
 *
 * POURQUOI : en vue « tous opérateurs », plusieurs opérateurs peuvent avoir mesuré
 * la même cellule H3. Plutôt que d'empiler des pastilles (illisible), on retient le
 * PIRE taux de réussite parmi eux : la carte met ainsi en avant les risques de
 * coupure (« au moins un opérateur galère ici »). Avec un opérateur sélectionné, on
 * ne passe pas par ici (une seule valeur par cellule).
 *
 * Module PUR (client + serveur) : utilisé côté serveur par `/api/coverage/segments`
 * (rubans le long de la voie) et côté client par `Map.svelte` (quadrillage H3).
 */

/** Entrée minimale : un agrégat cellule × opérateur. */
export interface CellRate {
	cellId: string;
	operator: string;
	successRate: number;
	samples: number;
	lat: number;
	lng: number;
}

/** Sortie : une cellule avec son PIRE taux et les agrégats utiles. */
export interface WorstCell {
	cellId: string;
	/** Pire taux de réussite (0..1) parmi les opérateurs mesurés. */
	rate: number;
	/** Opérateur correspondant au pire taux. */
	operator: string;
	/** Somme des mesures, tous opérateurs confondus. */
	samples: number;
	/** Nombre d'opérateurs ayant mesuré cette cellule. */
	operatorCount: number;
	lat: number;
	lng: number;
}

/**
 * Regroupe des agrégats cellule × opérateur par cellule et retient, pour chacune,
 * le PIRE `successRate` (avec l'opérateur associé). `samples` est cumulé.
 */
export function worstByCell(rows: Iterable<CellRate>): Map<string, WorstCell> {
	const out = new Map<string, WorstCell>();
	for (const r of rows) {
		const cur = out.get(r.cellId);
		if (!cur) {
			out.set(r.cellId, {
				cellId: r.cellId,
				rate: r.successRate,
				operator: r.operator,
				samples: r.samples,
				operatorCount: 1,
				lat: r.lat,
				lng: r.lng
			});
		} else {
			cur.samples += r.samples;
			cur.operatorCount += 1;
			if (r.successRate < cur.rate) {
				cur.rate = r.successRate;
				cur.operator = r.operator;
			}
		}
	}
	return out;
}
