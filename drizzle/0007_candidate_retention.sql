ALTER TABLE `riskshield_candidates` ADD COLUMN `retention_deadline` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `riskshield_candidates_retention_idx`
  ON `riskshield_candidates` (`retention_deadline`);
