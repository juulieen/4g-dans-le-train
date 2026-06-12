/**
 * Session anonyme + gestion du consentement RGPD.
 *
 * Le jeton de session est un identifiant aléatoire jetable, stocké localement.
 * Il ne contient aucune donnée personnelle ; il sert seulement à dédoublonner et
 * à appliquer un rate-limit côté serveur. Aucune mesure n'est envoyée tant que le
 * consentement explicite n'a pas été donné.
 */

const SESSION_KEY = '4gdt.session';
const CONSENT_KEY = '4gdt.consent';
const ONBOARDED_KEY = '4gdt.onboarded';
const THROUGHPUT_OPT_KEY = '4gdt.opt.throughput';
const SENSORS_OPT_KEY = '4gdt.opt.sensors';
const ACTIVE_TRACE_KEY = '4gdt.trace.active';
const MEASURE_ALIVE_KEY = '4gdt.measure.alive';
const OPERATOR_KEY = '4gdt.operator';

export function getSessionId(): string {
	if (typeof localStorage === 'undefined') return 'ssr';
	let id = localStorage.getItem(SESSION_KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(SESSION_KEY, id);
	}
	return id;
}

export function hasConsent(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(CONSENT_KEY) === 'granted';
}

export function grantConsent(): void {
	localStorage.setItem(CONSENT_KEY, 'granted');
}

export function revokeConsent(): void {
	localStorage.removeItem(CONSENT_KEY);
}

/**
 * Onboarding pédagogique : on retient que l'utilisateur a déjà vu (ou ignoré)
 * l'invite de première visite, pour ne plus l'afficher automatiquement. Aucune
 * donnée personnelle ; simple drapeau local. La réouverture manuelle via le
 * bouton « ℹ️ Comment ça marche » ne touche jamais à cette clé.
 */
export function hasOnboarded(): boolean {
	if (typeof localStorage === 'undefined') return true;
	try {
		return localStorage.getItem(ONBOARDED_KEY) === 'done';
	} catch {
		// Stockage bloqué (contexte durci/privé) : on évite de ré-afficher en boucle.
		return true;
	}
}

export function markOnboarded(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(ONBOARDED_KEY, 'done');
	} catch {
		/* stockage bloqué : best-effort, on ignore */
	}
}

/**
 * Opt-in de la mesure de débit. OFF par défaut : le débit consomme la data mobile
 * de l'utilisateur (il est dans le train et la paie), on ne l'active que sur choix
 * explicite. Préférence locale persistée, sans donnée personnelle.
 */
export function getThroughputOptIn(): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		return localStorage.getItem(THROUGHPUT_OPT_KEY) === 'on';
	} catch {
		return false;
	}
}

export function setThroughputOptIn(on: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (on) localStorage.setItem(THROUGHPUT_OPT_KEY, 'on');
		else localStorage.removeItem(THROUGHPUT_OPT_KEY);
	} catch {
		/* stockage bloqué : best-effort, on ignore */
	}
}

/**
 * Opt-in de l'enregistreur de traces capteurs (outil expérimental). OFF par
 * défaut. Les traces (accéléromètre + gyroscope + GPS bruts) restent 100 %
 * locales (IndexedDB) et ne sont JAMAIS envoyées au serveur — l'utilisateur
 * les exporte lui-même en JSON. Préférence locale, sans donnée personnelle.
 */
export function getSensorsOptIn(): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		return localStorage.getItem(SENSORS_OPT_KEY) === 'on';
	} catch {
		return false;
	}
}

export function setSensorsOptIn(on: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (on) localStorage.setItem(SENSORS_OPT_KEY, 'on');
		else localStorage.removeItem(SENSORS_OPT_KEY);
	} catch {
		/* stockage bloqué : best-effort, on ignore */
	}
}

/**
 * Pointeur de trace capteurs ACTIVE (id de la trace en cours d'enregistrement).
 * Sémantique calquée sur le heartbeat : posé au démarrage de l'enregistrement,
 * effacé à l'arrêt VOLONTAIRE. S'il survit (refresh en cours de session), la
 * reprise continue d'écrire dans la même trace au lieu d'en ouvrir une nouvelle.
 */
export function getActiveTraceId(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(ACTIVE_TRACE_KEY);
	} catch {
		return null;
	}
}

export function setActiveTraceId(id: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(ACTIVE_TRACE_KEY, id);
	} catch {
		/* stockage bloqué : best-effort, on ignore */
	}
}

export function clearActiveTraceId(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(ACTIVE_TRACE_KEY);
	} catch {
		/* stockage bloqué : best-effort, on ignore */
	}
}

/**
 * Heartbeat du mode mesure, pour la reprise auto après un refresh.
 *
 * Le contrôleur le rafraîchit à chaque tick (1/s) et l'efface à l'arrêt VOLONTAIRE.
 * Si la page recharge alors qu'une mesure tournait (onglet déchargé en arrière-plan,
 * rotation, refresh accidentel — fréquent sur mobile dans le train), le heartbeat
 * survit : la page peut alors redémarrer la mesure sans intervention, au lieu de
 * laisser croire qu'elle tourne encore.
 */
export function markMeasureAlive(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(MEASURE_ALIVE_KEY, String(Date.now()));
	} catch {
		/* stockage bloqué : best-effort, on ignore */
	}
}

export function clearMeasureAlive(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(MEASURE_ALIVE_KEY);
	} catch {
		/* stockage bloqué : best-effort, on ignore */
	}
}

/**
 * Une mesure tournait-elle il y a moins de `maxAgeMs` (défaut 2 min) ?
 *
 * 2 min, volontairement plus court que la fenêtre de recalage du buffer de trou
 * (MAX_GAP_MS = 5 min, controller.ts) : au-delà, la mesure est considérée « morte »
 * et on ne la relance pas — mais le buffer persisté, lui, reste recalable jusqu'à
 * 5 min et sera repris au prochain démarrage MANUEL.
 */
export function wasMeasuringRecently(maxAgeMs = 2 * 60_000): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		const ts = Number(localStorage.getItem(MEASURE_ALIVE_KEY));
		return Number.isFinite(ts) && ts > 0 && Date.now() - ts <= maxAgeMs;
	} catch {
		return false;
	}
}

/**
 * Opérateur choisi, persisté pour survivre au refresh (indispensable à la reprise
 * auto : sans lui, une session reprise enverrait « inconnu »). Stocké brut ; c'est
 * à l'appelant de valider la valeur contre sa liste d'opérateurs.
 */
export function getSavedOperator(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(OPERATOR_KEY);
	} catch {
		return null;
	}
}

export function setSavedOperator(operator: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(OPERATOR_KEY, operator);
	} catch {
		/* stockage bloqué : best-effort, on ignore */
	}
}
