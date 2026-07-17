DROP INDEX IF EXISTS `risk_skills_updated_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `risk_skills_status_idx`;
--> statement-breakpoint
ALTER TABLE `risk_skills` RENAME TO `risk_skills_legacy`;
--> statement-breakpoint
CREATE TABLE `risk_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`review_status` text NOT NULL,
	`severity_floor` integer NOT NULL,
	`dominant_risk` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "risk_skills_review_status_check" CHECK("risk_skills"."review_status" IN ('draft', 'reviewed', 'rejected')),
	CONSTRAINT "risk_skills_severity_floor_check" CHECK("risk_skills"."severity_floor" BETWEEN 0 AND 100),
	CONSTRAINT "risk_skills_dominant_risk_check" CHECK("risk_skills"."dominant_risk" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `risk_skills`
  (`id`, `category`, `review_status`, `severity_floor`, `dominant_risk`, `payload`, `created_at`, `updated_at`)
SELECT `id`, `category`,
  CASE json_extract(`payload`, '$.reviewStatus')
    WHEN 'reviewed' THEN 'reviewed'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'draft'
  END,
  `severity_floor`, `dominant_risk`, `payload`, `created_at`, `updated_at`
FROM `risk_skills_legacy`;
--> statement-breakpoint
DROP TABLE `risk_skills_legacy`;
--> statement-breakpoint
CREATE INDEX `risk_skills_updated_idx` ON `risk_skills` (`updated_at`);
--> statement-breakpoint
CREATE INDEX `risk_skills_status_idx` ON `risk_skills` (`review_status`, `category`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `payload` text NOT NULL,
  `updated_at` text NOT NULL
);
