import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { snapToCell } from '$geo/h3';
import { lineSlugForCell } from '$geo/line-snap';
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
	downlinkKbps: z.number().int().nonnegative().nullable().optional(),
	operator: z.enum(['orange', 'sfr', 'free', 'bouygues', 'autre', 'inconnu']).default('inconnu'),
	netType: z.string().max(16).nullable().optional(),
	speedKmh: z.number().nonnegative().nullable().optional(),
	gpsAccuracy: z.number().nonnegative().nullable().optional(),
	/** Instant réel de la mesure (époch ms) — sert à dériver les coupures. */
	measuredAt: z.number().int().nonnegative().nullable().optional(),
	/** Origine de la position : `gps` par défaut, `interpolated` si reconstruite sur le tracé. */
	posSource: z.enum(['gps', 'interpolated']).default('gps'),
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

	// Rattachement à la ligne ferroviaire : O(1) via l'index pré-calculé. La
	// cellule peut n'appartenir à aucune ligne connue (lineSlug = null) ; on
	// accepte la mesure dans tous les cas (pas de rejet — décision documentée
	// dans docs/PRODUCT.md), seul le rattachement est optionnel.
	const lineSlug = lineSlugForCell(snapped.cellId);

	await ingestMeasurement({
		cellId: snapped.cellId,
		lat: snapped.lat,
		lng: snapped.lng,
		status: m.status,
		rttMs: m.rttMs ?? null,
		downlinkKbps: m.downlinkKbps ?? null,
		operator: m.operator,
		netType: m.netType ?? null,
		speedKmh: m.speedKmh ?? null,
		gpsAccuracy: m.gpsAccuracy ?? null,
		lineSlug,
		measuredAt: m.measuredAt ?? null,
		posSource: m.posSource,
		sessionId: m.sessionId
	});

	return json({ ok: true, cellId: snapped.cellId, lineSlug }, { status: 201 });
};
