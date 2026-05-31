/**
 * Orchestrateur du mode mesure (côté client).
 *
 * Relie les briques bas niveau : suivi GPS (geolocation), test de connectivité
 * (ping), maintien de l'écran (wakeLock), type de réseau bonus (netinfo) et
 * session anonyme (session). À chaque position GPS reçue, on déclenche un ping,
 * on assemble une mesure et on l'envoie à l'API — uniquement si le consentement
 * a été donné.
 *
 * Conçu pour être piloté par l'UI Svelte via des callbacks d'état réactifs.
 */
import { ping, type PingStatus } from './ping';
import { GeoTracker, type GeoSample } from './geolocation';
import { ScreenWakeLock } from './wakeLock';
import { readNetworkType } from './netinfo';
import { getSessionId, hasConsent } from './session';
import { MeasurementQueue, type QueuedMeasurement } from './queue';
import { OutageDetector } from './outage';

export type Operator = 'orange' | 'sfr' | 'free' | 'bouygues' | 'autre' | 'inconnu';

export interface LiveState {
	running: boolean;
	status: PingStatus | 'idle';
	rttMs: number | null;
	lat: number | null;
	lng: number | null;
	speedKmh: number | null;
	accuracy: number | null;
	netType: string | null;
	/** Mesures confirmées côté serveur. */
	sent: number;
	/** Mesures en attente d'envoi (hors-ligne / tunnel). */
	queued: number;
	/** Nombre de coupures réseau détectées pendant la session (live, éphémère). */
	outages: number;
	/** Dernière coupure clôturée, pour le retour « coupure de 1 min 40 s ». */
	lastOutage: { durationS: number; lengthM: number } | null;
	wakeLockActive: boolean;
	error: string | null;
}

export interface ControllerOptions {
	operator: Operator;
	onState: (s: LiveState) => void;
	endpoint?: string;
}

const initialState: LiveState = {
	running: false,
	status: 'idle',
	rttMs: null,
	lat: null,
	lng: null,
	speedKmh: null,
	accuracy: null,
	netType: null,
	sent: 0,
	queued: 0,
	outages: 0,
	lastOutage: null,
	wakeLockActive: false,
	error: null
};

/** Intervalle de tentative de vidage de la file (ms) tant que le mode tourne. */
const FLUSH_INTERVAL_MS = 15_000;

export class MeasurementController {
	private geo = new GeoTracker();
	private wake = new ScreenWakeLock();
	private queue = new MeasurementQueue();
	/** Détection live des coupures (éphémère : alimente seulement l'UI, rien n'est
	 *  persisté ici — la vérité stockée est dérivée côté serveur des mesures brutes). */
	private detector = new OutageDetector();
	private state: LiveState = { ...initialState };
	private opts: ControllerOptions;
	/** Évite les pings concurrents si le GPS pousse des positions rapprochées. */
	private busy = false;
	/** Évite les vidages de file concurrents. */
	private flushing = false;
	private flushTimer: ReturnType<typeof setInterval> | null = null;

	constructor(opts: ControllerOptions) {
		this.opts = opts;
	}

	get supported(): boolean {
		return this.geo.isSupported;
	}

	setOperator(operator: Operator) {
		this.opts.operator = operator;
	}

	async start(): Promise<void> {
		if (this.state.running) return;
		if (!this.geo.isSupported) {
			this.patch({ error: "La géolocalisation n'est pas disponible sur cet appareil." });
			return;
		}
		// On conserve la file existante (mesures d'une session précédente non envoyées).
		this.detector.reset();
		this.patch({ ...initialState, running: true, queued: this.queue.size });

		const ok = this.geo.start(
			(sample) => void this.handleSample(sample),
			(err) => this.handleGeoError(err)
		);
		if (!ok) {
			this.patch({ running: false, error: 'Impossible de démarrer le GPS.' });
			return;
		}

		const wakeOk = await this.wake.acquire();
		// stop() a pu être appelé pendant l'attente (ex. refus de géoloc qui déclenche
		// handleGeoError → stop). On ne doit pas réarmer listener/timer ni garder le
		// wake lock dans ce cas.
		if (!this.state.running) {
			await this.wake.release();
			return;
		}
		this.patch({ wakeLockActive: wakeOk });

		// Rejoue la file dès que la connexion revient + à intervalle régulier.
		if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
		this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
		void this.flush();
	}

