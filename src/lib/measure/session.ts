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
