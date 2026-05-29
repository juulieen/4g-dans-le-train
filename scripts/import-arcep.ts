/**
 * Prépare la couche de couverture mobile officielle ARCEP (« Mon Réseau Mobile »).
 *
 * Source : Open Data ARCEP — fichiers de couverture théorique 2G/3G/4G/5G par
 * opérateur. https://data.arcep.fr/  (jeu « Mon Réseau Mobile » sur data.gouv.fr)
 *
 * ⚠️ Les fichiers ARCEP bruts sont volumineux et publiés par opérateur/techno,
 * dans des formats variables (parfois MapInfo/Shapefile converti). Ce script est
 * un POINT D'ENTRÉE : il documente la source et écrit un placeholder tant qu'une
 * URL d'export GeoJSON exploitable n'est pas fixée. Renseigner ARCEP_GEOJSON_URL
 * (variable d'env) pour activer le téléchargement réel.
 *
 * Voir docs/DATA.md pour la procédure d'obtention/conversion.
 */
import { writeFile, mkdir } from 'node:fs/promises';

const OUT_DIR = 'static/data';
const OUT_FILE = `${OUT_DIR}/arcep-coverage.geojson`;
const url = process.env.ARCEP_GEOJSON_URL;

async function main() {
	await mkdir(OUT_DIR, { recursive: true });

	if (!url) {
		console.warn(
			"[arcep] ARCEP_GEOJSON_URL non défini — écriture d'un placeholder vide.\n" +
				'        Voir docs/DATA.md pour récupérer/convertir les fichiers ARCEP.'
		);
		await writeFile(OUT_FILE, JSON.stringify({ type: 'FeatureCollection', features: [] }));
		return;
	}

	console.log(`[arcep] téléchargement depuis ${url}…`);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`ARCEP: HTTP ${res.status}`);
	const geojson = await res.text();
	await writeFile(OUT_FILE, geojson);
	console.log(`[arcep] écrit ${OUT_FILE} ✅`);
}

main().catch((e) => {
	console.error('[arcep] échec :', e);
	process.exit(1);
});
