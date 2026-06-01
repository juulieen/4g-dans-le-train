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
import { reconstructAlongPath, type PathPoint } from '$geo/interpolate';

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
	/** Pings capturés sans position (trou GPS), en attente de recalage sur le tracé. */
	buffered: number;
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
	buffered: 0,
	outages: 0,
	lastOutage: null,
	wakeLockActive: false,
	error: null
};

/** Intervalle de tentative de vidage de la file (ms) tant que le mode tourne. */
const FLUSH_INTERVAL_MS = 15_000;

/**
 * Mesure pendant un trou GPS (tunnel, tranchée). Le mode normal est piloté par les
 * événements GPS ; quand ils s'arrêtent, plus aucun ping n'est émis. On ajoute donc
 * un tick de secours qui, UNIQUEMENT en l'absence de GPS frais, continue à pinguer
 * et bufferise les mesures sans position. À la reprise GPS « sur les rails », on
 * reconstruit leur position par interpolation le long du tracé (cf. commitGap).
 */
/** Cadence du ping de secours pendant un trou GPS (ms). */
const GAP_PING_TICK_MS = 5_000;
/** Au-delà de ce délai sans position GPS valide, on considère être dans un trou. */
const GAP_THRESHOLD_MS = 10_000;
/** Durée max d'un trou encore interpolable (au-delà, buffer jeté). Cf. MAX_SAMPLE_GAP_MS. */
const MAX_GAP_MS = 5 * 60_000;
/** Distance max (m) entre un point GPS et le tracé pour le juger « sur les rails ». */
const SNAP_MAX_M = 1_000;
/** Plafond du buffer de trou (≈ MAX_GAP_MS / GAP_PING_TICK_MS, avec un peu de marge). */
const MAX_GAP_PINGS = 80;

