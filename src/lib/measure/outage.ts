/**
 * Détection des épisodes de coupure réseau.
 *
 * POURQUOI : le projet ne captait que des points indépendants (`ok`/`degraded`/
 * `none`). La donnée à plus forte valeur produit est la *durée* d'une coupure :
 * « tu perdras le réseau pendant 1 min 40 s après telle gare ». Un épisode est
 * une transition `ok|degraded → none … → ok|degraded`.
 *
 * Logique PURE et injectable (aucune dépendance DOM), testable sans navigateur —
 * sur le modèle de `queue.ts`. Elle tourne à deux endroits avec le MÊME code :
 *   - côté client (live) : flux d'échantillons en mémoire → retour éphémère ;
 *   - côté serveur (lecture) : points bruts d'une session → agrégats.
 *
 * On ne stocke jamais l'épisode : il est toujours *dérivé* des mesures `none`
 * consécutives. La seule donnée persistée en plus est l'instant de mesure
 * (`measuredAt`) sur chaque mesure brute.
 */
import { toCell } from '$geo/h3';
import { distanceM } from '$geo/distance';

export type NetworkStatus = 'ok' | 'degraded' | 'none';

/** Un échantillon ordonné dans le temps (issu d'un ping + position GPS). */
export interface OutageSample {
	/** Instant de la mesure (époch ms). */
	measuredAt: number;
	status: NetworkStatus;
	/** Position GPS ; null si indisponible (tunnel, GPS figé). */
	lat: number | null;
	lng: number | null;
	/** Vitesse en km/h ; null si l'appareil ne la fournit pas. */
	speedKmh: number | null;
}

/** Un épisode de coupure clos (réseau perdu puis retrouvé, ou session arrêtée). */
export interface OutageEpisode {
	/** Instant du 1er `none` (époch ms). */
	startedAt: number;
	/** Instant de reprise (ou du dernier `none` si non terminé) (époch ms). */
	endedAt: number;
	/** Durée de la coupure en secondes. */
	durationS: number;
	/** Distance parcourue pendant la coupure en mètres (path GPS ou vitesse×durée). */
	lengthM: number;
	/** Cellule H3 où la coupure commence (null si position inconnue). */
	cellStart: string | null;
	/** Cellule H3 où le réseau revient (null si position inconnue). */
	cellEnd: string | null;
	/** false si la coupure était encore en cours à l'arrêt (clôture forcée). */
	terminated: boolean;
}

interface Position {
	lat: number;
	lng: number;
}

/**
 * Écart de temps au-delà duquel on considère qu'il y a eu une INTERRUPTION de la
 * mesure (l'utilisateur a quitté l'app, mis l'écran en veille, etc.) plutôt qu'une
 * coupure continue. Une même `sessionId` survit entre deux trajets : sans cette
 * borne, deux trajets espacés de plusieurs heures se fondraient en une coupure
 * géante. Au-delà du seuil, l'épisode en cours est clos comme **non terminé**
 * (`terminated: false`) — donc exclu des agrégats serveur, puisqu'on ne connaît
 * pas sa vraie fin (le réseau est peut-être revenu pendant que l'app dormait).
 */
export const MAX_SAMPLE_GAP_MS = 5 * 60_000;

/**
 * Détecteur incrémental (streaming). On lui pousse les échantillons un par un
 * via `observe` ; il renvoie un épisode dès qu'une coupure se termine. `finalize`
 * clôt proprement une coupure encore en cours (arrêt en zone blanche).
 */
export class OutageDetector {
	private startedAt: number | null = null;
	private lastNoneAt = 0;
	/** Horodatage du dernier échantillon vu (tout statut), pour détecter un trou. */
	private lastSampleAt: number | null = null;
	/** Positions connues (non nulles) pendant les `none`, dans l'ordre. */
	private positions: Position[] = [];
	/** Vitesses connues pendant les `none`, pour le fallback longueur. */
	private speeds: number[] = [];
	/** Dernière vitesse connue, tout statut confondu (sert de repli en tunnel). */
	private lastKnownSpeedKmh: number | null = null;
	/** Vitesse juste avant l'entrée en coupure : meilleure estimation en tunnel
	 *  (le GPS n'y fournit souvent plus de vitesse → `this.speeds` reste vide). */
	private entrySpeedKmh: number | null = null;

	constructor(private readonly maxGapMs = MAX_SAMPLE_GAP_MS) {}

	private get inOutage(): boolean {
		return this.startedAt !== null;
	}

