CREATE TABLE `indicator_images` (
	`line` text NOT NULL,
	`period` text NOT NULL,
	`topic` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`line`, `period`, `topic`)
);
