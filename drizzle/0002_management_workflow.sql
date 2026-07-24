CREATE TABLE IF NOT EXISTS `riskshield_datasets` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source_kind` text NOT NULL DEFAULT 'csv',
  `status` text NOT NULL DEFAULT 'staging',
  `owner` text NOT NULL,
  `license` text NOT NULL,
  `allowed_purpose` text NOT NULL,
  `retention` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `riskshield_datasets_status_check` CHECK (`status` IN ('staging', 'ready', 'invalid', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_dataset_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `dataset_id` text NOT NULL REFERENCES `riskshield_datasets`(`id`),
  `version_number` integer NOT NULL,
  `sha256` text NOT NULL,
  `byte_size` integer NOT NULL,
  `row_count` integer NOT NULL,
  `encoding` text NOT NULL,
  `delimiter` text NOT NULL,
  `headers_json` text NOT NULL,
  `keyword_column` text NOT NULL,
  `created_at` text NOT NULL,
  UNIQUE (`dataset_id`, `version_number`),
  UNIQUE (`dataset_id`, `sha256`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `riskshield_dataset_versions_dataset_idx`
  ON `riskshield_dataset_versions` (`dataset_id`, `version_number` DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `payload` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `riskshield_candidates_status_check` CHECK (`status` IN ('pending', 'approved', 'merged', 'held', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `riskshield_candidates_status_idx`
  ON `riskshield_candidates` (`status`, `updated_at` DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_candidate_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `candidate_id` text NOT NULL REFERENCES `riskshield_candidates`(`id`),
  `decision` text NOT NULL,
  `note` text,
  `merge_skill_id` text,
  `actor_id` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_training_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `dataset_version_id` text,
  `status` text NOT NULL,
  `current_stage` text,
  `item_count` integer,
  `warning_count` integer,
  `estimated_cost` real,
  `latency_ms` integer,
  `payload` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_skill_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `skill_id` text NOT NULL,
  `base_revision` integer NOT NULL,
  `proposed_revision` integer NOT NULL,
  `summary` text NOT NULL,
  `rationale` text NOT NULL,
  `payload` text NOT NULL,
  `actor_id` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_audit_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `occurred_at` text NOT NULL,
  `actor_id` text NOT NULL,
  `action` text NOT NULL,
  `resource_type` text NOT NULL,
  `resource_id` text NOT NULL,
  `result` text NOT NULL,
  `before_json` text,
  `after_json` text,
  `reason` text,
  CONSTRAINT `riskshield_audit_result_check` CHECK (`result` IN ('succeeded', 'denied', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `riskshield_audit_occurred_idx`
  ON `riskshield_audit_logs` (`occurred_at` DESC);
