CREATE TABLE `cell_aggregates` (
	`cell_id` text NOT NULL,
	`operator` text DEFAULT 'inconnu' NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`samples` integer DEFAULT 0 NOT NULL,
	`success_rate` real DEFAULT 0 NOT NULL,
	`median_rtt` integer,
	`line_slug` text,
	`last_seen` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cell_aggregates_cell_operator_idx` ON `cell_aggregates` (`cell_id`,`operator`);--> statement-breakpoint
CREATE INDEX `cell_aggregates_line_idx` ON `cell_aggregates` (`line_slug`);--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cell_id` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`status` text NOT NULL,
	`rtt_ms` integer,
	`operator` text DEFAULT 'inconnu' NOT NULL,
	`net_type` text,
	`speed_kmh` real,
	`gps_accuracy` real,
	`line_slug` text,
	`session_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `measurements_cell_operator_idx` ON `measurements` (`cell_id`,`operator`);--> statement-breakpoint
CREATE INDEX `measurements_line_idx` ON `measurements` (`line_slug`);--> statement-breakpoint
CREATE INDEX `measurements_session_idx` ON `measurements` (`session_id`);