	async stop(): Promise<void> {
		this.geo.stop();
		await this.wake.release();
		if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
		if (this.flushTimer !== null) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
		// Clôt proprement une coupure encore en cours (arrêt en zone blanche).
		const ep = this.detector.finalize();
		if (ep) {
			this.patch({
				outages: this.state.outages + 1,
				lastOutage: { durationS: ep.durationS, lengthM: ep.lengthM }
			});
		}
		// Ultime tentative d'envoi de ce qui reste avant l'arrêt.
		await this.flush();
		this.patch({ running: false, status: 'idle', wakeLockActive: false });
	}

	private onOnline = () => void this.flush();

	/**
	 * Erreurs GPS : on distingue le refus de permission (fatal, on arrête) du
	 * timeout / indisponibilité temporaire (transitoire, on informe sans arrêter).
	 */
	private handleGeoError(err: GeolocationPositionError): void {
		if (err.code === err.PERMISSION_DENIED) {
			this.patch({ error: 'Géolocalisation refusée. Autorisez-la pour mesurer.' });
			void this.stop();
		} else if (err.code === err.POSITION_UNAVAILABLE) {
			this.patch({ error: 'Position indisponible (tunnel, sous-sol…). Reprise dès que possible.' });
		} else {
			this.patch({ error: 'Signal GPS lent à se fixer…' });
		}
	}

	private async handleSample(sample: GeoSample): Promise<void> {
		// Une position valide efface un éventuel message d'erreur GPS transitoire.
		this.patch({
			lat: sample.lat,
			lng: sample.lng,
			speedKmh: sample.speedKmh,
			accuracy: sample.accuracy,
			error: null
		});
		if (this.busy) return;
		this.busy = true;
		try {
			const { status, rttMs } = await ping(this.opts.endpoint);
			const netType = readNetworkType();
			this.patch({ status, rttMs, netType });

			// Détection live des coupures (indépendante du consentement : c'est de
			// l'affichage éphémère sur SA session, rien n'est envoyé d'ici).
			const ep = this.detector.observe({
				measuredAt: sample.timestamp,
				status,
				lat: sample.lat,
				lng: sample.lng,
				speedKmh: sample.speedKmh
			});
			if (ep) {
				this.patch({
					outages: this.state.outages + 1,
					lastOutage: { durationS: ep.durationS, lengthM: ep.lengthM }
				});
			}

			if (hasConsent()) {
				// On ENFILE systématiquement (même « none »), puis on tente de vider.
				// Ainsi les zones blanches — où l'envoi direct échouerait — sont gardées.
				this.queue.enqueue({
					lat: sample.lat,
					lng: sample.lng,
					status,
					rttMs,
					operator: this.opts.operator,
					netType,
					speedKmh: sample.speedKmh,
					gpsAccuracy: sample.accuracy,
					measuredAt: sample.timestamp,
					sessionId: getSessionId()
				});
				this.patch({ queued: this.queue.size });
				await this.flush();
			}
		} finally {
			this.busy = false;
		}
	}

	/** Vide la file vers l'API ; s'arrête à la première erreur (réseau coupé). */
	private async flush(): Promise<void> {
		if (this.flushing) return;
		this.flushing = true;
		try {
			const sent = await this.queue.flush((m) => this.post(m));
			if (sent > 0) {
				this.patch({ sent: this.state.sent + sent, queued: this.queue.size });
			}
		} finally {
			this.flushing = false;
		}
	}

	/** Envoie une mesure. Retourne true si acceptée (à retirer de la file). */
	private async post(m: QueuedMeasurement): Promise<boolean> {
		try {
			const res = await fetch('/api/measurements', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(m)
			});
			// 2xx = accepté. 4xx (sauf 429) = mesure invalide, inutile de la garder.
			if (res.ok) return true;
			if (res.status >= 400 && res.status < 500 && res.status !== 429) return true;
			return false; // 429 (rate-limit) ou 5xx : on garde et on réessaiera
		} catch {
			return false; // hors-ligne : on garde en file
		}
	}

	private patch(partial: Partial<LiveState>): void {
		this.state = { ...this.state, ...partial };
		this.opts.onState(this.state);
	}
}
