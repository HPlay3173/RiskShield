CREATE TABLE IF NOT EXISTS `riskshield_roles` (
  `name` text PRIMARY KEY NOT NULL,
  `capabilities` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `riskshield_roles` (`name`, `capabilities`, `updated_at`) VALUES
  ('reviewer', '["candidate:read","candidate:decide","skill:read_admin","skill:propose_revision","audit:read_admin"]', CURRENT_TIMESTAMP),
  ('developer', '["skill:read_admin","dataset:manage","training:run","evaluation:run","model:manage","prompt:manage","audit:read_dev"]', CURRENT_TIMESTAMP),
  ('owner', '["candidate:read","candidate:decide","skill:read_admin","skill:propose_revision","dataset:manage","training:run","evaluation:run","model:manage","prompt:manage","release:deploy","release:rollback","audit:read_admin","audit:read_dev","principal:manage"]', CURRENT_TIMESTAMP)
ON CONFLICT(`name`) DO UPDATE SET
  `capabilities` = excluded.`capabilities`,
  `updated_at` = excluded.`updated_at`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_users` (
  `id` text PRIMARY KEY NOT NULL,
  `identity_provider` text NOT NULL,
  `external_subject` text NOT NULL,
  `normalized_email` text NOT NULL,
  `role_name` text NOT NULL REFERENCES `riskshield_roles`(`name`),
  `status` text NOT NULL,
  `role_version` integer NOT NULL,
  `session_not_before` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `riskshield_users_provider_check` CHECK (`identity_provider` = 'google'),
  CONSTRAINT `riskshield_users_status_check` CHECK (`status` IN ('active', 'disabled')),
  CONSTRAINT `riskshield_users_role_version_check` CHECK (`role_version` >= 1),
  UNIQUE (`identity_provider`, `external_subject`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `riskshield_users_email_idx`
  ON `riskshield_users` (`normalized_email`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `riskshield_session_revocations` (
  `session_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `riskshield_users`(`id`),
  `expires_at` text NOT NULL,
  `revoked_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `riskshield_session_revocations_expiry_idx`
  ON `riskshield_session_revocations` (`expires_at`);
