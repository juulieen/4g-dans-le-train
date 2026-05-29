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
	sent: number;
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
	wakeLockActive: false,
	error: null
};

export class MeasurementController {
	private geo = new GeoTracker();
	private wake = new ScreenWakeLock();
	private state: LiveState = { ...initialState };
	private opts: ControllerOptions;
	/** Évite les pings concurrents si le GPS pousse des positions rapprochées. */
	private busy = false;

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
		this.patch({ ...initialState, running: true });

		const ok = this.geo.start(
			(sample) => void this.handleSample(sample),
			(err) => this.patch({ error: `GPS : ${err.message}` })
		);
		if (!ok) {
			this.patch({ running: false, error: 'Impossible de démarrer le GPS.' });
			return;
		}

		const wakeOk = await this.wake.acquire();
		this.patch({ wakeLockActive: wakeOk });
	}

	async stop(): Promise<void> {
		this.geo.stop();
		await this.wake.release();
		this.patch({ running: false, status: 'idle', wakeLockActive: false });
	}

	private async handleSample(sample: GeoSample): Promise<void> {
		this.patch({
			lat: sample.lat,
			lng: sample.lng,
			speedKmh: sample.speedKmh,
			accuracy: sample.accuracy
		});
		if (this.busy) return;
		this.busy = true;
		try {
			const { status, rttMs } = await ping(this.opts.endpoint);
			const netType = readNetworkType();
			this.patch({ status, rttMs, netType });
			if (hasConsent()) await this.send(sample, status, rttMs, netType);
		} finally {
			this.busy = false;
		}
	}

	private async send(
		sample: GeoSample,
		status: PingStatus,
		rttMs: number | null,
		netType: string | null
	): Promise<void> {
		try {
			const res = await fetch('/api/measurements', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					lat: sample.lat,
					lng: sample.lng,
					status,
					rttMs,
					operator: this.opts.operator,
					netType,
					speedKmh: sample.speedKmh,
					gpsAccuracy: sample.accuracy,
					sessionId: getSessionId()
				})
			});
			if (res.ok) this.patch({ sent: this.state.sent + 1 });
		} catch {
			/* hors-ligne : on ignore, la prochaine mesure réessaiera */
		}
	}

	private patch(partial: Partial<LiveState>): void {
		this.state = { ...this.state, ...partial };
		this.opts.onState(this.state);
	}
}
