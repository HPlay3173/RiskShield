CREATE UNIQUE INDEX IF NOT EXISTS `riskshield_skill_revisions_number_idx`
  ON `riskshield_skill_revisions` (`skill_id`, `proposed_revision`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `riskshield_candidate_decisions_validate_insert`
BEFORE INSERT ON `riskshield_candidate_decisions`
BEGIN
  SELECT CASE
    WHEN NEW.`decision` NOT IN ('approve', 'approve_with_edits', 'merge', 'hold', 'reject')
      THEN RAISE(ABORT, 'invalid_candidate_decision')
    WHEN NOT EXISTS (
      SELECT 1 FROM `riskshield_candidates`
      WHERE `id` = NEW.`candidate_id` AND `status` IN ('pending', 'held')
    ) THEN RAISE(ABORT, 'candidate_already_decided')
    WHEN NEW.`decision` = 'merge' AND (
      NEW.`merge_skill_id` IS NULL
      OR NOT EXISTS (SELECT 1 FROM `risk_skills` WHERE `id` = NEW.`merge_skill_id`)
    ) THEN RAISE(ABORT, 'invalid_merge_skill')
    WHEN NOT EXISTS (SELECT 1 FROM `riskshield_users` WHERE `id` = NEW.`actor_id` AND `status` = 'active')
      THEN RAISE(ABORT, 'invalid_candidate_actor')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `riskshield_training_runs_validate_insert`
BEFORE INSERT ON `riskshield_training_runs`
BEGIN
  SELECT CASE
    WHEN NEW.`status` NOT IN ('not_configured','queued','running','waiting_review','succeeded','degraded','failed','cancel_requested','cancelled')
      THEN RAISE(ABORT, 'invalid_training_status')
    WHEN NEW.`dataset_version_id` IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM `riskshield_dataset_versions` WHERE `id` = NEW.`dataset_version_id`)
      THEN RAISE(ABORT, 'invalid_training_dataset_version')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `riskshield_training_runs_validate_update`
BEFORE UPDATE ON `riskshield_training_runs`
BEGIN
  SELECT CASE
    WHEN NEW.`status` NOT IN ('not_configured','queued','running','waiting_review','succeeded','degraded','failed','cancel_requested','cancelled')
      THEN RAISE(ABORT, 'invalid_training_status')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `riskshield_dataset_versions_validate_insert`
BEFORE INSERT ON `riskshield_dataset_versions`
BEGIN
  SELECT CASE
    WHEN length(NEW.`sha256`) <> 64 OR lower(NEW.`sha256`) GLOB '*[^0-9a-f]*'
      THEN RAISE(ABORT, 'invalid_dataset_sha256')
    WHEN NEW.`byte_size` <= 0 OR NEW.`row_count` <= 0 OR NEW.`version_number` <= 0
      THEN RAISE(ABORT, 'invalid_dataset_counts')
    WHEN NEW.`object_key` IS NULL OR NEW.`object_key` = ''
      THEN RAISE(ABORT, 'dataset_object_key_required')
  END;
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_audit_chain` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `audit_id` text NOT NULL UNIQUE REFERENCES `riskshield_audit_logs`(`id`),
  `previous_hash` text NOT NULL UNIQUE,
  `entry_hash` text NOT NULL UNIQUE,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `riskshield_audit_logs_no_update`
BEFORE UPDATE ON `riskshield_audit_logs`
BEGIN SELECT RAISE(ABORT, 'audit_log_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `riskshield_audit_logs_no_delete`
BEFORE DELETE ON `riskshield_audit_logs`
BEGIN SELECT RAISE(ABORT, 'audit_log_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `riskshield_audit_chain_no_update`
BEFORE UPDATE ON `riskshield_audit_chain`
BEGIN SELECT RAISE(ABORT, 'audit_chain_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `riskshield_audit_chain_no_delete`
BEFORE DELETE ON `riskshield_audit_chain`
BEGIN SELECT RAISE(ABORT, 'audit_chain_append_only'); END;
