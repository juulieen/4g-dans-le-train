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
const client = createClient({
	url: env.DATABASE_URL ?? 'file:./data/local.db',
	authToken: env.DATABASE_AUTH_TOKEN
});

export const db = drizzle(client, { schema });
export { schema };
