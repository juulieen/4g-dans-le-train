/**
 * Applique les migrations Drizzle au fichier libSQL local (ou à Turso cloud).
 *
 * Workflow :
 *   1. bun run db:generate   -> génère le SQL dans ./drizzle d'après le schéma
 *   2. bun run db:migrate    -> applique ces migrations (ce script)
 *
 * On garde le dossier ./drizzle versionné = historique des migrations appliquées.
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const url = process.env.DATABASE_URL ?? 'file:./data/local.db';
const authToken = process.env.DATABASE_AUTH_TOKEN;

const client = createClient({ url, authToken });
const db = drizzle(client);

console.log(`[migrate] cible : ${url}`);
await migrate(db, { migrationsFolder: './drizzle' });
console.log('[migrate] migrations appliquées ✅');
client.close();
