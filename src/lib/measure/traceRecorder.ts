/**
 * Façade de l'enregistreur de traces capteurs (outil expérimental, 100 % local).
 *
 * Orchestre la capture DeviceMotion (motion.ts), la persistance IndexedDB
 * (traceStore.ts) et les fixes GPS bruts relayés par le contrôleur. Tient le
 * contrôleur à l'écart des détails : il ne voit que start/stop/recordRawGps et
 * un statut (enregistrement, taille, plafond).
 *
 * Cycle de vie calqué sur la session de mesure :
 *  - `start()` reprend la trace existante si le pointeur local la désigne encore
 *    (refresh en cours de session → événement 'resume'), sinon en démarre une
 *    NOUVELLE (ce qui remplace la trace précédente, conservée jusqu'ici pour
 *    l'export) ;
 *  - `stop()` (arrêt volontaire) solde les buffers et efface le pointeur — la
 *    trace, elle, RESTE stockée pour être exportée/effacée depuis l'UI.
 *
 * Tout est best-effort : l'enregistreur ne doit jamais faire échouer la mesure.
 */
import { MotionRecorder, IMU_TARGET_HZ, type ImuSample, type ImuWindow } from './motion';
import { TraceStore } from './traceStore';
import {
	encodeImuChunk,
	type RawGpsFix,
	type TraceEvent,
	type TraceBundle,
	type TraceMeta
} from './exportTrace';
import { getActiveTraceId, setActiveTraceId, clearActiveTraceId } from './session';
import type { GeoSample } from './geolocation';

/** Statut exposé à l'UI (via LiveState du contrôleur). */
export interface TraceRecorderStatus {
	recording: boolean;
	bytes: number;
	/** Plafond atteint : le flux IMU décimé est coupé (fenêtres + GPS continuent). */
	capped: boolean;
}

/**
 * Plafond dur de la trace (octets approximatifs) : ~12 Mo ≈ 8 à 12 h de session,
 * garde-fou contre une session oubliée. Au-delà, on coupe le flux le plus lourd
 * (IMU décimé) mais on garde fenêtres 1 Hz et GPS, qui restent exploitables.
 */
const MAX_TRACE_BYTES = 12 * 1024 * 1024;
/**
 * Plafond ABSOLU (octets) : au-delà, plus aucune écriture du tout (les flux légers
 * fenêtres/GPS, qui continuent après MAX_TRACE_BYTES, finiraient sinon par croître
 * sans limite sur une session oubliée plusieurs jours).
 */
const MAX_TRACE_HARD_BYTES = 16 * 1024 * 1024;
/** Cadence de vidage des buffers mémoire vers IndexedDB (ms). */
const TRACE_FLUSH_MS = 15_000;

export class SensorTraceRecorder {
	private motion = new MotionRecorder();
	private store = new TraceStore();
	private imuBuf: ImuSample[] = [];
	private winBuf: ImuWindow[] = [];
	private gpsBuf: RawGpsFix[] = [];
	private evBuf: TraceEvent[] = [];
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	private recording = false;
	private capped = false;
	private lineSlug: string | null = null;
	/** Évite les vidages concurrents (flush périodique vs flush d'arrêt). */
	private flushing = false;
	/**
	 * File de sérialisation start/stop : un stop() pendant un start() encore suspendu
	 * sur ses await IndexedDB attendrait sinon un `recording` pas encore posé, ne
	 * ferait rien, et laisserait le listener devicemotion + l'interval de flush
	 * tourner indéfiniment après l'arrêt de la mesure. Chaîner les opérations rend
	 * l'entrelacement impossible (un double start est aussi neutralisé).
	 */
	private lifecycle: Promise<void> = Promise.resolve();

	constructor(private onStatus?: (s: TraceRecorderStatus) => void) {}

	get isSupported(): boolean {
		return MotionRecorder.support().devicemotion && TraceStore.isSupported();
	}

	/** Enchaîne une opération de cycle de vie après celles déjà en vol. */
	private enqueue(op: () => Promise<void>): Promise<void> {
		this.lifecycle = this.lifecycle.then(op, op);
		return this.lifecycle;
	}

	/** Démarre (ou reprend) l'enregistrement. Sans effet si non supporté. */
	start(info: { operator: string; lineSlug: string | null }): Promise<void> {
		return this.enqueue(() => this.doStart(info));
	}

	/** Arrêt volontaire : solde les buffers, garde la trace, efface le pointeur. */
	stop(): Promise<void> {
		return this.enqueue(() => this.doStop());
	}

