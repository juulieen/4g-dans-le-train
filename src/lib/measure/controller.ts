/**
 * Orchestrateur du mode mesure (côté client).
 *
 * Relie les briques bas niveau : suivi GPS (geolocation), test de connectivité
 * (ping), maintien de l'écran (wakeLock), type de réseau bonus (netinfo), débit
 * descendant optionnel (throughput) et session anonyme (session).
 *
 * Cadence STABLE : un tick maître à 1 s pilote TOUTE la mesure. `watchPosition`
 * ne sert plus qu'à rafraîchir la position courante et à refermer les trous GPS.
 * À chaque tick : un ping, puis selon la fraîcheur du GPS soit une mesure
 * positionnée (mode normal), soit un ping bufferisé sans position (tunnel /
 * cold-start) repositionné plus tard par interpolation le long du tracé.
 *
 * Conçu pour être piloté par l'UI Svelte via des callbacks d'état réactifs.
 */
import { ping, type PingStatus } from './ping';
import { measureDownlink } from './throughput';
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
	/** Débit descendant (kbps) de la dernière mesure de débit. null si non mesuré. */
	downlinkKbps: number | null;
	/** Données consommées par les mesures de débit cette session (octets). */
	dataUsedBytes: number;
	/** Débit en pause car le plafond de données/session est atteint (pings continuent). */
	throughputCapped: boolean;
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
	/**
	 * Aucune position GPS précise depuis plus de MAX_GAP_MS (5 min) : la fenêtre
	 * d'interpolation est dépassée, les pings bufferisés ne pourront plus être recalés.
	 * Cas typique : ordinateur sans vrai GPS. La mesure CONTINUE (si le GPS finit par
	 * accrocher, on enregistre) — ce drapeau ne sert qu'à informer l'UI.
	 */
	gpsStale: boolean;
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
	/** Active la mesure de débit (opt-in : consomme la data mobile). Défaut false. */
	measureThroughput?: boolean;
}

const initialState: LiveState = {
	running: false,
	status: 'idle',
	rttMs: null,
	downlinkKbps: null,
	dataUsedBytes: 0,
	throughputCapped: false,
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
	gpsStale: false,
	wakeLockActive: false,
	error: null
};

/** Intervalle de tentative de vidage de la file (ms) tant que le mode tourne. */
const FLUSH_INTERVAL_MS = 15_000;
/** Cadence maître de la mesure (ms) — un ping par tick, quoi qu'il arrive. */
const TICK_MS = 1_000;
/**
 * Mesure de débit : parcimonie data (l'utilisateur paie sa data dans le train).
 * Une mesure toutes les 60 s, blob de 128 Ko → ~7,5 Mo/h. 128 Ko (vs moins) garde
 * une mesure fiable malgré le slow-start TCP ; 60 s suffit pour un indicateur de
 * ZONE (le statut réseau, lui, reste à 1/s). Plafond dur par session : au-delà, le
 * débit se met en pause (les pings continuent).
 */
const THROUGHPUT_INTERVAL_MS = 60_000;
/** Taille du blob de débit téléchargé (octets). */
const PROBE_SIZE_BYTES = 128 * 1024;
/** Plafond de données/session pour le débit (octets) — ~20 Mo, soit ~2,5 h à 7,5 Mo/h. */
const THROUGHPUT_CAP_BYTES = 20 * 1024 * 1024;

/**
 * Interpolation « depuis les rails » pendant un trou GPS (tunnel, tranchée).
 * Le tick continue de pinguer sans position ; à la reprise GPS « sur les rails »,
 * on reconstruit la position de chaque ping par interpolation (cf. commitGap).
 */
