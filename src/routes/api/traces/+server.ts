import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

/**
 * Réception d'une trace capteurs (outil expérimental, consentement explicite).
 *
 * ⚠️ Contrairement aux mesures (arrondies H3 dès réception), une trace contient
 * des positions GPS PRÉCISES du trajet. Elle n'est acceptée que parce que
 * l'utilisateur a coché l'opt-in dédié dont le libellé annonce explicitement
 * l'envoi (cf. /confidentialite). Aucun identifiant n'y est joint (pas de jeton
 * de session) ; l'id de trace est aléatoire et propre à chaque trace.
 *
 * Stockage : fichiers JSON bruts dans `data/traces/` (bind-mount persistant en
 * prod, cf. docker-compose) — pas en base, ce sont des blobs d'analyse, pas des
 * données de l'application. Nettoyage/analyse manuels.
 *
 * NOTE déploiement : l'adapter-node limite le corps des requêtes à 512 Ko par
 * défaut — `BODY_SIZE_LIMIT=20M` est requis en prod (docker-compose / DEPLOY.md).
 */
const TRACES_DIR = process.env.TRACES_DIR ?? 'data/traces';
/** Taille max d'une trace (octets) — aligné sur le plafond absolu côté client. */
const MAX_TRACE_BODY_BYTES = 16 * 1024 * 1024;
/** Plafond du nombre de traces stockées : garde-fou disque (12-16 Mo pièce). */
const MAX_STORED_TRACES = 500;
/** Rate-limit mémoire par IP : une trace par session de mesure, 5/h est large. */
const UPLOADS_PER_HOUR = 5;

const TraceMetaInput = z
	.object({
		id: z.string().uuid(),
		startedAt: z.number().int().nonnegative(),
		timeOrigin: z.number(),
		operator: z.string().max(32),
		lineSlug: z.string().max(64).nullable(),
		userAgent: z.string().max(512),
		imuHz: z.number().positive(),
		accelField: z.string().max(64),
		schemaVersion: z.literal(1)
	})
	// Champs additifs futurs (ex. uploadedAt côté client) : tolérés tels quels.
	.passthrough();

const TraceInput = z.object({
	meta: TraceMetaInput,
	imu: z.array(z.unknown()),
	windows: z.array(z.unknown()),
	gps: z.array(z.unknown()),
	events: z.array(z.unknown())
});

const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
	const now = Date.now();
	const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
	recent.push(now);
	hits.set(ip, recent);
	return recent.length > UPLOADS_PER_HOUR;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (rateLimited(getClientAddress())) throw error(429, 'Trop de traces, réessayez plus tard');

	const text = await request.text().catch(() => null);
	if (!text) throw error(400, 'Trace invalide');
	if (text.length > MAX_TRACE_BODY_BYTES) throw error(413, 'Trace trop volumineuse');

	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw error(400, 'Trace invalide');
	}
	const parsed = TraceInput.safeParse(body);
	if (!parsed.success) throw error(400, 'Trace invalide');

	try {
		await mkdir(TRACES_DIR, { recursive: true });
		const existing = await readdir(TRACES_DIR);
		if (existing.length >= MAX_STORED_TRACES) throw error(507, 'Stockage des traces plein');
		// Nom déterministe par id (uuid validé) : un ré-envoi après échec partiel
		// écrase le même fichier au lieu de dupliquer.
		const day = new Date().toISOString().slice(0, 10);
		await writeFile(path.join(TRACES_DIR, `${day}-${parsed.data.meta.id}.json`), text, 'utf8');
	} catch (e) {
		// Relaye les erreurs HTTP volontaires (507), masque le reste (chemin, disque…).
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(500, 'Stockage indisponible');
	}

	return json({ ok: true }, { status: 201 });
};
