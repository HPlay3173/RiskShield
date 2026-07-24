CREATE TABLE `riskshield_expression_verifications` (
	`normalized_expression` text NOT NULL,
	`quality_gate_version` text NOT NULL,
	`decision` text NOT NULL,
	`semantic_role` text,
	`risk_family` text,
	`meaning` text,
	`reason` text,
	`confidence` real,
	`direct_use_supported` integer DEFAULT 0 NOT NULL,
	`queries_json` text DEFAULT '[]' NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`evidence_fingerprint` text,
	`verified_observation_count` integer DEFAULT 0 NOT NULL,
	`verified_at` text NOT NULL,
	`next_check_at` text NOT NULL,
	`last_error` text,
	`error_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY (`normalized_expression`, `quality_gate_version`),
	CONSTRAINT `riskshield_expression_verifications_decision_check` CHECK("decision" IN ('reject', 'monitor', 'send_to_review', 'error')),
	CONSTRAINT `riskshield_expression_verifications_confidence_check` CHECK("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
	CONSTRAINT `riskshield_expression_verifications_count_check` CHECK("verified_observation_count" >= 0 AND "error_count" >= 0)
);

CREATE INDEX `riskshield_expression_verifications_next_check_idx`
ON `riskshield_expression_verifications` (`decision`, `next_check_at`);
