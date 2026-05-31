/**
 * File d'attente persistante des mesures non encore envoyées.
 *
 * POURQUOI c'est essentiel : les zones où l'envoi échoue (pas de réseau) sont
 * exactement celles qui nous intéressent le plus (zones blanches). Sans file,
 * `fetch` échoue et la mesure « ça coupe » est perdue — on raterait la donnée la
 * plus précieuse du projet. On stocke donc les mesures localement et on les
 * rejoue dès que la connexion revient.
 *
 * La file est bornée (FIFO) pour ne pas grossir indéfiniment hors-ligne, et
 * persistée pour survivre à un rechargement / passage de tunnel prolongé.
 *
 * Storage injectable (par défaut localStorage) → testable sans DOM.
 */

/** Payload exact envoyé à POST /api/measurements. */
export interface QueuedMeasurement {
	lat: number;
	lng: number;
	status: 'ok' | 'degraded' | 'none';
	rttMs: number | null;
	/** Gigue (ms) issue de la rafale de pings. null si <2 succès. */
	jitterMs: number | null;
	/** Taux de perte de paquets de la rafale, 0..1. null si non mesuré. */
	loss: number | null;
	/** Débit descendant (kbps). null quand non mesuré (opt-in + cadencé). */
	downlinkKbps: number | null;
	operator: string;
	netType: string | null;
	speedKmh: number | null;
	gpsAccuracy: number | null;
	/** Instant réel de la mesure (époch ms). Indispensable pour reconstruire la
	 *  chronologie des coupures : `createdAt` côté serveur est l'instant d'INSERTION,
	 *  faussé par le rejeu hors-ligne (une mesure de tunnel arrive bien après sa capture). */
	measuredAt: number;
	sessionId: string;
}

/** Sous-ensemble de l'API Storage dont on a besoin (web Storage compatible). */
export interface KeyValueStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const QUEUE_KEY = '4gdt.queue';
/** Au-delà, on jette les plus anciennes (un trajet = beaucoup de points). */
const MAX_QUEUE = 500;

export class MeasurementQueue {
	private store: KeyValueStore | null;

	constructor(store?: KeyValueStore) {
		// En SSR / environnement sans storage, la file devient un no-op silencieux.
		this.store = store ?? (typeof localStorage !== 'undefined' ? localStorage : null);
	}

	private read(): QueuedMeasurement[] {
		if (!this.store) return [];
		try {
			const raw = this.store.getItem(QUEUE_KEY);
			const parsed = raw ? JSON.parse(raw) : [];
			return Array.isArray(parsed) ? (parsed as QueuedMeasurement[]) : [];
		} catch {
			return [];
		}
	}

	private write(items: QueuedMeasurement[]): void {
		if (!this.store) return;
		try {
			this.store.setItem(QUEUE_KEY, JSON.stringify(items));
		} catch {
			/* quota dépassé / storage indisponible : on abandonne silencieusement */
		}
	}

	get size(): number {
		return this.read().length;
	}

	/** Ajoute une mesure en fin de file (FIFO), en bornant la taille. */
	enqueue(m: QueuedMeasurement): void {
		const items = this.read();
		items.push(m);
		// On garde les plus récentes si on dépasse le plafond.
		this.write(items.length > MAX_QUEUE ? items.slice(items.length - MAX_QUEUE) : items);
	}

	/**
	 * Rejoue la file via `send`. Chaque mesure acceptée (send → true) est retirée ;
	 * à la première qui échoue (send → false), on s'arrête et on garde le reste
	 * (l'ordre est préservé, on réessaiera plus tard). Retourne le nombre envoyé.
	 */
	async flush(send: (m: QueuedMeasurement) => Promise<boolean>): Promise<number> {
		let items = this.read();
		let sent = 0;
		while (items.length > 0) {
			const ok = await send(items[0]);
			if (!ok) break;
			items = items.slice(1);
			this.write(items); // persistance incrémentale : un crash ne reperd pas tout
			sent++;
		}
		return sent;
	}

	clear(): void {
		this.write([]);
	}
}
