/**
 * URL d'origine du site (sans slash final), source unique pour les liens absolus :
 * canonical, sitemap, og:url, og:image…
 *
 * Lue depuis `PUBLIC_SITE_URL` (cf. `.env.example`) avec repli sur l'URL de prod —
 * ainsi un build sans variable d'env reste correct (pas de régression des canonicals
 * qui étaient auparavant en dur). En dev, définir `PUBLIC_SITE_URL=http://localhost:5173`
 * dans un `.env` pour des liens locaux.
 *
 * Variable **dynamique** et facultative (déclarée dans `src/env.ts`) : lue au démarrage
 * du serveur — l'image Docker est construite sans elle — et jamais bloquante si absente.
 */
import { PUBLIC_SITE_URL } from '$app/env/public';

const FALLBACK = 'https://4g-dans-le-train.juulieen.fr';

export const ORIGIN = (PUBLIC_SITE_URL || FALLBACK).replace(/\/+$/, '');
