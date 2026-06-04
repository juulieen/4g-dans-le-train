/**
 * Rendu des vignettes sociales (Open Graph / Twitter Card) « frise de trajet ».
 *
 * Pipeline : on compose une vue (objets façon JSX) → `satori` produit un SVG (texte
 * réel, mis en page avec la fonte fournie) → `@resvg/resvg-js` rasterise en PNG.
 *
 * IMPORTANT : on fournit la fonte aux DEUX étages. satori en a besoin pour la mise en
 * page ; resvg en a besoin pour dessiner le texte. On force `loadSystemFonts: false`
 * pour un rendu déterministe — le conteneur de prod n'a pas forcément DejaVu installé.
 *
 * Source de vérité des couleurs : `src/lib/usage.ts` (`USAGE_COLORS`).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { read } from '$app/server';
import { USAGE_COLORS, toLevel, type Level } from '$lib/usage';
import regularUrl from './fonts/DejaVuSans.ttf';
import boldUrl from './fonts/DejaVuSans-Bold.ttf';

const W = 1200;
const H = 630;
const FONT = 'DejaVu Sans';
const BG = '#0b1220';
const FG = '#e2e8f0';
const MUTED = '#94a3b8';
const ACCENT = '#38bdf8';

/** Un segment ARCEP du profil de trajet (run-length le long du tracé). */
interface ArcepSeg {
	fromKm: number;
	toKm: number;
	best: Level;
}
/** Profil de trajet (static/data/route-profiles/<slug>.json), sous-ensemble utile ici. */
export interface RouteProfile {
	from: string;
	to: string;
	lengthKm: number;
	stations: { name: string; distKm: number }[];
	arcep: ArcepSeg[];
}
/** Résumé du réel communautaire (mesures), ou null si trop peu de données. */
export interface RealSummary {
	cells: number;
	samples: number;
	streamingPct: number;
	nonePct: number;
}
/** Données d'une ligne pour composer la carte. */
export interface LineCardData {
	from: string;
	to: string;
	service: string;
	profile: RouteProfile | null;
	real: RealSummary | null;
}

// --- Chargement des fontes (une fois) -------------------------------------------------

interface LoadedFonts {
	satori: { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }[];
	/** Chemins disque des TTF — resvg-js ne sait charger que des FICHIERS, pas des buffers. */
	resvgFiles: string[];
}
let fontsPromise: Promise<LoadedFonts> | null = null;

async function loadFonts(): Promise<LoadedFonts> {
	if (!fontsPromise) {
		fontsPromise = (async () => {
			const [regular, bold] = await Promise.all([
				read(regularUrl).arrayBuffer(),
				read(boldUrl).arrayBuffer()
			]);
			// resvg-js exige des chemins de fichiers ; on matérialise les TTF (lus comme
			// assets via `read`) dans un dossier temporaire, une fois, pour un rendu de
			// texte déterministe sans dépendre des fontes système du conteneur.
			const dir = mkdtempSync(join(tmpdir(), '4gdt-og-'));
			const regularPath = join(dir, 'DejaVuSans.ttf');
			const boldPath = join(dir, 'DejaVuSans-Bold.ttf');
			writeFileSync(regularPath, new Uint8Array(regular));
			writeFileSync(boldPath, new Uint8Array(bold));
			return {
				satori: [
					{ name: FONT, data: regular, weight: 400 as const, style: 'normal' as const },
					{ name: FONT, data: bold, weight: 700 as const, style: 'normal' as const }
				],
				resvgFiles: [regularPath, boldPath]
			};
		})();
	}
	return fontsPromise;
}

// --- Petits constructeurs de noeuds (satori accepte des objets {type, props}) ----------

type El = {
	type: string;
	props: { style: Record<string, unknown>; children?: El | El[] | string };
};

function box(style: Record<string, unknown>, children?: El | El[] | string): El {
	return { type: 'div', props: { style: { display: 'flex', ...style }, children } };
}
function txt(style: Record<string, unknown>, s: string): El {
	return { type: 'div', props: { style, children: s } };
}

const fmtPct = (x: number) => `${Math.min(100, Math.max(0, Math.round(x * 100)))} %`;

/** Bandeau décoratif des 4 couleurs d'usage, en haut de la carte. */
function topBand(): El {
	const order: Level[] = ['TBC', 'BC', 'CL', 'none'];
	return box(
		{ width: '100%', height: 12 },
		order.map((l) => box({ flex: 1, backgroundColor: USAGE_COLORS[l] }))
	);
}

/** En-tête : marque à gauche, domaine à droite. */
function header(): El {
	return box({ justifyContent: 'space-between', alignItems: 'center', width: '100%' }, [
		box({ alignItems: 'center' }, [
			box({ width: 18, height: 18, borderRadius: 9, backgroundColor: ACCENT, marginRight: 14 }),
			txt({ fontSize: 30, fontWeight: 700, color: FG }, '4G dans le train')
		]),
		txt({ fontSize: 24, color: MUTED }, '4g-dans-le-train.juulieen.fr')
	]);
}

/** Barre de la frise ARCEP (niveau « best » par segment) + repères de gares. */
function friseBar(profile: RouteProfile): El {
	const total = profile.lengthKm || profile.arcep.reduce((a, s) => a + (s.toKm - s.fromKm), 0) || 1;
	const segs: El[] = profile.arcep.map((s) =>
		box({
			width: `${((s.toKm - s.fromKm) / total) * 100}%`,
			height: '100%',
			backgroundColor: USAGE_COLORS[toLevel(s.best)]
		})
	);
	// Repères de gares (lignes fines), hors extrémités pour ne pas se chevaucher.
	const ticks: El[] = profile.stations
		.map((st) => (st.distKm / total) * 100)
		.filter((p) => p > 2 && p < 98)
		.map((p) =>
			box({
				position: 'absolute',
				left: `${p}%`,
				top: 0,
				width: 2,
				height: '100%',
				backgroundColor: 'rgba(11,18,32,0.55)'
			})
		);
	return box(
		{ position: 'relative', width: '100%', height: 76, borderRadius: 14, overflow: 'hidden' },
		[...segs, ...ticks]
	);
}

