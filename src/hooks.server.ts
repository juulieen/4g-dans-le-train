import type { HandleServerError } from '@sveltejs/kit/hooks';

/**
 * SvelteKit 3 passe TOUTES les erreurs à ce hook, y compris les attendues
 * (`error(404, …)`, 400 de validation, 404 du framework) : on ne journalise que les
 * erreurs inattendues (`kind: 'unknown'` → 500), préfixées de la méthode et du chemin
 * comme le faisait SvelteKit 2 — sinon les logs du conteneur n'indiquent plus quelle
 * requête a échoué. Rien n'est renvoyé : le corps exposé reste celui par défaut
 * (`{ status, message }`, « Internal Error » pour une 500, sans détail interne).
 */
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind === 'unknown') {
		console.error(`[500] ${event.request.method} ${event.url.pathname}`, error);
	}
};
