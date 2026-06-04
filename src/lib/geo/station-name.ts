/**
 * Nommage rédactionnel des gares pour les pages SEO (« après {gare} »).
 *
 * Source unique partagée par `build-line-stats` (zones blanches ARCEP) et
 * `line-real` (points noirs mesurés) — pour que « après Mâcon » s'écrive pareil
 * des deux côtés.
 */

/** Nettoie un libellé de gare GTFS (« Mâcon - Loché TGV » → « Mâcon - Loché »). */
export function prettyStation(name: string): string {
	const s = name
		.replace(/\s*\([^)]*\)\s*/g, ' ') // retire les parenthèses
		.replace(/\s+Hall\s+\d.*$/i, '') // « … Hall 1 - 2 »
		.replace(/\s+/g, ' ')
		.trim();
	// Gares parisiennes (« Paris Gare de Lyon », « Paris Est »…) → « Paris ».
	if (/^Paris\b/.test(s)) return 'Paris';
	return s
		.replace(/\s+(TGV|Ville|SNCF)\b/gi, '')
		.replace(/\bGare\s+(de|du|des|d')\s+/gi, '')
		.replace(/\s+Gare\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Nom (rédactionnel) de la gare située JUSTE AVANT une abscisse `km` sur le tracé.
 * Accepte des gares non triées (tri interne). Renvoie '' si aucune gare.
 */
export function stationBefore(stations: { name: string; distKm: number }[], km: number): string {
	const sorted = [...stations].sort((a, b) => a.distKm - b.distKm);
	let pick = sorted[0]?.name ?? '';
	for (const st of sorted) {
		if (st.distKm <= km) pick = st.name;
		else break;
	}
	return prettyStation(pick);
}
