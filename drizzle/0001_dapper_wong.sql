ALTER TABLE `measurements` ADD `measured_at` integer;--> statement-breakpoint
CREATE INDEX `measurements_session_time_idx` ON `measurements` (`session_id`,`measured_at`);