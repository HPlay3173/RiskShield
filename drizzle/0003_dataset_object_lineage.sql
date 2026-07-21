ALTER TABLE `riskshield_dataset_versions` ADD COLUMN `object_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `riskshield_dataset_versions_object_key_idx`
  ON `riskshield_dataset_versions` (`object_key`)
  WHERE `object_key` IS NOT NULL;
