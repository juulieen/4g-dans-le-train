/**
 * Screen Wake Lock — empêche l'écran de s'éteindre pendant la mesure.
 *
 * Indispensable car la géolocalisation s'arrête sur la plupart des mobiles dès que
 * l'écran s'éteint. On ré-acquiert le verrou au retour de visibilité (le navigateur
 * le relâche automatiquement quand l'onglet passe en arrière-plan).
 */
export class ScreenWakeLock {
	private sentinel: WakeLockSentinel | null = null;
	private active = false;

	get isSupported(): boolean {
		return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
	}

	async acquire(): Promise<boolean> {
		if (!this.isSupported) return false;
		this.active = true;
		document.addEventListener('visibilitychange', this.handleVisibility);
		return this.request();
	}

	async release(): Promise<void> {
		this.active = false;
		document.removeEventListener('visibilitychange', this.handleVisibility);
		await this.sentinel?.release();
		this.sentinel = null;
	}

	private request = async (): Promise<boolean> => {
		try {
			this.sentinel = await navigator.wakeLock.request('screen');
			this.sentinel.addEventListener('release', () => {
				this.sentinel = null;
			});
			return true;
		} catch {
			return false;
		}
	};

	private handleVisibility = () => {
		if (this.active && this.sentinel === null && document.visibilityState === 'visible') {
			void this.request();
		}
	};
}
