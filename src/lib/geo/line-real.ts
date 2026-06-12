/**
 * Instantané du RÉEL communautaire par ligne, prêt pour le « verdict » et les
 * « points noirs » des pages SEO (cf. docs/spec-page-ligne.md).
 *
 * Calcul PUR (`computeLineReal`), appelé en **SSR** par le server-load de la page
 * `/ligne/[slug]` (`src/lib/server/line-real.ts`) : le verdict est rendu côté serveur
 * à chaque requête depuis la base VIVE (HTML indexable, toujours frais, court cache) —
 * pas de prérendu nocturne ni d'instantané committé.
 *
 * Critère de fiabilité = COUVERTURE SPATIALE (pas un total de mesures) : on ne
 * conclut que si une part suffisante du trajet est observée par des cellules H3
 * ayant chacune assez de pings — sinon le réel est « partiel » (cf. `sufficient`).
 */
import { worstByCell, type CellRate } from '../coverage-quality';
import { buildLineSegments, type SegmentCell } from '../coverage-segments';
import { projectOntoPath, type PathPoint } from './interpolate';
import { stationBefore } from './station-name';
import { type Level } from '../usage';

// --- Seuils (paramétrables) ------------------------------------------------

/** Une cellule H3 compte comme « fiable » au-delà de ce nombre de pings. */
export const MIN_SAMPLES_CELL = 3;
/** Part minimale du trajet couverte par des cellules fiables pour un verdict « réel ». */
export const SEUIL_COVERAGE = 50; // %
/** Nombre minimal de cellules fiables (garde-fou des lignes courtes). */
export const MIN_CELLS = 8;
/** Coupure plus courte que ça (s) = trop anecdotique pour un point noir. */
export const CUT_MIN_S = 20;
/** Coupures à moins de ça (km) = fusionnées en un seul point noir. */
export const CUT_MERGE_KM = 4;
/** Zone « rien » mesurée plus courte que ça (km) = pas un point noir notable. */
export const MIN_DEADZONE_KM = 1;
/** Au-delà de cette distance au tracé (m), une cellule n'est pas « sur la ligne ». */
const MAX_OFFSET_M = 600;
/** Nombre maximal de points noirs listés. */
export const MAX_BLACKSPOTS = 7;

// --- Types -----------------------------------------------------------------

/** Un point noir mesuré : « après {gare}, ça coupe ~{durationS} ». */
export interface Blackspot {
	afterStation: string;
	/** Abscisse curviligne (km depuis le départ) — pour distinguer/ordonner les coupures. */
	distKm: number;
	durationS: number;
	lengthM: number;
	source: 'measured';
}

/** Instantané du réel pour une ligne (figé au build, ou recalculé au runtime). */
export interface LineReal {
	/** Total de pings (info — PAS le critère de suffisance). */
	samples: number;
	/** Nombre de cellules H3 fiables (≥ MIN_SAMPLES_CELL pings). */
	nFiables: number;
	/** Part du trajet couverte par des cellules fiables (0–100). */
	coveragePct: number;
	/** Couverture suffisante ⇒ on peut baser le verdict sur le réel. */
	sufficient: boolean;
	/** Dernière mesure (epoch s) — fraîcheur. 0 si aucune. */
	lastSeen: number;
	/** Part « ça capte bien » (niveau TBC) sur la portion MESURÉE (0–100). */
	goodPct: number;
	/** Opérateur le mieux noté sur la ligne (clé), ou null si aucune mesure. */
	bestOperator: string | null;
	/** Opérateur dominant en VOLUME de mesures + sa part (pour signaler un biais). */
	operatorMix: { operator: string; share: number } | null;
	/** Points noirs mesurés, triés par gravité, plafonnés. */
	blackspots: Blackspot[];
}

/** Cellule × opérateur en entrée (agrégat brut). */
export interface RealCell extends CellRate {
	lastSeen?: number | null;
}
/** Coupure agrégée en entrée (centre de cellule + médianes). */
export interface RealOutage {
	lat: number;
	lng: number;
	medianDurationS: number;
	medianLengthM: number;
}
/** Géométrie + gares de la ligne (issues du profil de trajet). */
export interface LineGeometry {
	path: PathPoint[];
	stations: { name: string; distKm: number }[];
	lengthKm: number;
}

// --- Calcul pur ------------------------------------------------------------

const clampPct = (x: number) => Math.min(100, Math.max(0, Math.round(x)));

/** Instantané vide (aucune mesure / pas de tracé). */
function emptyReal(): LineReal {
	return {
		samples: 0,
		nFiables: 0,
		coveragePct: 0,
		sufficient: false,
		lastSeen: 0,
		goodPct: 0,
		bestOperator: null,
		operatorMix: null,
		blackspots: []
	};
}

/**
 * Calcule l'instantané réel d'une ligne à partir de ses cellules mesurées, ses
 * coupures agrégées et la géométrie de son tracé. PUR (sans DB ni I/O) → testable.
 */
