/**
 * Agrège, par ligne commerciale, la couverture ARCEP THÉORIQUE en statistiques
 * prêtes pour les pages SEO (chiffres + zones blanches nommées), écrites dans
 * src/lib/geo/line-stats.json (committé). Zéro coût runtime : figé au build.
 *
 * SOURCE : les profils de trajet déjà produits par `data:line-index`
 * (static/data/route-profiles/<slug>.json — handoff B1). Chaque profil contient
 * le tracé routé de la ligne découpé en segments ARCEP run-length
 * `{ fromKm, toKm, orange, sfr, free, bouygues, best }` (niveaux d'usage de
 * src/lib/usage.ts) + les gares ordonnées `{ name, distKm }`. On NE re-route donc
 * RIEN ici : on lit ces segments et on les agrège, pondéré par la longueur :
 *   - répartition TBC/BC/CL/none par opérateur et « au mieux » (best) ;
 *   - zones blanches : tronçons `best === 'none'` contigus (fusionnés si séparés
 *     par < MERGE_GAP_KM de couvert), nommés par la gare amont (« après Mâcon »).
 *
 * FIABILITÉ : `import-arcep` n'écrit que les cellules couvertes, donc une cellule
 * absente (→ segment `none` dans le profil) vaut « vraie zone blanche » OU « hors
 * du corridor échantillonné ». Tant que le tracé suit la voie indexée, l'absence
 * ≈ zone blanche réelle ; mais sur quelques lignes à gares GTFS rares le tracé
 * s'écarte et gonfle le « sans réseau ». Au-delà de MAX_NODATA_FRACTION, l'overlay
 * est jugé non fiable → la ligne est EXCLUE (sa page retombe sur le générique).
 *
 * Usage : bun run data:line-stats  (après data:line-index). Licence : Etalab.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { USAGE_OPS, type Level, type UsageOp } from '../src/lib/usage';
import type { LineStats, LevelDist } from '../src/lib/geo/line-stats';

const PROFILES_DIR = 'static/data/route-profiles';
/** Longueur minimale d'un tronçon sans couverture pour le compter en zone blanche (km). */
const MIN_WHITE_KM = 3;
/** Deux trous séparés par moins de ce couvert sont fusionnés (anti-fragmentation res 7). */
const MERGE_GAP_KM = 3;
/** Nombre max de zones blanches détaillées conservées par ligne (les plus longues). */
const MAX_WHITE_ZONES = 6;
/**
 * Garde-fou de fiabilité : au-delà de cette part de « sans données » ARCEP, le
 * tracé routé s'est probablement écarté du corridor échantillonné → on écarte la
 * ligne plutôt que d'afficher de faux chiffres (paris-nancy ~40 %, paris-sedan
 * ~30 %, contre ≤ 18 % pour les vraies lignes POLT).
 */
const MAX_NODATA_FRACTION = 0.2;

/** Un segment ARCEP run-length d'un profil de trajet. */
interface ArcepSeg extends Record<UsageOp, Level> {
	fromKm: number;
	toKm: number;
	best: Level;
}
interface RouteProfile {
	slug: string;
	lengthKm: number;
	stations: { name: string; distKm: number }[];
	arcep: ArcepSeg[];
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Nettoie un libellé de gare GTFS pour un usage rédactionnel (« Mâcon - Loché TGV » → « Mâcon - Loché »). */
function prettyStation(name: string): string {
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

function emptyDist(): LevelDist {
	return { TBC: 0, BC: 0, CL: 0, none: 0 };
}

async function main() {
	let files: string[];
	try {
		files = (await readdir(PROFILES_DIR)).filter((f) => f.endsWith('.json')).sort();
	} catch {
		throw new Error(`${PROFILES_DIR} introuvable — lancez d'abord « bun run data:line-index ».`);
	}

	const out: Record<string, LineStats> = {};
	let unreliable = 0;
	const dropped: string[] = [];

	for (const file of files) {
		const profile = JSON.parse(await readFile(join(PROFILES_DIR, file), 'utf8')) as RouteProfile;
		const segs = profile.arcep ?? [];
		const total = segs.reduce((s, seg) => s + (seg.toKm - seg.fromKm), 0);
		if (total <= 0) continue;

		// Répartition par opérateur + « au mieux », pondérée par la longueur.
		const arcepKm: Record<UsageOp, LevelDist> = {
			orange: emptyDist(),
			sfr: emptyDist(),
			free: emptyDist(),
			bouygues: emptyDist()
		};
		const bestKm = emptyDist();
		for (const seg of segs) {
			const len = seg.toKm - seg.fromKm;
			for (const op of USAGE_OPS) arcepKm[op][seg[op]] += len;
			bestKm[seg.best] += len;
		}
		const toFractions = (d: LevelDist): LevelDist => ({
			TBC: r4(d.TBC / total),
			BC: r4(d.BC / total),
			CL: r4(d.CL / total),
			none: r4(d.none / total)
		});
		const best = toFractions(bestKm);

		// Garde-fou : overlay ARCEP peu fiable → on écarte la ligne entièrement.
		if (best.none > MAX_NODATA_FRACTION) {
			unreliable++;
			dropped.push(profile.slug);
			continue;
		}

		// Zones blanches : segments best === 'none', fusionnés si séparés par moins
		// de MERGE_GAP_KM de couvert, filtrés par longueur, nommés par la gare amont.
		const stations = [...profile.stations]
			.map((st) => ({ name: prettyStation(st.name), distKm: st.distKm }))
			.sort((a, b) => a.distKm - b.distKm);
		const stationBefore = (km: number): string => {
			let label = stations[0]?.name ?? '';
			for (const st of stations) {
				if (st.distKm <= km) label = st.name;
				else break;
			}
			return label;
		};

		const merged: { start: number; end: number }[] = [];
		for (const seg of segs) {
			if (seg.best !== 'none') continue;
			const last = merged[merged.length - 1];
			if (last && seg.fromKm - last.end < MERGE_GAP_KM) last.end = seg.toKm;
			else merged.push({ start: seg.fromKm, end: seg.toKm });
		}
		const zones = merged
			.map((r) => ({ after: stationBefore(r.start), lengthKm: r1(r.end - r.start) }))
			.filter((z) => z.lengthKm >= MIN_WHITE_KM)
			.sort((a, b) => b.lengthKm - a.lengthKm);

		out[profile.slug] = {
			lengthKm: r1(profile.lengthKm ?? total),
			arcep: {
				orange: toFractions(arcepKm.orange),
				sfr: toFractions(arcepKm.sfr),
				free: toFractions(arcepKm.free),
				bouygues: toFractions(arcepKm.bouygues)
			},
			best,
			zonesBlanches: { count: zones.length, zones: zones.slice(0, MAX_WHITE_ZONES) }
		};
	}

	await writeFile('src/lib/geo/line-stats.json', JSON.stringify(out) + '\n');
	console.log(
		`[line-stats] écrit src/lib/geo/line-stats.json — ${Object.keys(out).length} lignes ` +
			`(${unreliable} écartées car overlay ARCEP peu fiable) ✅`
	);
	if (dropped.length) console.log(`[line-stats]   écartées : ${dropped.join(', ')}`);
}

main().catch((e) => {
	console.error('[line-stats] échec :', e);
	process.exit(1);
});
