CREATE TABLE `indicator_images` (
	`line` text NOT NULL,
	`period` text NOT NULL,
	`topic` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`line`, `period`, `topic`)
);


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


CREATE TABLE `daily_production` (
	`line` text NOT NULL,
	`day` text NOT NULL,
	`production` real,
	`efficiency` real,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`line`, `day`)
);


CREATE TABLE `online_visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`last_seen` integer NOT NULL
);
