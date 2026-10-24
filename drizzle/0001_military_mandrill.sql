CREATE TABLE `monthly_metrics` (
	`line` text NOT NULL,
	`period` text NOT NULL,
	`topic` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`source_key` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`line`, `period`, `topic`)
);
