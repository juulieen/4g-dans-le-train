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

export class GeoTracker {
	private watchId: number | null = null;

	get isSupported(): boolean {
		return typeof navigator !== 'undefined' && 'geolocation' in navigator;
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
		this.watchId = navigator.geolocation.watchPosition(
			(pos) => {
				const { latitude, longitude, accuracy, speed } = pos.coords;
				if (accuracy > MAX_ACCURACY_M) return;
				onSample({
					lat: latitude,
					lng: longitude,
					accuracy,
					speedKmh: speed != null ? speed * 3.6 : null,
					timestamp: pos.timestamp
				});
			},
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