/** Au-delà de ce délai sans position GPS valide, on considère être dans un trou. */
const GAP_THRESHOLD_MS = 10_000;
/** Durée max d'un trou encore interpolable (au-delà, buffer jeté). Cf. MAX_SAMPLE_GAP_MS. */
const MAX_GAP_MS = 5 * 60_000;
/** Distance max (m) entre un point GPS et le tracé pour le juger « sur les rails ». */
const SNAP_MAX_M = 1_000;
/** Plafond du buffer de trou (≈ MAX_GAP_MS / TICK_MS, avec un peu de marge). */
const MAX_GAP_PINGS = 320;

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
	/** Évite les ticks concurrents si un ping traîne au-delà de la cadence. */
	private busy = false;
	/** Évite les vidages de file concurrents. */
	private flushing = false;
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	/** Tick maître de la mesure (cadence stable). */
	private tickTimer: ReturnType<typeof setInterval> | null = null;
	/** Époch ms de la dernière mesure de débit lancée (pour l'espacer dans le temps). */
	private lastThroughputAt = 0;
	/** Octets consommés par les mesures de débit cette session (pour le plafond). */
	private throughputBytesUsed = 0;
	/** Une mesure de débit est en cours (évite les chevauchements). */
	private throughputInFlight = false;
	/** Dernier débit mesuré, en attente d'être rattaché à un envoi (consume-once). */
	private pendingDownlinkKbps: number | null = null;
	/**
	 * Génération de session, incrémentée à chaque `start()`. Capturée par une mesure
	 * de débit en vol : si elle change (stop/start entre-temps), le résultat tardif
	 * est ignoré → il ne pollue pas la session suivante.
	 */
	private generation = 0;

	// --- Suivi GPS (cache de position + interpolation des trous) ----------------
	/** Époch ms du dernier point GPS valide (pour détecter le trou). */
	private lastGpsAt = 0;
	/**
	 * Époch ms du début du trou GPS courant (1er tick sans position fraîche), ou null
	 * si le GPS est frais. Sert à détecter le dépassement de MAX_GAP_MS (cf. gpsStale).
	 */
	private gapStartedAt: number | null = null;
	/** Dernière position GPS connue (le tick mesure « avec » elle quand elle est fraîche). */
	private currentSample: GeoSample | null = null;
	/** Dernier point GPS avant le trou en cours (point d'entrée à interpoler). */
	private gapEntry: GeoSample | null = null;
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

	/** Active/désactive la mesure de débit (opt-in). Modifiable même mode arrêté. */
	setMeasureThroughput(on: boolean) {
		this.opts.measureThroughput = on;
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
		this.gapStartedAt = null;
		this.currentSample = null;
		// Réinitialise le suivi de débit (et invalide une mesure de débit en vol).
		this.lastThroughputAt = 0;
		this.throughputBytesUsed = 0;
		this.pendingDownlinkKbps = null;
		this.throughputInFlight = false;
		this.generation++;
		this.patch({ ...initialState, running: true, queued: this.queue.size });

		const ok = this.geo.start(
			(sample) => this.handleSample(sample),
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
		// Tick maître : pingue à cadence fixe (1/s). On lance un tick tout de suite pour
		// afficher l'état réseau dès le départ, sans attendre le premier fix GPS.
		this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
		void this.tick();
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
		if (this.tickTimer !== null) {
			clearInterval(this.tickTimer);
			this.tickTimer = null;
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

	/**
	 * Événement GPS : ne déclenche PAS de mesure (c'est le tick qui s'en charge).
	 * Met seulement à jour la position courante et referme un éventuel trou GPS.
	 */
	private handleSample(sample: GeoSample): void {
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
		if (this.gapBuffer.length > 0 && this.gapEntry) {
			this.commitGap(this.gapEntry, sample);
			this.gapBuffer = [];
			this.patch({ buffered: 0 });
		}
		this.gapEntry = sample;
		this.lastGpsAt = sample.timestamp;
		this.currentSample = sample;
	}

	/**
	 * Tick maître (1/s). Pingue, puis selon la fraîcheur du GPS :
	 *  - GPS frais → mesure positionnée (mode normal) + débit cadencé optionnel ;
	 *  - GPS gelé / cold-start → ping bufferisé sans position (repositionné plus tard).
	 * N'ENVOIE PAS directement — la synchro (`flush`) est déclenchée en tâche de fond.
	 */
	private async tick(): Promise<void> {
		if (!this.state.running || this.busy) return;
		this.busy = true;
		try {
			const now = Date.now();
			const { status, rttMs } = await ping(this.opts.endpoint);
			const netType = readNetworkType();
			this.patch({ status, rttMs, netType });

			const sample = this.currentSample;
			const fresh = sample !== null && now - this.lastGpsAt <= GAP_THRESHOLD_MS;

			// Suivi du trou GPS courant : on note quand il commence pour signaler (gpsStale)
			// le dépassement de la fenêtre d'interpolation (MAX_GAP_MS). La mesure n'est
			// JAMAIS interrompue — si le GPS finit par accrocher, on repasse en mode normal.
			if (fresh) {
				this.gapStartedAt = null;
			} else if (this.gapStartedAt === null) {
				this.gapStartedAt = now;
			}
			const gpsStale = this.gapStartedAt !== null && now - this.gapStartedAt > MAX_GAP_MS;
			if (gpsStale !== this.state.gpsStale) this.patch({ gpsStale });

			if (fresh && sample) {
				// --- Mode normal : mesure positionnée ---

				// Mesure de débit : opt-in, espacée dans le TEMPS (1/min), UNIQUEMENT sur le
				// chemin GPS (jamais en tunnel : pas de réseau, data gaspillée) et tant que le
				// plafond de données/session n'est pas atteint. Lancée HORS du tick
				// (fire-and-forget) pour ne jamais retarder la cadence ; son résultat est
				// affiché dès réception et rattaché au prochain envoi.
				if (
					this.opts.measureThroughput &&
					!this.throughputInFlight &&
					this.throughputBytesUsed < THROUGHPUT_CAP_BYTES &&
					now - this.lastThroughputAt >= THROUGHPUT_INTERVAL_MS
				) {
					this.lastThroughputAt = now;
					this.measureThroughputDetached();
				}

				const ep = this.detector.observe({
					measuredAt: now,
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

				// Consomme le dernier débit mesuré à CHAQUE mesure (borne son âge à ~1
				// cycle, même sans consentement où il serait sinon rattaché bien plus tard).
				const downlinkKbps = this.consumePendingDownlink();

				if (hasConsent()) {
					// On ENFILE systématiquement (même « none ») : les zones blanches, où
					// l'envoi direct échouerait, sont ainsi gardées et rejouées plus tard.
					this.queue.enqueue({
						lat: sample.lat,
						lng: sample.lng,
						status,
						rttMs,
						downlinkKbps,
						operator: this.opts.operator,
						netType,
						speedKmh: sample.speedKmh,
						gpsAccuracy: sample.accuracy,
						measuredAt: now,
						sessionId: getSessionId()
					});
					this.patch({ queued: this.queue.size });
				}
			} else {
				// --- Trou GPS / cold-start : ping bufferisé sans position ---
				// Alimente la détection live des coupures même sans position : en tunnel,
				// cela maintient l'épisode vivant et en mesure la vraie durée.
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
			}

			// Envoi en tâche de fond : ne bloque pas le tick suivant.
			void this.flush();
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
				// Pas de débit en tunnel (jamais mesuré sur le chemin interpolé).
				downlinkKbps: null,
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

	/**
	 * Lance une mesure de débit en tâche de fond (hors du tick) : elle ne doit jamais
	 * retarder la cadence. Le résultat est affiché dès réception et mémorisé pour le
	 * prochain envoi. Ignoré si la session a changé entre-temps (stop/start).
	 */
	private measureThroughputDetached(): void {
		const gen = this.generation;
		this.throughputInFlight = true;
		void measureDownlink('/api/probe', PROBE_SIZE_BYTES)
			.then((t) => {
				if (gen !== this.generation || !this.state.running) return;
				// Comptabilise les octets réellement reçus (même si la mesure a échoué et
				// que downlinkKbps est null, des octets ont pu transiter) → compteur honnête.
				this.throughputBytesUsed += t.bytes;
				this.patch({
					dataUsedBytes: this.throughputBytesUsed,
					throughputCapped: this.throughputBytesUsed >= THROUGHPUT_CAP_BYTES
				});
				if (t.downlinkKbps != null) {
					this.pendingDownlinkKbps = t.downlinkKbps;
					this.patch({ downlinkKbps: t.downlinkKbps });
				}
			})
			.finally(() => {
				// Ne libère le verrou que s'il s'agit toujours de la même session.
				if (gen === this.generation) this.throughputInFlight = false;
			});
	}

	/** Récupère le dernier débit mesuré et le consomme (ne le rattache qu'une fois). */
	private consumePendingDownlink(): number | null {
		const v = this.pendingDownlinkKbps;
		this.pendingDownlinkKbps = null;
		return v;
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
