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
		/** Débit descendant estimé en kbps (null si non mesuré — débit opt-in/cadencé). */
		downlinkKbps: integer('downlink_kbps'),
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
		/**
		 * Instant réel de la mesure côté client (époch **ms**, ≠ created_at en s).
		 * Indispensable pour reconstruire la chronologie des coupures : created_at
		 * est l'instant d'INSERTION, faussé par le rejeu hors-ligne. Nullable : les
		 * mesures antérieures à cette fonctionnalité n'en ont pas.
		 */
		measuredAt: integer('measured_at'),
		/**
		 * Origine de la position : `gps` (mesure GPS directe) ou `interpolated`
		 * (position reconstruite le long du tracé pendant un trou GPS, cf.
		 * src/lib/measure/controller.ts). Permet de distinguer plus tard ces points
		 * sur la carte. Défaut `gps` → les mesures historiques restent cohérentes.
		 */
		posSource: text('pos_source', { enum: ['gps', 'interpolated'] })
			.notNull()
			.default('gps'),
		createdAt: integer('created_at')
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => ({
		cellOperatorIdx: index('measurements_cell_operator_idx').on(t.cellId, t.operator),
		lineIdx: index('measurements_line_idx').on(t.lineSlug),
		sessionIdx: index('measurements_session_idx').on(t.sessionId),
		// Scan ordonné par session pour dériver les épisodes de coupure.
		sessionTimeIdx: index('measurements_session_time_idx').on(t.sessionId, t.measuredAt)
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
		/** Débit descendant médian en kbps (null si aucune mesure de débit). */
		medianDownlink: integer('median_downlink'),
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
