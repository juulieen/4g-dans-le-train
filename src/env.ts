import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Variables d'environnement de l'app (SvelteKit 3 : `$app/env/private` et
 * `$app/env/public`). Toutes sont **dynamiques** (lues au démarrage du serveur, pas
 * figées au build — l'image Docker est construite sans elles) et **facultatives** :
 * un schéma qui renvoie `undefined` rend la variable optionnelle, le repli est fait
 * par le code qui la consomme. Sans schéma, SvelteKit exigerait la variable et
 * refuserait de démarrer.
 *
 * Les scripts (`scripts/*.ts`, `drizzle.config.ts`) ne passent pas par SvelteKit et
 * lisent toujours `process.env`. Les variables d'adapter-node (`PORT`, `HOST`,
 * `PROTOCOL_HEADER`, `BODY_SIZE_LIMIT`…) sont lues par l'adapter lui-même.
 */

/** Chaîne vide ou absente → `undefined` (la valeur par défaut s'applique). */
const optional = (value: string | undefined) => value?.trim() || undefined;

export const variables = defineEnvVars({
	PUBLIC_SITE_URL: {
		public: true,
		description:
			"URL publique du site (sans slash final), source des liens absolus (canonical, og:url, sitemap). Repli sur l'URL de prod (src/lib/site.ts).",
		schema: optional
	},
	DATABASE_URL: {
		description: 'URL libSQL : `file:./data/local.db` par défaut, ou `libsql://…` (Turso).',
		schema: optional
	},
	DATABASE_AUTH_TOKEN: {
		description: 'Jeton Turso (inutile pour un fichier local).',
		schema: optional
	},
	INGEST_RATE_LIMIT: {
		description: 'Nombre max de mesures acceptées par session et par minute (défaut 120).',
		schema: (value) => {
			const raw = optional(value);
			if (raw === undefined) return 120;
			const n = Number(raw);
			if (!Number.isInteger(n) || n <= 0)
				throw new Error(`INGEST_RATE_LIMIT doit être un entier > 0 (reçu « ${raw} »)`);
			return n;
		}
	}
});
