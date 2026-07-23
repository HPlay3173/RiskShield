ALTER TABLE `riskshield_collector_sources_v3` ADD COLUMN `source_fingerprint` text;
ALTER TABLE `riskshield_collector_sources_v3` ADD COLUMN `archived_at` text;
CREATE UNIQUE INDEX `riskshield_collector_sources_v3_fingerprint_idx`
ON `riskshield_collector_sources_v3` (`source_fingerprint`);

ALTER TABLE `riskshield_collected_posts_v3` ADD COLUMN `post_fingerprint` text;
CREATE UNIQUE INDEX `riskshield_collected_posts_v3_fingerprint_idx`
ON `riskshield_collected_posts_v3` (`post_fingerprint`);
