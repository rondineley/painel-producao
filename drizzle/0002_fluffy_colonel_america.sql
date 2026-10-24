CREATE TABLE `daily_production` (
	`line` text NOT NULL,
	`day` text NOT NULL,
	`production` real,
	`efficiency` real,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`line`, `day`)
);
