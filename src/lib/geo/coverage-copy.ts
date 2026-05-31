/**
 * Transforme les stats ARCEP d'une ligne (line-stats.ts) en phrases françaises
 * naturelles pour les pages SEO — l'objectif est du contenu UNIQUE et factuel,
 * pas un dump de chiffres. Mutualisé entre /ligne, /operateur et les croisées.
 *
 * Vocabulaire ARCEP (cf. docs/PRODUCT.md) :
 *   TBC très bonne couverture (streaming, visio) · BC bonne (web, réseaux) ·
 *   CL  limitée (messages, navigation lente)     · none zone blanche.
 */
import type { LevelDist, LineStats } from './line-stats';

const NBSP = ' ';

/**
 * Formate une fraction en pourcentage entier français (« 78 % »). Borné à
 * [0, 100] : les fractions sont arrondies indépendamment côté build, donc une
 * somme (ex. TBC+BC) peut frôler 100,01 % — on évite tout « 101 % ».
 */
export function pct(x: number): string {
	return `${Math.min(100, Math.max(0, Math.round(x * 100)))}${NBSP}%`;
}

/** Énumération française : [a] → « a » ; [a,b] → « a et b » ; [a,b,c] → « a, b et c ». */
export function joinFr(items: string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** Part « utilisable » (très bonne + bonne couverture) pour un opérateur. */
const usable = (d: LevelDist) => d.TBC + d.BC;

/**
 * Phrase décrivant la couverture annoncée d'un opérateur sur une ligne.
 * Ex. « Orange est annoncé en très bonne couverture sur 97 % du parcours. »
 */
export function describeOperator(name: string, d: LevelDist): string {
	let s: string;
	if (d.TBC >= 0.75) {
		s = `${name} est annoncé en très bonne couverture (streaming, visio) sur ${pct(d.TBC)} du parcours`;
	} else if (usable(d) >= 0.7) {
		s = `${name} est annoncé en bonne à très bonne couverture sur ${pct(usable(d))} du parcours`;
	} else {
		s = `la couverture ${name} annoncée est inégale : correcte sur ${pct(usable(d))} du parcours seulement`;
	}
	if (d.none >= 0.05) s += `, avec ${pct(d.none)} du trajet sans réseau annoncé`;
	return s + '.';
}

/** Pourcentage saillant pour les <meta> / titres : couverture « au mieux » (best TBC). */
export function bestTbcPct(stats: LineStats): string {
	return pct(stats.best.TBC);
}

/** Noms de gares (dédupliqués) en tête des zones blanches d'une ligne. */
export function whiteZoneStations(stats: LineStats, max = 3): string[] {
	const seen = new Set<string>();
	for (const z of stats.zonesBlanches.zones) {
		if (!seen.has(z.after)) seen.add(z.after);
		if (seen.size >= max) break;
	}
	return [...seen];
}

/**
 * Phrase sur les zones blanches connues d'une ligne.
 * Ex. « 2 zones blanches sont connues, notamment après Vierzon et Châteauroux. »
 * Renvoie une chaîne vide si aucune zone blanche significative.
 */
export function describeWhiteZones(stats: LineStats): string {
	const { count } = stats.zonesBlanches;
	if (count === 0) return '';
	const stations = whiteZoneStations(stats);
	const noun = count > 1 ? `${count} zones blanches sont connues` : `1 zone blanche est connue`;
	const where = stations.length ? `, notamment après ${joinFr(stations)}` : '';
	return `${noun}${where}.`;
}

/**
 * `<meta description>` enrichie d'un chiffre saillant pour une page LIGNE.
 */
export function lineMetaDescription(
	lineName: string,
	from: string,
	to: string,
	stats: LineStats | undefined
): string {
	if (!stats) {
		return `Où ça capte sur la ligne ${lineName} ? Carte communautaire de la couverture mobile 4G/5G dans le train entre ${from} et ${to}.`;
	}
	const zones = stats.zonesBlanches.count;
	const zonesTxt =
		zones > 0
			? ` ${zones} zone${zones > 1 ? 's' : ''} blanche${zones > 1 ? 's' : ''} connue${zones > 1 ? 's' : ''}.`
			: '';
	return `Couverture 4G/5G annoncée excellente sur ${bestTbcPct(stats)} du trajet ${from}–${to}.${zonesTxt} Comparée aux mesures réelles des voyageurs sur la ligne ${lineName}.`;
}

/**
 * `<meta description>` enrichie pour une page LIGNE × OPÉRATEUR.
 */
export function crossMetaDescription(
	opName: string,
	lineName: string,
	from: string,
	to: string,
	d: LevelDist | undefined
): string {
	if (!d) {
		return `Est-ce que ${opName} capte sur la ligne ${lineName} entre ${from} et ${to} ? Carte de la couverture 4G/5G ${opName}, mesures réelles des voyageurs incluses.`;
	}
	return `${opName} est annoncé en couverture 4G/5G sur ${pct(usable(d))} du trajet ${from}–${to}${
		d.none >= 0.05 ? ` (${pct(d.none)} sans réseau)` : ''
	}. Couverture théorique ARCEP croisée avec les mesures réelles des voyageurs.`;
}
