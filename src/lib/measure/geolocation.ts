/**
 * Suivi de position GPS pour le mode mesure.
 *
 * Filtre de plausibilité ferroviaire : on ignore les points trop imprécis et on
 * expose la vitesse (m/s → km/h) pour que l'ingestion puisse écarter ce qui ne
 * ressemble pas à un trajet en train.
 */

export interface GeoSample {
	lat: number;
	lng: number;
	accuracy: number;
	/** Vitesse en km/h (null si l'appareil ne la fournit pas). */
	speedKmh: number | null;
	timestamp: number;
}

/** Précision minimale acceptée (m). Au-delà, le point est rejeté. */
const MAX_ACCURACY_M = 100;

/**
 * Ancienneté maximale acceptée pour le PREMIER fix (ms). `watchPosition` avec
 * `maximumAge: 0` rejette toute position en cache : à un redémarrage de mesure, on
 * jette ainsi un fix récent et parfaitement bon, et on attend une nouvelle
 * acquisition GNSS qui peut prendre des minutes. Un `getCurrentPosition` initial
 * tolérant réutilise un fix récent (toujours haute précision → passe le filtre),
 * donnant une position quasi immédiate. Le suivi continu, lui, reste à `maximumAge: 0`.
 */
const FIRST_FIX_MAX_AGE_MS = 30_000;

export class GeoTracker {
	private watchId: number | null = null;

	get isSupported(): boolean {
		return typeof navigator !== 'undefined' && 'geolocation' in navigator;
	}

	/** Filtre de précision + mise en forme commune (fix initial et suivi continu). */
	private emit(pos: GeolocationPosition, onSample: (s: GeoSample) => void): void {
		const { latitude, longitude, accuracy, speed } = pos.coords;
		if (accuracy > MAX_ACCURACY_M) return;
		onSample({
			lat: latitude,
			lng: longitude,
			accuracy,
			speedKmh: speed != null ? speed * 3.6 : null,
			timestamp: pos.timestamp
		});
	}

	/**
	 * Démarre le suivi. `onSample` est appelé pour chaque position suffisamment précise.
	 * Retourne false si la géoloc n'est pas disponible.
	 */
	start(
		onSample: (s: GeoSample) => void,
		onError?: (e: GeolocationPositionError) => void
	): boolean {
		if (!this.isSupported) return false;
		// Fix initial rapide : réutilise une position récente si le téléphone en a une
		// (cas du redémarrage de mesure). Les erreurs sont ignorées ici — `watchPosition`
		// reste la source de vérité pour le suivi et la remontée d'erreurs.
		navigator.geolocation.getCurrentPosition(
			(pos) => this.emit(pos, onSample),
			() => {},
			{ enableHighAccuracy: true, maximumAge: FIRST_FIX_MAX_AGE_MS, timeout: 10000 }
		);
		this.watchId = navigator.geolocation.watchPosition(
			(pos) => this.emit(pos, onSample),
			(err) => onError?.(err),
			{ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
		);
		return true;
	}

	stop(): void {
		if (this.watchId !== null) {
			navigator.geolocation.clearWatch(this.watchId);
			this.watchId = null;
		}
	}
}
