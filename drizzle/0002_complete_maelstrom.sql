ALTER TABLE `cell_aggregates` ADD `median_jitter` real;--> statement-breakpoint
ALTER TABLE `cell_aggregates` ADD `median_loss` real;--> statement-breakpoint
ALTER TABLE `cell_aggregates` ADD `median_downlink` integer;--> statement-breakpoint
ALTER TABLE `measurements` ADD `jitter_ms` real;--> statement-breakpoint
ALTER TABLE `measurements` ADD `loss` real;--> statement-breakpoint
ALTER TABLE `measurements` ADD `downlink_kbps` integer;