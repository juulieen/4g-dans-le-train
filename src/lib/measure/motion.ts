/**
 * Capture des capteurs de mouvement (DeviceMotion) pour les traces expérimentales.
 *
 * POURQUOI : valider hors-ligne deux pistes de localisation SANS GPS — le
 * map-matching par courbure (le taux de rotation suit ω = v·κ le long du tracé)
 * et la détection d'arrêts en gare (la variance d'accélération s'effondre à
 * l'arrêt, les gares sont des ancres géolocalisées connues). Pour ça il faut des
 * données réelles jumelées IMU + GPS collectées en train.
 *
 * Deux flux complémentaires sortent de l'écouteur `devicemotion` (~60 Hz brut) :
 *  - des échantillons DÉCIMÉS à IMU_TARGET_HZ (la dynamique d'un train est lente,
 *    10 Hz couvrent très largement la courbure) ;
 *  - des fenêtres AGRÉGÉES de 1 s (moyenne/écart-type calculés sur TOUS les
 *    événements bruts, pas seulement les décimés — sinon la variance mentirait).
 *
 * On capture `accelerationIncludingGravity` (fiable partout, là où `acceleration`
 * est souvent null sur iOS) et `rotationRate`. L'orientation du téléphone étant
 * inconnue, les agrégats portent sur les NORMES des vecteurs (invariantes par
 * rotation de l'appareil).
 */

export interface ImuSample {
	/** Époch ms (performance.timeOrigin + event.timeStamp). */
	t: number;
	/** Accélération avec gravité (m/s²), null si l'appareil ne la fournit pas. */
	ax: number | null;
	ay: number | null;
	az: number | null;
	/** Taux de rotation (deg/s) : rax = alpha (axe z de l'appareil), ray = beta
	 *  (axe x), raz = gamma (axe y) — convention DeviceMotion. null si non fournis. */
	rax: number | null;
	ray: number | null;
	raz: number | null;
}

/** Fenêtre agrégée (~1 s) : statistiques invariantes à l'orientation du téléphone. */
export interface ImuWindow {
	t0: number;
	t1: number;
	/** Nombre d'événements bruts agrégés. */
	n: number;
	/** Moyenne de ‖accélération (avec gravité)‖ sur la fenêtre (m/s²). */
	accMean: number;
	/** Écart-type de ‖accélération‖ — LE signal de la détection d'arrêt. */
	accStd: number;
	/** Écart-type de ‖taux de rotation‖ (deg/s) — vibrations/virages. */
	rotStd: number;
}

export interface MotionSupport {
	/** L'API DeviceMotion existe sur cet appareil/navigateur. */
	devicemotion: boolean;
	/** iOS 13+ : une demande de permission explicite (geste utilisateur) est requise. */
	needsPermission: boolean;
}

/** Cadence cible des échantillons décimés (Hz). Cf. justification en tête de fichier.
 *  Exporté : figure dans les métadonnées de la trace (meta.imuHz). */
export const IMU_TARGET_HZ = 10;
/** Largeur des fenêtres d'agrégation (ms). */
const WINDOW_MS = 1_000;

/** Norme euclidienne d'un triplet dont chaque composante peut manquer. */
export function vectorNorm(x: number | null, y: number | null, z: number | null): number | null {
	if (x == null || y == null || z == null) return null;
	return Math.sqrt(x * x + y * y + z * z);
}

/** Accumulateur incrémental d'une fenêtre (sommes et sommes de carrés). */
export interface WindowAcc {
	t0: number;
	t1: number;
	n: number;
	nAcc: number;
	sumAcc: number;
	sumAcc2: number;
	nRot: number;
	sumRot: number;
	sumRot2: number;
}

export function emptyWindow(t0: number): WindowAcc {
	return { t0, t1: t0, n: 0, nAcc: 0, sumAcc: 0, sumAcc2: 0, nRot: 0, sumRot: 0, sumRot2: 0 };
}

/** Ajoute un événement brut à la fenêtre courante (normes pré-calculées). */
export function pushToWindow(
	acc: WindowAcc,
	t: number,
	accNorm: number | null,
	rotNorm: number | null
): void {
	acc.t1 = t;
	acc.n++;
	if (accNorm != null) {
		acc.nAcc++;
		acc.sumAcc += accNorm;
		acc.sumAcc2 += accNorm * accNorm;
	}
	if (rotNorm != null) {
		acc.nRot++;
		acc.sumRot += rotNorm;
		acc.sumRot2 += rotNorm * rotNorm;
	}
}

