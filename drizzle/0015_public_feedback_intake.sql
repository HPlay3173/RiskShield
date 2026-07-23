CREATE TABLE `riskshield_public_feedback_intakes` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_expression` text NOT NULL,
	`expression` text NOT NULL,
	`report_type` text NOT NULL,
	`status` text NOT NULL,
	`contexts_json` text DEFAULT '[]' NOT NULL,
	`reporter_fingerprints_json` text DEFAULT '[]' NOT NULL,
	`submission_count` integer DEFAULT 1 NOT NULL,
	`qualification_json` text,
	`search_verification_json` text,
	`candidate_id` text,
	`rule_feedback_case_id` text,
	`last_error` text,
	`next_check_at` text,
	`retention_deadline` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `riskshield_public_feedback_intakes_report_type_check` CHECK(`report_type` IN ('missed_detection', 'false_positive', 'new_expression')),
	CONSTRAINT `riskshield_public_feedback_intakes_status_check` CHECK(`status` IN ('received', 'verifying', 'monitor', 'rejected', 'promoted', 'verification_error')),
	CONSTRAINT `riskshield_public_feedback_intakes_submission_count_check` CHECK(`submission_count` >= 1),
	UNIQUE(`normalized_expression`, `report_type`)
);

CREATE INDEX `riskshield_public_feedback_intakes_status_idx`
ON `riskshield_public_feedback_intakes` (`status`, `next_check_at`, `updated_at`);

CREATE INDEX `riskshield_public_feedback_intakes_retention_idx`
ON `riskshield_public_feedback_intakes` (`retention_deadline`);

CREATE TABLE `riskshield_rule_feedback_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text NOT NULL,
	`text` text NOT NULL,
	`skill_ids_json` text DEFAULT '[]' NOT NULL,
	`expected_risk` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`intake_id`) REFERENCES `riskshield_public_feedback_intakes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `riskshield_rule_feedback_cases_expected_risk_check` CHECK(`expected_risk` IN (0, 1)),
	CONSTRAINT `riskshield_rule_feedback_cases_status_check` CHECK(`status` IN ('pending_review', 'accepted', 'rejected')),
	UNIQUE(`intake_id`)
);

CREATE INDEX `riskshield_rule_feedback_cases_status_idx`
ON `riskshield_rule_feedback_cases` (`status`, `updated_at`);

UPDATE `riskshield_candidates`
SET `status` = 'rejected', `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `status` IN ('pending', 'held') AND `id` LIKE 'public_submission_%';
