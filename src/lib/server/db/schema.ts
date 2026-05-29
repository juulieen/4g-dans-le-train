import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Mesures brutes contribuées par les voyageurs.
 *
 * Vie privée : les coordonnées sont arrondies au centre de la cellule H3
 * (≈100–200 m) avant stockage ; aucun identifiant personnel n'est conservé.
 * `sessionId` est un jeton anonyme jetable généré côté client.
 */
export const measurements = sqliteTable(
	'measurements',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Index de cellule H3 (résolution définie dans src/lib/geo/h3.ts). */
		cellId: text('cell_id').notNull(),
		/** Latitude/longitude arrondies au centre de la cellule. */
		lat: real('lat').notNull(),
		lng: real('lng').notNull(),
		/** État de connectivité dérivé du ping actif. */
		status: text('status', { enum: ['ok', 'degraded', 'none'] }).notNull(),
		/** Latence aller-retour du ping en ms (null si timeout). */
		rttMs: integer('rtt_ms'),
		/** Opérateur déclaré par l'utilisateur. */
		operator: text('operator', {
			enum: ['orange', 'sfr', 'free', 'bouygues', 'autre', 'inconnu']
		})
			.notNull()
			.default('inconnu'),
		/** Type de réseau via navigator.connection (Android/Chrome) : 4g, 3g… */
		netType: text('net_type'),
		/** Vitesse GPS en km/h (filtre de plausibilité ferroviaire). */
		speedKmh: real('speed_kmh'),
		/** Précision GPS en mètres. */
		gpsAccuracy: real('gps_accuracy'),
		/** Slug de la ligne ferroviaire rattachée (snap), si trouvée. */
		lineSlug: text('line_slug'),
		/** Jeton de session anonyme. */
		sessionId: text('session_id').notNull(),
		createdAt: integer('created_at')
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => ({
		cellOperatorIdx: index('measurements_cell_operator_idx').on(t.cellId, t.operator),
		lineIdx: index('measurements_line_idx').on(t.lineSlug),
		sessionIdx: index('measurements_session_idx').on(t.sessionId)
	})
);

/**
 * Agrégats par cellule H3 et par opérateur, recalculés à l'ingestion.
 * C'est ce que l'API GET /api/coverage sert à la carte.
 */
export const cellAggregates = sqliteTable(
	'cell_aggregates',
	{
		cellId: text('cell_id').notNull(),
		operator: text('operator').notNull().default('inconnu'),
		lat: real('lat').notNull(),
		lng: real('lng').notNull(),
		samples: integer('samples').notNull().default(0),
		/** Part de mesures avec status = 'ok' (0..1). */
		successRate: real('success_rate').notNull().default(0),
		medianRtt: integer('median_rtt'),
		lineSlug: text('line_slug'),
		lastSeen: integer('last_seen')
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => ({
		cellOperatorIdx: index('cell_aggregates_cell_operator_idx').on(t.cellId, t.operator),
		lineIdx: index('cell_aggregates_line_idx').on(t.lineSlug)
	})
);

export type Measurement = typeof measurements.$inferSelect;
export type NewMeasurement = typeof measurements.$inferInsert;
export type CellAggregate = typeof cellAggregates.$inferSelect;