/** Écart-type depuis les sommes (clampé à 0 contre les erreurs d'arrondi). */
function stdFromSums(n: number, sum: number, sum2: number): number {
	if (n === 0) return 0;
	const mean = sum / n;
	return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

/** Clôt la fenêtre en statistiques exportables. null si elle est restée vide. */
export function finalizeWindow(acc: WindowAcc): ImuWindow | null {
	if (acc.n === 0) return null;
	return {
		t0: acc.t0,
		t1: acc.t1,
		n: acc.n,
		accMean: acc.nAcc > 0 ? acc.sumAcc / acc.nAcc : 0,
		accStd: stdFromSums(acc.nAcc, acc.sumAcc, acc.sumAcc2),
		rotStd: stdFromSums(acc.nRot, acc.sumRot, acc.sumRot2)
	};
}

export class MotionRecorder {
	private handler: ((ev: DeviceMotionEvent) => void) | null = null;
	/** Instant (epoch ms) du dernier échantillon décimé conservé. */
	private lastKeptAt = 0;
	private window: WindowAcc | null = null;
	/** Callback fenêtres, gardé pour émettre la fenêtre en cours au stop(). */
	private onWindowCb: ((w: ImuWindow) => void) | null = null;

	static support(): MotionSupport {
		const exists = typeof window !== 'undefined' && typeof DeviceMotionEvent !== 'undefined';
		return {
			devicemotion: exists,
			needsPermission:
				exists &&
				typeof (DeviceMotionEvent as unknown as { requestPermission?: unknown })
					.requestPermission === 'function'
		};
	}

	/**
	 * Demande la permission iOS 13+. DOIT être appelée depuis un geste utilisateur
	 * (clic sur « Démarrer la mesure »). Sur les plateformes sans mécanisme de
	 * permission, l'API est librement accessible → 'granted' implicite.
	 */
	static async requestPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
		const s = MotionRecorder.support();
		if (!s.devicemotion) return 'unsupported';
		if (!s.needsPermission) return 'granted';
		try {
			const res = await (
				DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
			).requestPermission();
			return res === 'granted' ? 'granted' : 'denied';
		} catch {
			// Rejet hors geste utilisateur ou refus mémorisé : on traite comme un refus.
			return 'denied';
		}
	}

	/**
	 * Démarre l'écoute. `onSample` reçoit le flux décimé (~IMU_TARGET_HZ),
	 * `onWindow` les fenêtres agrégées (~1/s). Retourne false si non supporté.
	 */
	start(onSample: (s: ImuSample) => void, onWindow: (w: ImuWindow) => void): boolean {
		if (!MotionRecorder.support().devicemotion || this.handler) return false;
		this.onWindowCb = onWindow;
		// `event.timeStamp` est relatif à l'origine du document : on le ramène en
		// epoch ms pour pouvoir joindre IMU et GPS par timestamp à l'analyse.
		const epochBase = performance.timeOrigin;
		const keepEveryMs = 1000 / IMU_TARGET_HZ;

		this.handler = (ev: DeviceMotionEvent) => {
			// Garde : d'anciens WebKit horodataient les événements capteurs en epoch
			// ABSOLU. Un timeStamp > ~30 ans de ms ne peut pas être relatif → on le
			// prend tel quel plutôt que de produire un instant aberrant (~2× l'epoch).
			const t = ev.timeStamp > 1e12 ? ev.timeStamp : epochBase + ev.timeStamp;
			const g = ev.accelerationIncludingGravity;
			const r = ev.rotationRate;
			const accNorm = g ? vectorNorm(g.x, g.y, g.z) : null;
			const rotNorm = r ? vectorNorm(r.alpha, r.beta, r.gamma) : null;

			// Fenêtre 1 s : agrège TOUS les événements bruts.
			if (!this.window) this.window = emptyWindow(t);
			pushToWindow(this.window, t, accNorm, rotNorm);
			if (t - this.window.t0 >= WINDOW_MS) {
				const w = finalizeWindow(this.window);
				this.window = emptyWindow(t);
				if (w) onWindow(w);
			}

			// Flux décimé : un échantillon instantané toutes les ~1/IMU_TARGET_HZ s.
			if (t - this.lastKeptAt < keepEveryMs) return;
			this.lastKeptAt = t;
			onSample({
				t,
				ax: g?.x ?? null,
				ay: g?.y ?? null,
				az: g?.z ?? null,
				rax: r?.alpha ?? null,
				ray: r?.beta ?? null,
				raz: r?.gamma ?? null
			});
		};
		window.addEventListener('devicemotion', this.handler);
		return true;
	}

	stop(): void {
		if (this.handler) {
			window.removeEventListener('devicemotion', this.handler);
			this.handler = null;
		}
		// Clôt la fenêtre en cours (jusqu'à ~1 s de données) au lieu de la jeter :
		// la dernière seconde de la session compte aussi.
		if (this.window && this.onWindowCb) {
			const w = finalizeWindow(this.window);
			if (w) this.onWindowCb(w);
		}
		this.window = null;
		this.onWindowCb = null;
		this.lastKeptAt = 0;
	}
}