	private async doStart(info: { operator: string; lineSlug: string | null }): Promise<void> {
		if (this.recording || !this.isSupported) return;
		this.lineSlug = info.lineSlug;

		// Reprise après refresh : le pointeur local désigne-t-il la trace stockée ?
		const activeId = getActiveTraceId();
		const existing = activeId ? await this.store.resume() : null;
		if (existing && existing.id === activeId) {
			this.evBuf.push({ type: 'resume', t: Date.now() });
		} else {
			const meta: TraceMeta = {
				id: crypto.randomUUID(),
				startedAt: Date.now(),
				timeOrigin: performance.timeOrigin,
				operator: info.operator,
				lineSlug: info.lineSlug,
				userAgent: navigator.userAgent,
				imuHz: IMU_TARGET_HZ,
				accelField: 'accelerationIncludingGravity',
				schemaVersion: 1
			};
			// On ne pose le pointeur que si la trace existe réellement en base —
			// sinon il désignerait une trace fantôme (IndexedDB indisponible…).
			if (!(await this.store.begin(meta))) return;
			setActiveTraceId(meta.id);
			this.evBuf.push({ type: 'start', t: Date.now() });
		}
		this.capped = this.store.sizeBytes >= MAX_TRACE_BYTES;

		const ok = this.motion.start(
			(s) => {
				if (!this.capped) this.imuBuf.push(s);
			},
			(w) => this.winBuf.push(w)
		);
		if (!ok) return; // permission refusée entre-temps / API retirée : on renonce
		this.flushTimer = setInterval(() => void this.flush(), TRACE_FLUSH_MS);
		this.recording = true;
		this.emitStatus();
	}

	private async doStop(): Promise<void> {
		if (!this.recording) return;
		this.recording = false;
		// motion.stop() clôt la fenêtre d'agrégation en cours (callback → winBuf) :
		// la dernière seconde de capteurs part avec le flush final.
		this.motion.stop();
		if (this.flushTimer !== null) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
		this.evBuf.push({ type: 'stop', t: Date.now() });
		await this.flush();
		clearActiveTraceId();
		this.emitStatus();
	}

	/** Fix GPS BRUT (avant filtre de précision), relayé par le contrôleur. */
	recordRawGps(s: GeoSample): void {
		if (!this.recording) return;
		this.gpsBuf.push({
			t: s.timestamp,
			lat: s.lat,
			lng: s.lng,
			accuracy: s.accuracy,
			speedKmh: s.speedKmh
		});
	}

	/** Ligne identifiée en cours de session (réponse API) : complète les métadonnées. */
	setLineSlug(slug: string): void {
		if (slug === this.lineSlug) return;
		this.lineSlug = slug;
		if (this.recording) void this.store.updateMeta({ lineSlug: slug });
	}

	/** Vide les buffers mémoire vers IndexedDB (chunk IMU colonnaire delta-encodé). */
	private async flush(): Promise<void> {
		if (this.flushing) return;
		this.flushing = true;
		try {
			// Plafond absolu : on jette tout (cf. MAX_TRACE_HARD_BYTES).
			if (this.store.sizeBytes >= MAX_TRACE_HARD_BYTES) {
				this.imuBuf = [];
				this.winBuf = [];
				this.gpsBuf = [];
				this.evBuf = [];
				return;
			}
			const imu = this.imuBuf.length > 0 ? [encodeImuChunk(this.imuBuf)] : [];
			const windows = this.winBuf;
			const gps = this.gpsBuf;
			const events = this.evBuf;
			if (imu.length === 0 && windows.length === 0 && gps.length === 0 && events.length === 0)
				return;
			this.imuBuf = [];
			this.winBuf = [];
			this.gpsBuf = [];
			this.evBuf = [];
			await this.store.appendBatch({ imu, windows, gps, events });
			if (!this.capped && this.store.sizeBytes >= MAX_TRACE_BYTES) this.capped = true;
			this.emitStatus();
		} finally {
			this.flushing = false;
		}
	}

	private emitStatus(): void {
		this.onStatus?.({
			recording: this.recording,
			bytes: this.store.sizeBytes,
			capped: this.capped
		});
	}
}

// --- Accès à la trace STOCKÉE (page, hors session de mesure) -----------------

/** Taille de la trace stockée (0 si aucune). */
export async function storedTraceBytes(): Promise<number> {
	if (!TraceStore.isSupported()) return 0;
	const store = new TraceStore();
	return (await store.resume()) ? store.sizeBytes : 0;
}

/** Charge la trace stockée pour l'export. null si aucune. */
export async function loadStoredTrace(): Promise<TraceBundle | null> {
	if (!TraceStore.isSupported()) return null;
	return new TraceStore().exportBundle();
}

/** Efface la trace stockée (action explicite de l'utilisateur). */
export async function clearStoredTrace(): Promise<void> {
	if (!TraceStore.isSupported()) return;
	await new TraceStore().clear();
	clearActiveTraceId();
}
