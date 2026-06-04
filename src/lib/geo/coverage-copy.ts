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
import type { LineReal, Blackspot } from './line-real';
import { OPERATOR_LABEL, type UsageOp } from '../usage';

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

// ===========================================================================
// VERDICT « réponse d'abord » + points noirs (langage usager — cf. spec §2–4).
// ===========================================================================

const fmtDur = (s: number) => (s >= 60 ? `~${Math.round(s / 60)} min` : `~${Math.round(s)} s`);
const fmtLen = (m: number) => (m >= 1000 ? `~${(m / 1000).toFixed(1)} km` : `~${Math.round(m)} m`);

/** Tronque une chaîne à `max` caractères SANS couper un mot (ajoute « … »). */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/**
 * Élision « que » → « qu' » devant une voyelle. Ex. `Est-ce ${elideQue('Orange')} capte` →
 * « Est-ce qu'Orange capte » ; `elideQue('SFR')` → « que SFR ».
 */
export function elideQue(name: string): string {
	return /^[aeiouyàâäéèêëîïôöùûü]/i.test(name) ? `qu'${name}` : `que ${name}`;
}

/** Libellé d'un point noir mesuré (titre + détail), en langage usager. */
export function blackspotLabel(b: Blackspot): { head: string; detail: string } {
	if (b.durationS > 0) {
		return {
			head: `Après ${b.afterStation} — ça coupe ${fmtDur(b.durationS)}`,
			detail: b.lengthM ? `sur ${fmtLen(b.lengthM)}` : ''
		};
	}
	return {
		head: `Après ${b.afterStation} — pas de réseau`,
		detail: b.lengthM ? fmtLen(b.lengthM) : ''
	};
}

/**
 * Regroupe les points noirs PAR GARE de référence : évite d'afficher 5 fois « Après
 * {même gare} ». Une coupure isolée garde son libellé ; plusieurs au même endroit
 * deviennent « Après {gare} — N coupures (la plus longue …) ».
 */
export function groupBlackspots(spots: Blackspot[]): { head: string; detail: string }[] {
	const byStation = new Map<string, Blackspot[]>();
	const order: string[] = [];
	for (const s of spots) {
		if (!byStation.has(s.afterStation)) order.push(s.afterStation);
		byStation.set(s.afterStation, [...(byStation.get(s.afterStation) ?? []), s]);
	}
	return order.map((st) => {
		const arr = byStation.get(st)!;
		if (arr.length === 1) return blackspotLabel(arr[0]);
		const maxDur = Math.max(...arr.map((a) => a.durationS));
		const totalLen = arr.reduce((s, a) => s + a.lengthM, 0);
		return {
			head: `Après ${st} — ${arr.length} coupures`,
			detail:
				maxDur > 0
					? `la plus longue ${fmtDur(maxDur)}, sur ${fmtLen(totalLen)} cumulés`
					: `${fmtLen(totalLen)} cumulés`
		};
	});
}

/**
 * Points noirs à afficher : les coupures mesurées (regroupées) si on en a, sinon les
 * zones blanches ARCEP en repli. Mutualisé entre la page ligne et la page opérateur.
 */
export function buildBlackspots(
	real: LineReal,
	stats: LineStats | null
): { head: string; detail: string }[] {
	if (real.blackspots.length) return groupBlackspots(real.blackspots);
	return (stats?.zonesBlanches.zones ?? []).map((z) => ({
		head: `Après ${z.after} — aucun réseau annoncé`,
		detail: `~${Math.round(z.lengthKm)} km`
	}));
}

/** Fraîcheur lisible d'une mesure (epoch s), relativement à `nowSec`. Null si jamais mesuré. */
export function freshnessLabel(lastSeenSec: number, nowSec: number): string | null {
	if (!lastSeenSec) return null;
	const days = Math.floor((nowSec - lastSeenSec) / 86400);
	if (days <= 0) return "mesuré aujourd'hui";
	if (days === 1) return 'mesuré hier';
	if (days < 30) return `dernière mesure il y a ${days} jours`;
	const months = Math.floor(days / 30);
	return months <= 1 ? 'dernière mesure il y a 1 mois' : `dernière mesure il y a ${months} mois`;
}

