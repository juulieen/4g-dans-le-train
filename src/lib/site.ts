/**
 * URL d'origine du site (sans slash final), source unique pour les liens absolus :
 * canonical, sitemap, og:url, og:image…
 *
 * Lue depuis `PUBLIC_SITE_URL` (cf. `.env.example`) avec repli sur l'URL de prod —
 * ainsi un build sans variable d'env reste correct (pas de régression des canonicals
 * qui étaient auparavant en dur). En dev, définir `PUBLIC_SITE_URL=http://localhost:5173`
 * dans un `.env` pour des liens locaux.
 *
 * On utilise `$env/dynamic/public` (et non `static`) pour ne jamais casser le build
 * quand la variable n'est pas définie.
 */
import { env } from '$env/dynamic/public';

const FALLBACK = 'https://4g-dans-le-train.juulieen.fr';

export const ORIGIN = (env.PUBLIC_SITE_URL || FALLBACK).replace(/\/+$/, '');

/** Construit une URL absolue à partir d'un chemin (`/ligne/paris-lyon`). */
export function absUrl(path: string): string {
	return `${ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}
