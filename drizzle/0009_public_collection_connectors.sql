CREATE TABLE `riskshield_collector_sources_v2` (
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
	CONSTRAINT `riskshield_collector_sources_v2_provider_check` CHECK("provider" IN ('bluesky', 'mastodon', 'x', 'threads', 'dcinside')),
	CONSTRAINT `riskshield_collector_sources_v2_interval_check` CHECK("interval_minutes" BETWEEN 15 AND 10080)
);
CREATE INDEX `riskshield_collector_sources_v2_due_idx` ON `riskshield_collector_sources_v2` (`enabled`,`last_run_at`);

INSERT INTO `riskshield_collector_sources_v2`
SELECT `id`, `provider`, `label`, `query`, `endpoint`, `enabled`, `interval_minutes`, `cursor`, `last_run_at`, `last_status`, `last_message`, `created_at`, `updated_at`
FROM `riskshield_collector_sources`;

CREATE TABLE `riskshield_collected_posts_v2` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`text` text NOT NULL,
	`source_url` text,
	`published_at` text,
	`collected_at` text NOT NULL,
	`candidate_id` text,
	FOREIGN KEY (`source_id`) REFERENCES `riskshield_collector_sources_v2`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `riskshield_collected_posts_v2_source_external_idx` ON `riskshield_collected_posts_v2` (`source_id`,`external_id`);
CREATE INDEX `riskshield_collected_posts_v2_collected_idx` ON `riskshield_collected_posts_v2` (`collected_at`);

INSERT INTO `riskshield_collected_posts_v2`
SELECT `id`, `source_id`, `provider`, `external_id`, `text`, `source_url`, `published_at`, `collected_at`, `candidate_id`
FROM `riskshield_collected_posts`;

CREATE TABLE `riskshield_collector_runs_v2` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`message` text,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `riskshield_collector_sources_v2`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `riskshield_collector_runs_v2_source_idx` ON `riskshield_collector_runs_v2` (`source_id`,`started_at`);

INSERT INTO `riskshield_collector_runs_v2`
SELECT `id`, `source_id`, `status`, `fetched_count`, `new_count`, `candidate_count`, `message`, `started_at`, `finished_at`
FROM `riskshield_collector_runs`;