/** Verdict structuré d'une ligne : « la réponse d'abord » (réel si fiable, sinon ARCEP). */
export interface Verdict {
	/** Phrase principale (« ça capte ou pas »). */
	lead: string;
	/** Mention des coupures, ou null. */
	cuts: string | null;
	/** Meilleur opérateur, ou null. */
	best: string | null;
	/** Comparaison annoncé ↔ réel, ou null. */
	gap: string | null;
	/** Source / invitation à contribuer. */
	source: string;
	/** Tonalité pour la couleur du bloc. */
	tone: 'good' | 'mixed' | 'bad' | 'unknown';
	/** Verdict basé sur le réel mesuré (true) ou l'ARCEP (false). */
	measured: boolean;
}

/**
 * Construit le verdict d'une ligne (ou d'une ligne × opérateur si `opts.operatorName`).
 * Si le réel couvre assez le trajet (`real.sufficient`), on parle « d'après les
 * voyageurs » ; sinon on reste sur l'annoncé ARCEP et on invite à mesurer (spec §3).
 * `opts.arcepDist` = répartition ARCEP à comparer (celle de l'opérateur sur la page
 * opérateur ; sinon `stats.best`, « au mieux »).
 */
export function buildVerdict(
	from: string,
	to: string,
	stats: LineStats | null,
	real: LineReal,
	opts: { operatorName?: string; arcepDist?: LevelDist } = {}
): Verdict {
	const dist = opts.arcepDist ?? stats?.best ?? null;
	const arcepUsable = dist ? Math.round((dist.TBC + dist.BC) * 100) : null;
	const arcepTbc = dist ? Math.round(dist.TBC * 100) : null;
	const op = opts.operatorName;
	const opLabel = (k: string) => OPERATOR_LABEL[k as UsageOp] ?? k;

	if (real.sufficient) {
		const g = real.goodPct;
		const tone: Verdict['tone'] = g >= 70 ? 'good' : g >= 40 ? 'mixed' : 'bad';
		// Le libellé s'adapte à la tonalité (sinon « ça capte bien sur 25 % » serait faux).
		const quality =
			tone === 'good'
				? `ça capte bien sur ${g}${NBSP}% du parcours — de quoi regarder une vidéo`
				: tone === 'mixed'
					? `ça capte sur ${g}${NBSP}% du parcours, mais la couverture est inégale`
					: `ça capte mal — seulement ${g}${NBSP}% du parcours, le réseau est souvent absent`;
		return {
			lead: op
				? `D'après les voyageurs, avec ${op} ${quality}.`
				: `D'après les voyageurs, entre ${from} et ${to} ${quality}.`,
			cuts: real.blackspots.length
				? `${real.blackspots.length} zone${real.blackspots.length > 1 ? 's' : ''} où ça coupe, notamment après ${real.blackspots[0].afterStation}.`
				: null,
			best: op ? null : real.bestOperator ? `Au mieux : ${opLabel(real.bestOperator)}.` : null,
			// Dé-jargon : « sur le papier vs dans le train » plutôt que « ARCEP / excellente couverture ».
			gap:
				arcepTbc != null && Math.abs(arcepTbc - g) >= 10
					? `Sur le papier : ${arcepTbc}${NBSP}% ; dans le train : ${g}${NBSP}%.`
					: null,
			// Transparence : signaler quand les mesures viennent surtout d'un opérateur.
			source:
				`D'après ${real.samples.toLocaleString('fr-FR')} mesure${real.samples > 1 ? 's' : ''} de voyageurs` +
				(!op && real.operatorMix && real.operatorMix.share >= 0.7
					? ` (principalement ${opLabel(real.operatorMix.operator)})`
					: '') +
				'.',
			tone,
			measured: true
		};
	}

	return {
		lead:
			arcepUsable != null
				? op
					? `Avec ${op} entre ${from} et ${to}, le réseau est annoncé bon sur ${arcepUsable}${NBSP}% du trajet — selon les déclarations des opérateurs.`
					: `Entre ${from} et ${to}, le réseau est annoncé bon sur ${arcepUsable}${NBSP}% du trajet — selon les déclarations des opérateurs.`
				: `La couverture ${op ? op + ' ' : ''}entre ${from} et ${to} dépend des zones traversées.`,
		cuts: null,
		best: null,
		gap: null,
		source:
			real.samples > 0
				? `Mesures encore partielles (${real.coveragePct}${NBSP}% du trajet observé) — activez le mode mesure pour préciser.`
				: `Pas encore de mesures de voyageurs ici — soyez le premier à les enregistrer.`,
		tone: 'unknown',
		measured: false
	};
}
