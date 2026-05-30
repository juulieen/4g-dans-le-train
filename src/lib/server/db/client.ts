import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

/**
 * Client libSQL partagé.
 *
 * Par défaut : fichier local (`file:./data/local.db`) pour l'auto-hébergement,
 * stocké dans le bind-mount ./data (survit aux redéploiements Docker).
 * Bascule vers Turso cloud en renseignant DATABASE_URL=libsql://… + DATABASE_AUTH_TOKEN.
 */
const url = env.DATABASE_URL ?? 'file:./data/local.db';

// Pour un fichier local, on s'assure que le dossier parent existe : sinon libSQL
// échoue à l'ouverture (cas du build/prerender ou d'un premier démarrage).
if (url.startsWith('file:')) {
	try {
		mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
	} catch {
		/* best-effort */
	}
}

const client = createClient({ url, authToken: env.DATABASE_AUTH_TOKEN });

export const db = drizzle(client, { schema });
export { schema };
