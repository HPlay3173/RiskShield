CREATE TABLE `riskshield_collector_sources` (
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
	CONSTRAINT `riskshield_collector_sources_provider_check` CHECK("provider" IN ('x', 'threads', 'dcinside')),
	CONSTRAINT `riskshield_collector_sources_interval_check` CHECK("interval_minutes" BETWEEN 15 AND 10080)
);
CREATE INDEX `riskshield_collector_sources_due_idx` ON `riskshield_collector_sources` (`enabled`,`last_run_at`);
CREATE TABLE `riskshield_collected_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`text` text NOT NULL,
	`source_url` text,
	`published_at` text,
	`collected_at` text NOT NULL,
	`candidate_id` text,
	FOREIGN KEY (`source_id`) REFERENCES `riskshield_collector_sources`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `riskshield_collected_posts_source_external_idx` ON `riskshield_collected_posts` (`source_id`,`external_id`);
CREATE INDEX `riskshield_collected_posts_collected_idx` ON `riskshield_collected_posts` (`collected_at`);
CREATE TABLE `riskshield_collector_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`message` text,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `riskshield_collector_sources`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `riskshield_collector_runs_source_idx` ON `riskshield_collector_runs` (`source_id`,`started_at`);
CREATE TABLE `riskshield_evaluation_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`expected_risk` integer NOT NULL,
	`expected_family` text,
	`context` text DEFAULT 'general' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `riskshield_evaluation_cases_enabled_idx` ON `riskshield_evaluation_cases` (`enabled`,`context`);
CREATE TABLE `riskshield_evaluation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`case_count` integer NOT NULL,
	`metrics_json` text NOT NULL,
	`results_json` text NOT NULL,
	`calibration_json` text,
	`source_commit` text NOT NULL,
	`scoring_policy` text NOT NULL,
	`created_at` text NOT NULL
);
CREATE INDEX `riskshield_evaluation_runs_created_idx` ON `riskshield_evaluation_runs` (`created_at`);
CREATE TABLE `riskshield_calibration_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluation_run_id` text NOT NULL,
	`mapping_json` text NOT NULL,
	`sample_count` integer NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`activated_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`evaluation_run_id`) REFERENCES `riskshield_evaluation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `riskshield_calibration_policies_active_idx` ON `riskshield_calibration_policies` (`active`,`created_at`);