/** Ping bufferisé pendant un trou GPS (position reconstruite plus tard). */
interface GapPing {
	measuredAt: number;
	status: PingStatus;
	rttMs: number | null;
	netType: string | null;
}

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

	// --- Mesure pendant les trous GPS (interpolation « depuis les rails ») ------
	/** Tick de secours qui pingue quand le GPS est perdu. */
	private gapTimer: ReturnType<typeof setInterval> | null = null;
	/** Époch ms du dernier point GPS valide (pour détecter le trou). */
	private lastGpsAt = 0;
	/** Dernier point GPS avant le trou en cours (point d'entrée à interpoler). */
	private gapEntry: GeoSample | null = null;
	/** Dernière position arrivée pendant un cycle de mesure (coalescée, jamais perdue). */
	private pendingSample: GeoSample | null = null;
	/** Pings capturés pendant le trou, en attente d'une position reconstruite. */
	private gapBuffer: GapPing[] = [];
	/** Slug de la ligne courante (renvoyé par l'API) et son tracé, pour interpoler. */
	private profileSlug: string | null = null;
	private profilePath: PathPoint[] | null = null;

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
		// Réinitialise le suivi de trou GPS (le tracé chargé, lui, reste en cache).
		this.gapEntry = null;
		this.gapBuffer = [];
		this.lastGpsAt = 0;
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
		// Tick de secours : pingue quand le GPS n'est pas frais — couvre les trous en
		// trajet ET le cold-start (cf. gapTick). On lance un ping tout de suite pour
		// afficher l'état réseau dès le départ (pas de « en attente » prolongé), sans
		// attendre le premier fix GPS.
		this.gapTimer = setInterval(() => void this.gapTick(), GAP_PING_TICK_MS);
		void this.gapTick();
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
		if (this.gapTimer !== null) {
			clearInterval(this.gapTimer);
			this.gapTimer = null;
		}
		// Trou GPS non refermé à l'arrêt (session finie en/après tunnel) : on JETTE le
		// buffer. Sans reprise GPS « sur les rails », on ne peut ni placer ces pings ni
		// confirmer que la personne n'a pas quitté le train.
		this.gapBuffer = [];
		this.gapEntry = null;
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
		this.patch({ running: false, status: 'idle', wakeLockActive: false, buffered: 0 });
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

		// Retour du GPS : si des pings ont été bufferisés (trou en trajet OU cold-start),
		// on les place dès qu'on a un point d'ancrage `gapEntry`. Cas particulier du
		// cold-start : au TOUT premier fix il n'y a pas encore d'ancre → on GARDE le
		// buffer (sinon on perdrait la connectivité de départ) et on attend le 2e fix,
		// qui donnera le sens du trajet pour extrapoler ces pings en arrière (commitGap).
		// Fait AVANT le garde `busy` pour que la clôture ait toujours lieu.
		if (this.gapBuffer.length > 0 && this.gapEntry) {
			this.commitGap(this.gapEntry, sample);
			this.gapBuffer = [];
			this.patch({ buffered: 0 });
		}
		this.gapEntry = sample;
		this.lastGpsAt = sample.timestamp;

		// Capture DÉCOUPLÉE de la synchro. On retient toujours la dernière position :
		// si un cycle de mesure (ping) est déjà en cours, l'échantillon n'est PAS perdu
		// — il sera traité juste après (coalescing : on garde le plus récent). Ainsi un
		// ping lent ou un envoi qui traîne ne bloque jamais l'enregistrement des points.
		this.pendingSample = sample;
		if (this.busy) return;
		this.busy = true;
		try {
			while (this.pendingSample) {
				const s = this.pendingSample;
				this.pendingSample = null;
				await this.measureOnce(s);
				// Envoi en tâche de fond : ne bloque pas la capture du point suivant.
				void this.flush();
			}
		} finally {
			this.busy = false;
		}
	}

	/**
	 * Un cycle de mesure pour une position GPS : ping de connectivité, détection live
	 * des coupures, et mise en file de la mesure (consentement requis). N'ENVOIE PAS —
	 * la synchro (`flush`) est déclenchée séparément pour ne jamais bloquer la capture.
	 */
	private async measureOnce(sample: GeoSample): Promise<void> {
		const { status, rttMs } = await ping(this.opts.endpoint);
		const netType = readNetworkType();
		this.patch({ status, rttMs, netType });

		// Détection live des coupures (indépendante du consentement : affichage éphémère).
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
			// On ENFILE systématiquement (même « none ») : les zones blanches, où l'envoi
			// direct échouerait, sont ainsi gardées et rejouées plus tard.
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
		}
	}

	/**
	 * Tick de secours : pingue quand le GPS n'est pas frais et bufferise les mesures
	 * sans position. Couvre DEUX cas : le trou en cours de trajet (tunnel) et le
	 * cold-start (avant le tout premier fix — sinon on resterait « en attente » des
	 * minutes sans rien mesurer alors qu'il y a du réseau). Ne fait RIEN tant que le
	 * GPS est frais : le mode normal, piloté par les positions, s'en charge.
	 */
	private async gapTick(): Promise<void> {
		if (!this.state.running || this.busy) return;
		if (Date.now() - this.lastGpsAt <= GAP_THRESHOLD_MS) return; // GPS frais → rien
		this.busy = true;
		try {
			const now = Date.now();
			const { status, rttMs } = await ping(this.opts.endpoint);
			const netType = readNetworkType();
			this.patch({ status, rttMs, netType });

			// Alimente la détection live des coupures même sans position : en tunnel,
			// cela maintient l'épisode vivant et en mesure la vraie durée (sinon un trou
			// de mesure > 5 min le clôturerait à tort).
			const ep = this.detector.observe({
				measuredAt: now,
				status,
				lat: null,
				lng: null,
				speedKmh: null
			});
			if (ep) {
				this.patch({
					outages: this.state.outages + 1,
					lastOutage: { durationS: ep.durationS, lengthM: ep.lengthM }
				});
			}

			// Bufferise pour rejeu ultérieur (consentement requis, comme le mode normal).
			if (hasConsent() && this.gapBuffer.length < MAX_GAP_PINGS) {
				this.gapBuffer.push({ measuredAt: now, status, rttMs, netType });
				this.patch({ buffered: this.gapBuffer.length });
			}
		} finally {
			this.busy = false;
		}
	}

	/**
	 * Place les pings bufferisés en les positionnant le long du tracé à partir de deux
	 * points GPS d'ancrage. On en déduit un taux signé (km/ms) — le sens du trajet —
	 * puis on calcule la position de chaque ping selon son instant :
	 *   - TUNNEL : `entry` = dernier GPS avant le trou, `exit` = 1er après → les pings
	 *     (entre les deux) sont INTERPOLÉS ;
	 *   - COLD-START : `entry` = 1er fix, `exit` = 2e fix → les pings pré-fix (antérieurs)
	 *     sont EXTRAPOLÉS en arrière dans le sens du trajet (confiance moindre, taggés).
	 *
	 * N'enfile RIEN sans garde-fous : profil chargé, ancres ≤ 5 min d'écart, entrée ET
	 * sortie « sur les rails » (preuve de non-sortie du train). Chaque ping reconstruit
	 * à plus de 5 min de l'ancre est ignoré (extrapolation trop lointaine).
	 */
	private commitGap(entry: GeoSample, exit: GeoSample): void {
		const path = this.profilePath;
		if (!path || this.gapBuffer.length === 0) return;

		const positions = reconstructAlongPath(
			path,
			{ lat: entry.lat, lng: entry.lng, t: entry.timestamp },
			{ lat: exit.lat, lng: exit.lng, t: exit.timestamp },
			this.gapBuffer.map((g) => g.measuredAt),
			{ maxSpanMs: MAX_GAP_MS, snapMaxM: SNAP_MAX_M }
		);
		if (!positions) return; // garde-fous non réunis → buffer jeté par l'appelant

		const operator = this.opts.operator;
		const sessionId = getSessionId();
		let placed = 0;
		this.gapBuffer.forEach((g, i) => {
			const pos = positions[i];
			if (!pos) return; // instant trop lointain de l'ancre
			this.queue.enqueue({
				lat: pos.lat,
				lng: pos.lng,
				status: g.status,
				rttMs: g.rttMs,
				operator,
				netType: g.netType,
				speedKmh: null,
				gpsAccuracy: null,
				measuredAt: g.measuredAt,
				sessionId,
				posSource: 'interpolated'
			});
			placed++;
		});
		if (placed > 0) {
			this.patch({ queued: this.queue.size });
			void this.flush();
		}
	}

	/**
	 * Pré-charge (une fois par ligne) le tracé du profil de trajet, nécessaire à
	 * l'interpolation des trous GPS. Le slug provient de la réponse de l'API.
	 */
	private ensureProfile(slug: string | null): void {
		if (!slug || slug === this.profileSlug) return;
		this.profileSlug = slug;
		this.profilePath = null;
		void (async () => {
			try {
				const res = await fetch(`/data/route-profiles/${slug}.json`);
				if (!res.ok) return;
				const data = (await res.json()) as { path?: PathPoint[] };
				// Garde anti-course : la ligne a pu changer entre-temps.
				if (this.profileSlug === slug && Array.isArray(data?.path)) {
					this.profilePath = data.path;
				}
			} catch {
				/* tracé indisponible : on n'interpolera simplement pas, sans bruit */
			}
		})();
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
			if (res.ok) {
				// Sur une mesure GPS, la réponse porte la ligne rattachée : on pré-charge
				// son tracé pour pouvoir interpoler un éventuel trou GPS ultérieur.
				if (m.posSource !== 'interpolated') {
					const body = (await res.json().catch(() => null)) as { lineSlug?: string | null } | null;
					this.ensureProfile(body?.lineSlug ?? null);
				}
				return true;
			}
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
