/**
 * Importe les tracés des lignes ferroviaires françaises (SNCF Open Data) en
 * GeoJSON, les simplifie pour le web, et écrit static/data/rail-lines.geojson.
 *
 * Source : « Formes des lignes du RFN » (Réseau Ferré National).
 * https://ressources.data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/
 *
 * Le fichier produit est servi statiquement et affiché par MapLibre. On simplifie
 * la géométrie (tolérance Douglas-Peucker) pour réduire le poids côté client.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { simplify } from '@turf/turf';
import type { Feature, FeatureCollection } from 'geojson';
import { slugifyLine } from '../src/lib/geo/lines';

// Export GeoJSON direct de l'API SNCF Open Data (Explore / Opendatasoft).
const SOURCE_URL =
	'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/formes-des-lignes-du-rfn/exports/geojson';

const OUT_DIR = 'static/data';
const OUT_FILE = `${OUT_DIR}/rail-lines.geojson`;
/** Tolérance de simplification en degrés (~50 m). */
const SIMPLIFY_TOLERANCE = 0.0005;

async function main() {
	console.log('[sncf] téléchargement des tracés…');
	const res = await fetch(SOURCE_URL);
	if (!res.ok) throw new Error(`SNCF Open Data: HTTP ${res.status}`);
	const raw = (await res.json()) as FeatureCollection;
	console.log(`[sncf] ${raw.features.length} entités reçues`);

	const features: Feature[] = raw.features.map((f) => {
		const props = f.properties ?? {};
		// Le champ de libellé varie selon les exports ; on tente les plus courants.
		const label =
			(props.lib_ligne as string) ??
			(props.libelle as string) ??
			(props.nom as string) ??
			`Ligne ${props.code_ligne ?? '?'}`;
		const simplified = simplify(f as Feature, {
			tolerance: SIMPLIFY_TOLERANCE,
			highQuality: false
		});
		simplified.properties = {
			code: props.code_ligne ?? null,
			label,
			slug: slugifyLine(label)
		};
		return simplified;
	});

	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(OUT_FILE, JSON.stringify({ type: 'FeatureCollection', features }));
	console.log(`[sncf] écrit ${OUT_FILE} (${features.length} lignes) ✅`);
}

main().catch((e) => {
	console.error('[sncf] échec :', e);
	process.exit(1);
});