export function computeLineReal(
	cells: RealCell[],
	outages: RealOutage[],
	geom: LineGeometry
): LineReal {
	if (!cells.length || geom.path.length < 2 || geom.lengthKm <= 0) return emptyReal();

	const samples = cells.reduce((s, c) => s + (c.samples || 0), 0);
	const lastSeen = cells.reduce((m, c) => Math.max(m, Number(c.lastSeen) || 0), 0);

	// Cellules fiables (≥ MIN_SAMPLES_CELL pings, pire opérateur par cellule).
	const fiables = [...worstByCell(cells).values()].filter((c) => c.samples >= MIN_SAMPLES_CELL);
	const nFiables = fiables.length;

	// Segments le long du tracé (run-length par niveau d'usage) sur les seules cellules
	// fiables → on en tire la couverture et la part « ça capte bien ».
	const segCells: SegmentCell[] = fiables.map((c) => ({
		rate: c.rate,
		samples: c.samples,
		operator: c.operator,
		lat: c.lat,
		lng: c.lng
	}));
	const segments = buildLineSegments(geom.path, segCells, '');
	let coverageKm = 0;
	let goodKm = 0;
	for (const f of segments) {
		const p = f.properties ?? {};
		const len = (Number(p.toKm) || 0) - (Number(p.fromKm) || 0);
		if (len <= 0) continue;
		coverageKm += len;
		if ((p.quality as Level) === 'TBC') goodKm += len;
	}
	const coveragePct = clampPct((coverageKm / geom.lengthKm) * 100);
	const goodPct = coverageKm > 0 ? clampPct((goodKm / coverageKm) * 100) : 0;

	// Meilleur opérateur : taux de réussite moyen pondéré par les mesures.
	const byOp = new Map<string, { rate: number; samples: number }>();
	for (const c of cells) {
		const cur = byOp.get(c.operator) ?? { rate: 0, samples: 0 };
		cur.rate += (c.successRate || 0) * (c.samples || 0);
		cur.samples += c.samples || 0;
		byOp.set(c.operator, cur);
	}
	let bestOperator: string | null = null;
	let bestMean = -1;
	// Mix : opérateur dominant en VOLUME (pour signaler « principalement {op} »).
	let mixOperator: string | null = null;
	let mixSamples = 0;
	let totalOpSamples = 0;
	for (const [op, v] of byOp) {
		const mean = v.samples > 0 ? v.rate / v.samples : 0;
		if (mean > bestMean) {
			bestMean = mean;
			bestOperator = op;
		}
		totalOpSamples += v.samples;
		if (v.samples > mixSamples) {
			mixSamples = v.samples;
			mixOperator = op;
		}
	}
	const operatorMix =
		mixOperator && totalOpSamples > 0
			? { operator: mixOperator, share: mixSamples / totalOpSamples }
			: null;

	// Points noirs = zones à problème mesurées. Deux sources qui se composent :
	//  - zones « rien » mesurées (segments `none` assez longs) → « pas de réseau » ;
	//  - coupures mesurées (durée médiane) → enrichissent une zone, ou comptent seules.
	// Le build passe `outages = []` (durées dérivées au runtime) → on a déjà les zones.
	const noneZones: { fromKm: number; toKm: number }[] = [];
	for (const f of segments) {
		const p = f.properties ?? {};
		if ((p.quality as Level) !== 'none') continue;
		const fromKm = Number(p.fromKm) || 0;
		const toKm = Number(p.toKm) || 0;
		if (toKm - fromKm >= MIN_DEADZONE_KM) noneZones.push({ fromKm, toKm });
	}

	// Coupures projetées, filtrées (≥ CUT_MIN_S), fusionnées (< CUT_MERGE_KM).
	const cutGroups: { distKm: number; durationS: number; lengthM: number }[] = [];
	for (const o of outages
		.map((o) => ({ proj: projectOntoPath(geom.path, o.lat, o.lng), o }))
		.filter((x) => x.proj.offsetM <= MAX_OFFSET_M && x.o.medianDurationS >= CUT_MIN_S)
		.sort((a, b) => a.proj.distKm - b.proj.distKm)) {
		const last = cutGroups[cutGroups.length - 1];
		if (last && o.proj.distKm - last.distKm <= CUT_MERGE_KM) {
			if (o.o.medianDurationS > last.durationS) {
				last.durationS = o.o.medianDurationS;
				last.lengthM = o.o.medianLengthM;
			}
		} else {
			cutGroups.push({
				distKm: o.proj.distKm,
				durationS: o.o.medianDurationS,
				lengthM: o.o.medianLengthM
			});
		}
	}

	// Fusionne : chaque zone « rien » récupère la durée d'une coupure qui la recoupe ;
	// les coupures sans zone associée (coupure en zone OK) comptent à part.
	const used = new Set<number>();
	const spots: { distKm: number; durationS: number; lengthM: number }[] = [];
	for (const z of noneZones) {
		const ci = cutGroups.findIndex(
			(c, i) =>
				!used.has(i) && c.distKm >= z.fromKm - CUT_MERGE_KM && c.distKm <= z.toKm + CUT_MERGE_KM
		);
		if (ci >= 0) used.add(ci);
		spots.push({
			distKm: z.fromKm,
			durationS: ci >= 0 ? cutGroups[ci].durationS : 0,
			lengthM: Math.round((z.toKm - z.fromKm) * 1000)
		});
	}
	cutGroups.forEach((c, i) => {
		if (!used.has(i)) spots.push({ distKm: c.distKm, durationS: c.durationS, lengthM: c.lengthM });
	});

	const blackspots: Blackspot[] = spots
		.sort((a, b) => b.durationS - a.durationS || b.lengthM - a.lengthM)
		.slice(0, MAX_BLACKSPOTS)
		.map((s) => ({
			afterStation: stationBefore(geom.stations, s.distKm),
			distKm: Math.round(s.distKm * 10) / 10,
			durationS: Math.round(s.durationS),
			lengthM: Math.round(s.lengthM),
			source: 'measured'
		}));

	return {
		samples,
		nFiables,
		coveragePct,
		sufficient: coveragePct >= SEUIL_COVERAGE && nFiables >= MIN_CELLS,
		lastSeen,
		goodPct,
		bestOperator,
		operatorMix,
		blackspots
	};
}
