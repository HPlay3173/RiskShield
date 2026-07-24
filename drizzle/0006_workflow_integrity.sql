CREATE UNIQUE INDEX IF NOT EXISTS `riskshield_skill_revisions_number_idx`
  ON `riskshield_skill_revisions` (`skill_id`, `proposed_revision`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_candidate_terminal_claims` (
  `candidate_id` text PRIMARY KEY NOT NULL REFERENCES `riskshield_candidates`(`id`),
  `decision_id` text NOT NULL UNIQUE,
  `actor_id` text NOT NULL REFERENCES `riskshield_users`(`id`),
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_audit_chain` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `audit_id` text NOT NULL UNIQUE REFERENCES `riskshield_audit_logs`(`id`),
  `previous_hash` text NOT NULL UNIQUE,
  `entry_hash` text NOT NULL UNIQUE,
  `created_at` text NOT NULL
);
