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
 * Détecteur incrémental (streaming). On lui pousse les échantillons un par un
 * via `observe` ; il renvoie un épisode dès qu'une coupure se termine. `finalize`
 * clôt proprement une coupure encore en cours (arrêt en zone blanche).
 */
export class OutageDetector {
	private startedAt: number | null = null;
	private lastNoneAt = 0;
	/** Positions connues (non nulles) pendant les `none`, dans l'ordre. */
	private positions: Position[] = [];
	/** Vitesses connues pendant les `none`, pour le fallback longueur. */
	private speeds: number[] = [];

	private get inOutage(): boolean {
		return this.startedAt !== null;
	}

	/**
	 * Observe un échantillon. Retourne l'épisode clos si le réseau vient de
	 * revenir, sinon null.
	 */
	observe(s: OutageSample): OutageEpisode | null {
		if (s.status === 'none') {
			if (!this.inOutage) {
				this.startedAt = s.measuredAt;
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

	/** Clôt une coupure encore ouverte (session arrêtée en zone blanche). */
	finalize(): OutageEpisode | null {
		if (!this.inOutage) return null;
		return this.close(this.lastNoneAt, null, false);
	}

	/** Réinitialise pour une nouvelle session. */
	reset(): void {
		this.startedAt = null;
		this.lastNoneAt = 0;
		this.positions = [];
		this.speeds = [];
	}

	private close(endedAt: number, recovery: Position | null, terminated: boolean): OutageEpisode {
		const startedAt = this.startedAt as number;
		const durationS = Math.max(0, (endedAt - startedAt) / 1000);

		// Chemin parcouru : positions des `none` + position de reprise si connue.
		const path = recovery ? [...this.positions, recovery] : this.positions;
		let pathLength = 0;
		for (let i = 1; i < path.length; i++) {
			pathLength += distanceM(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
		}
		// Fallback tunnel (GPS figé / absent) : vitesse moyenne × durée.
		const avgSpeedKmh = this.speeds.length
			? this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length
			: 0;
		const fallbackLength = (avgSpeedKmh / 3.6) * durationS;
		const lengthM = Math.round(Math.max(pathLength, fallbackLength));

		const cellStart = this.positions.length
			? toCell(this.positions[0].lat, this.positions[0].lng)
			: null;
		const endPos = recovery ?? this.positions[this.positions.length - 1] ?? null;
		const cellEnd = endPos ? toCell(endPos.lat, endPos.lng) : null;

		this.reset();
		return { startedAt, endedAt, durationS, lengthM, cellStart, cellEnd, terminated };
	}
}

/**
 * Détection en lot : reconstruit tous les épisodes d'une suite d'échantillons
 * (typiquement les mesures d'une session, côté serveur). Réutilise exactement
 * la même logique que le mode streaming.
 */
export function detectOutages(samples: OutageSample[]): OutageEpisode[] {
	const ordered = [...samples].sort((a, b) => a.measuredAt - b.measuredAt);
	const detector = new OutageDetector();
	const episodes: OutageEpisode[] = [];
	for (const s of ordered) {
		const ep = detector.observe(s);
		if (ep) episodes.push(ep);
	}
	const last = detector.finalize();
	if (last) episodes.push(last);
	return episodes;
}
