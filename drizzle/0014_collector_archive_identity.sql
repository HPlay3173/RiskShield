DROP INDEX IF EXISTS `riskshield_collector_sources_v3_fingerprint_idx`;
CREATE UNIQUE INDEX `riskshield_collector_sources_v3_fingerprint_idx`
ON `riskshield_collector_sources_v3` (`source_fingerprint`)
WHERE `archived_at` IS NULL AND `source_fingerprint` IS NOT NULL;