	/**
	 * Observe un échantillon. Retourne l'épisode clos si le réseau vient de
	 * revenir (ou si un trou de mesure interrompt une coupure), sinon null.
	 */
	observe(s: OutageSample): OutageEpisode | null {
		// Trou de mesure pendant une coupure → on clôt en « non terminé » (l'app a
		// probablement été quittée) AVANT de traiter le nouvel échantillon.
		let gapClosed: OutageEpisode | null = null;
		if (
			this.inOutage &&
			this.lastSampleAt != null &&
			s.measuredAt - this.lastSampleAt > this.maxGapMs
		) {
			gapClosed = this.close(this.lastNoneAt, null, false);
		}

		const normal = this.ingest(s);
		this.lastSampleAt = s.measuredAt;
		if (s.speedKmh != null) this.lastKnownSpeedKmh = s.speedKmh;
		// Au plus l'un des deux est non nul : après une clôture sur trou, `ingest`
		// ne peut que rouvrir (none → null) ou ne rien faire (ok → null).
		return gapClosed ?? normal;
	}

	private ingest(s: OutageSample): OutageEpisode | null {
		if (s.status === 'none') {
			if (!this.inOutage) {
				this.startedAt = s.measuredAt;
				this.entrySpeedKmh = this.lastKnownSpeedKmh;
			}
			this.lastNoneAt = s.measuredAt;
			if (s.lat != null && s.lng != null) this.positions.push({ lat: s.lat, lng: s.lng });
			if (s.speedKmh != null) this.speeds.push(s.speedKmh);
			return null;
		}

		// status ok|degraded : clôt une éventuelle coupure en cours.
		if (!this.inOutage) return null;
		const recovery: Position | null =
			s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null;
		return this.close(s.measuredAt, recovery, true);
	}

	/**
	 * Instant de début (époch ms) de la coupure encore OUVERTE, sinon null.
	 * Sert au retour live « pas de réseau depuis X s » — l'épisode clos, lui,
	 * n'arrive qu'à la reprise du réseau via `observe`/`finalize`.
	 */
	currentOutageStart(): number | null {
		return this.startedAt;
	}

	/** Clôt une coupure encore ouverte (session arrêtée en zone blanche). */
	finalize(): OutageEpisode | null {
		if (!this.inOutage) return null;
		return this.close(this.lastNoneAt, null, false);
	}

	/** Réinitialise pour une nouvelle session. */
	reset(): void {
		this.startedAt = null;
		this.lastNoneAt = 0;
		this.lastSampleAt = null;
		this.positions = [];
		this.speeds = [];
		this.lastKnownSpeedKmh = null;
		this.entrySpeedKmh = null;
	}

	private close(endedAt: number, recovery: Position | null, terminated: boolean): OutageEpisode {
		const startedAt = this.startedAt as number;
		const entrySpeedKmh = this.entrySpeedKmh;
		const durationS = Math.max(0, (endedAt - startedAt) / 1000);

		// Chemin parcouru : positions des `none` + position de reprise si connue.
		// NB côté serveur, les positions sont des centres de cellule H3 (anonymisées) :
		// le path y est quantifié au pas de cellule (~150 m). La longueur serveur
		// repose donc surtout sur le fallback vitesse×durée (cf. docs/PRODUCT.md).
		const path = recovery ? [...this.positions, recovery] : this.positions;
		let pathLength = 0;
		for (let i = 1; i < path.length; i++) {
			pathLength += distanceM(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
		}
		// Fallback tunnel : vitesse moyenne pendant la coupure si on l'a, sinon la
		// vitesse connue juste avant (le GPS d'un tunnel ne donne souvent pas de
		// vitesse, et celle d'un train est quasi constante).
		const avgSpeedKmh = this.speeds.length
			? this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length
			: (entrySpeedKmh ?? 0);
		const fallbackLength = (avgSpeedKmh / 3.6) * durationS;
		const lengthM = Math.round(Math.max(pathLength, fallbackLength));

		const cellStart = this.positions.length
			? toCell(this.positions[0].lat, this.positions[0].lng)
			: null;
		const endPos = recovery ?? this.positions.at(-1) ?? null;
		const cellEnd = endPos ? toCell(endPos.lat, endPos.lng) : null;

		// Conserve l'historique de vitesse/horodatage (un trou peut enchaîner sur
		// une nouvelle coupure) mais oublie l'épisode clos.
		this.startedAt = null;
		this.lastNoneAt = 0;
		this.positions = [];
		this.speeds = [];
		this.entrySpeedKmh = null;
		return { startedAt, endedAt, durationS, lengthM, cellStart, cellEnd, terminated };
	}
}

/**
 * Détection en lot : reconstruit tous les épisodes d'une suite d'échantillons
 * (typiquement les mesures d'une session, côté serveur). Réutilise exactement
 * la même logique que le mode streaming.
 */
export function detectOutages(
	samples: OutageSample[],
	maxGapMs = MAX_SAMPLE_GAP_MS
): OutageEpisode[] {
	const ordered = [...samples].sort((a, b) => a.measuredAt - b.measuredAt);
	const detector = new OutageDetector(maxGapMs);
	const episodes: OutageEpisode[] = [];
	for (const s of ordered) {
		const ep = detector.observe(s);
		if (ep) episodes.push(ep);
	}
	const last = detector.finalize();
	if (last) episodes.push(last);
	return episodes;
}
