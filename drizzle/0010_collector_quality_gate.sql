CREATE TABLE `riskshield_collector_sources_v3` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`query` text NOT NULL,
	`endpoint` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`interval_minutes` integer DEFAULT 60 NOT NULL,
	`cursor` text,
	`last_run_at` text,
	`last_status` text,
	`last_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `riskshield_collector_sources_v3_provider_check` CHECK("provider" IN ('youtube', 'bluesky', 'mastodon', 'x', 'threads', 'dcinside')),
	CONSTRAINT `riskshield_collector_sources_v3_interval_check` CHECK("interval_minutes" BETWEEN 15 AND 10080)
);
CREATE INDEX `riskshield_collector_sources_v3_due_idx` ON `riskshield_collector_sources_v3` (`enabled`,`last_run_at`);

INSERT INTO `riskshield_collector_sources_v3`
SELECT `id`, `provider`, `label`, `query`, `endpoint`, `enabled`, `interval_minutes`, `cursor`, `last_run_at`, `last_status`, `last_message`, `created_at`, `updated_at`
FROM `riskshield_collector_sources_v2`;

CREATE TABLE `riskshield_collected_posts_v3` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`text` text NOT NULL,
	`source_url` text,
	`published_at` text,
	`collected_at` text NOT NULL,
	`author_hash` text,
	`candidate_id` text,
	FOREIGN KEY (`source_id`) REFERENCES `riskshield_collector_sources_v3`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `riskshield_collected_posts_v3_source_external_idx` ON `riskshield_collected_posts_v3` (`source_id`,`external_id`);
CREATE INDEX `riskshield_collected_posts_v3_collected_idx` ON `riskshield_collected_posts_v3` (`collected_at`);

INSERT INTO `riskshield_collected_posts_v3`
SELECT `id`, `source_id`, `provider`, `external_id`, `text`, `source_url`, `published_at`, `collected_at`, NULL, `candidate_id`
FROM `riskshield_collected_posts_v2`;

CREATE TABLE `riskshield_expression_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_expression` text NOT NULL,
	`display_expression` text NOT NULL,
	`source_id` text NOT NULL,
	`provider` text NOT NULL,
	`post_id` text NOT NULL,
	`author_hash` text,
	`redacted_excerpt` text NOT NULL,
	`source_url` text,
	`published_at` text,
	`context_label` text DEFAULT 'uncertain' NOT NULL,
	`classifier_confidence` real,
	`risk_family` text,
	`qualification_status` text DEFAULT 'observed' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `riskshield_collector_sources_v3`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `riskshield_collected_posts_v3`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `riskshield_expression_observations_label_check` CHECK("context_label" IN ('direct_attack', 'group_discrimination', 'threat', 'coded_reference', 'quotation', 'warning', 'definition', 'benign', 'uncertain')),
	CONSTRAINT `riskshield_expression_observations_status_check` CHECK("qualification_status" IN ('observed', 'monitor', 'rejected', 'qualified'))
);
CREATE UNIQUE INDEX `riskshield_expression_observations_unique_idx` ON `riskshield_expression_observations` (`source_id`,`post_id`,`normalized_expression`);
CREATE INDEX `riskshield_expression_observations_expression_idx` ON `riskshield_expression_observations` (`normalized_expression`,`created_at`);
CREATE INDEX `riskshield_expression_observations_status_idx` ON `riskshield_expression_observations` (`qualification_status`,`created_at`);

CREATE TABLE `riskshield_collector_runs_v3` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`observation_count` integer DEFAULT 0 NOT NULL,
	`monitored_count` integer DEFAULT 0 NOT NULL,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`message` text,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `riskshield_collector_sources_v3`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `riskshield_collector_runs_v3_source_idx` ON `riskshield_collector_runs_v3` (`source_id`,`started_at`);

INSERT INTO `riskshield_collector_runs_v3`
SELECT `id`, `source_id`, `status`, `fetched_count`, `new_count`, 0, 0, 0, `candidate_count`, `message`, `started_at`, `finished_at`
FROM `riskshield_collector_runs_v2`;
