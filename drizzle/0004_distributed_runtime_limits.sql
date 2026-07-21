CREATE TABLE IF NOT EXISTS `riskshield_public_limits` (
  `bucket_key` text PRIMARY KEY NOT NULL,
  `day` text NOT NULL,
  `day_count` integer NOT NULL DEFAULT 0,
  `window_started_at` integer NOT NULL,
  `window_count` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL,
  CONSTRAINT `riskshield_public_limits_day_count_check` CHECK (`day_count` >= 0),
  CONSTRAINT `riskshield_public_limits_window_count_check` CHECK (`window_count` >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `riskshield_public_limits_updated_idx`
  ON `riskshield_public_limits` (`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_provider_budgets` (
  `day` text PRIMARY KEY NOT NULL,
  `call_count` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL,
  CONSTRAINT `riskshield_provider_budgets_count_check` CHECK (`call_count` >= 0)
);