/** Chip « pastille + libellé » pour une statistique. */
function statChip(color: string, label: string): El {
	return box({ alignItems: 'center', marginRight: 36 }, [
		box({ width: 22, height: 22, borderRadius: 11, backgroundColor: color, marginRight: 12 }),
		txt({ fontSize: 30, color: FG }, label)
	]);
}

function frame(children: El[]): El {
	return box(
		{
			width: W,
			height: H,
			flexDirection: 'column',
			backgroundColor: BG,
			color: FG,
			fontFamily: FONT
		},
		[topBand(), box({ flexDirection: 'column', flex: 1, padding: 56, width: '100%' }, children)]
	);
}

async function toPng(tree: El): Promise<ArrayBuffer> {
	const fonts = await loadFonts();
	const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
		width: W,
		height: H,
		fonts: fonts.satori
	});
	const buf = new Resvg(svg, {
		fitTo: { mode: 'width', value: W },
		font: { fontFiles: fonts.resvgFiles, loadSystemFonts: false, defaultFontFamily: FONT }
	})
		.render()
		.asPng();
	// On renvoie un ArrayBuffer (BodyInit sans ambiguïté pour `new Response`).
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// --- Cartes -------------------------------------------------------------------------

/** Carte d'une ligne : titre + frise ARCEP + 2 stats, réel superposé si disponible. */
export async function renderLineCard(data: LineCardData): Promise<ArrayBuffer> {
	const { from, to, service, profile, real } = data;

	const realLine = real
		? statRealLine(USAGE_COLORS.TBC, `Mesuré par la communauté · ${real.samples} points`)
		: statRealLine(MUTED, 'Pas encore de mesures — sois le premier à mesurer cette ligne');

	const body: El[] = [
		header(),
		// Titre, poussé par un flex-grow pour occuper le haut.
		box({ flexDirection: 'column', marginTop: 44 }, [
			txt({ fontSize: 26, color: MUTED, marginBottom: 8 }, 'Couverture mobile dans le train'),
			txt({ fontSize: 78, fontWeight: 700, color: FG, lineHeight: 1 }, `${from} ↔ ${to}`),
			txt(
				{ fontSize: 30, color: MUTED, marginTop: 14 },
				profile ? `${service} · ${Math.round(profile.lengthKm)} km` : service
			)
		]),
		// Bas de carte : frise + stats, collés en bas via marginTop auto.
		box({ flexDirection: 'column', marginTop: 'auto', width: '100%' }, [
			realLine,
			...(profile ? [friseBar(profile)] : []),
			...(profile
				? [
						box({ justifyContent: 'space-between', width: '100%', marginTop: 12 }, [
							txt({ fontSize: 24, color: MUTED }, profile.stations[0]?.name ?? from),
							txt(
								{ fontSize: 24, color: MUTED },
								profile.stations[profile.stations.length - 1]?.name ?? to
							)
						])
					]
				: []),
			box({ marginTop: 26 }, [
				statChip(USAGE_COLORS.TBC, `${friseStat(profile, 'TBC')} en streaming vidéo`),
				statChip(USAGE_COLORS.none, `${friseStat(profile, 'none')} de zones blanches`)
			])
		])
	];
	return toPng(frame(body));
}

/** Ligne d'état du réel (pastille + libellé) au-dessus de la frise. */
function statRealLine(color: string, label: string): El {
	return box({ alignItems: 'center', marginBottom: 16 }, [
		box({ width: 16, height: 16, borderRadius: 8, backgroundColor: color, marginRight: 12 }),
		txt({ fontSize: 24, color: MUTED }, label)
	]);
}

/** Part (en %) d'un niveau « best » le long du tracé, depuis le profil. */
function friseStat(profile: RouteProfile | null, level: Level): string {
	if (!profile) return '—';
	const total = profile.lengthKm || profile.arcep.reduce((a, s) => a + (s.toKm - s.fromKm), 0) || 1;
	const len = profile.arcep.reduce(
		(a, s) => a + (toLevel(s.best) === level ? s.toKm - s.fromKm : 0),
		0
	);
	return fmtPct(len / total);
}

/** Carte générique (home, opérateurs, repli) — pas de ligne précise. */
export async function renderDefaultCard(): Promise<ArrayBuffer> {
	const body: El[] = [
		header(),
		box({ flexDirection: 'column', flex: 1, justifyContent: 'center' }, [
			txt(
				{ fontSize: 82, fontWeight: 700, color: FG, lineHeight: 1.05 },
				'Où ça capte\ndans le train ?'
			),
			txt(
				{ fontSize: 32, color: MUTED, marginTop: 24 },
				'Carte communautaire de la couverture 4G/5G le long des lignes SNCF.'
			)
		]),
		box({ marginTop: 'auto' }, [
			statChip(USAGE_COLORS.TBC, 'Streaming'),
			statChip(USAGE_COLORS.BC, 'Web'),
			statChip(USAGE_COLORS.CL, 'Messages'),
			statChip(USAGE_COLORS.none, 'Zone blanche')
		])
	];
	return toPng(frame(body));
}
