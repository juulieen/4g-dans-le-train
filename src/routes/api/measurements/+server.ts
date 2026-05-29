import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { snapToCell } from '$geo/h3';
import { ingestMeasurement } from '$lib/server/ingest';
import type { RequestHandler } from './$types';

/**
 * Ingestion d'une mesure communautaire.
 *
 * Vie privée : la position reçue est immédiatement arrondie au centre de sa
 * cellule H3 (snapToCell) ; on ne stocke jamais la position GPS exacte.
 */
const MeasurementInput = z.object({
	lat: z.number().min(-90).max(90),
	lng: z.number().min(-180).max(180),
	status: z.enum(['ok', 'degraded', 'none']),
	rttMs: z.number().int().nonnegative().nullable().optional(),
	operator: z.enum(['orange', 'sfr', 'free', 'bouygues', 'autre', 'inconnu']).default('inconnu'),
	netType: z.string().max(16).nullable().optional(),
	speedKmh: z.number().nonnegative().nullable().optional(),
	gpsAccuracy: z.number().nonnegative().nullable().optional(),
	sessionId: z.string().uuid()
});

// Rate-limit mémoire simple (par session, fenêtre glissante d'1 min).
const RATE_LIMIT = Number(process.env.INGEST_RATE_LIMIT ?? '120');
const hits = new Map<string, number[]>();

function rateLimited(sessionId: string): boolean {
	const now = Date.now();
	const recent = (hits.get(sessionId) ?? []).filter((t) => now - t < 60_000);
	recent.push(now);
	hits.set(sessionId, recent);
	return recent.length > RATE_LIMIT;
}

export const POST: RequestHandler = async ({ request }) => {
	const parsed = MeasurementInput.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Mesure invalide');

	const m = parsed.data;
	if (rateLimited(m.sessionId)) throw error(429, 'Trop de mesures, ralentissez');

	// Anonymisation : arrondi à la cellule H3 avant tout stockage.
	const snapped = snapToCell(m.lat, m.lng);

	await ingestMeasurement({
		cellId: snapped.cellId,
		lat: snapped.lat,
		lng: snapped.lng,
		status: m.status,
		rttMs: m.rttMs ?? null,
		operator: m.operator,
		netType: m.netType ?? null,
		speedKmh: m.speedKmh ?? null,
		gpsAccuracy: m.gpsAccuracy ?? null,
		sessionId: m.sessionId
	});

	return json({ ok: true, cellId: snapped.cellId }, { status: 201 });
};
