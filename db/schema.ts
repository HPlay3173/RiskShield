import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const riskSkills = sqliteTable(
  "risk_skills",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    reviewStatus: text("review_status").notNull(),
    severityFloor: integer("severity_floor").notNull(),
    dominantRisk: integer("dominant_risk", { mode: "boolean" }).notNull(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("risk_skills_updated_idx").on(table.updatedAt),
    index("risk_skills_status_idx").on(table.reviewStatus, table.category),
    check(
      "risk_skills_review_status_check",
      sql`${table.reviewStatus} IN ('draft', 'reviewed', 'rejected')`,
    ),
    check(
      "risk_skills_severity_floor_check",
      sql`${table.severityFloor} BETWEEN 0 AND 100`,
    ),
    check(
      "risk_skills_dominant_risk_check",
      sql`${table.dominantRisk} IN (0, 1)`,
    ),
  ],
);

export const riskshieldRoles = sqliteTable("riskshield_roles", {
  name: text("name").primaryKey(),
  capabilities: text("capabilities").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const riskshieldUsers = sqliteTable(
  "riskshield_users",
  {
    id: text("id").primaryKey(),
    identityProvider: text("identity_provider").notNull(),
    externalSubject: text("external_subject").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    roleName: text("role_name").notNull().references(() => riskshieldRoles.name),
    status: text("status").notNull(),
    roleVersion: integer("role_version").notNull(),
    sessionNotBefore: text("session_not_before"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("riskshield_users_provider_subject_idx").on(
      table.identityProvider,
      table.externalSubject,
    ),
    check("riskshield_users_provider_check", sql`${table.identityProvider} = 'google'`),
    check("riskshield_users_status_check", sql`${table.status} IN ('active', 'disabled')`),
    check("riskshield_users_role_version_check", sql`${table.roleVersion} >= 1`),
  ],
);

export const riskshieldSessionRevocations = sqliteTable(
  "riskshield_session_revocations",
  {
    sessionId: text("session_id").primaryKey(),
    userId: text("user_id").notNull().references(() => riskshieldUsers.id),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at").notNull(),
  },
  (table) => [index("riskshield_session_revocations_expiry_idx").on(table.expiresAt)],
);

export const riskshieldDatasets = sqliteTable(
  "riskshield_datasets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sourceKind: text("source_kind").notNull().default("csv"),
    status: text("status").notNull().default("staging"),
    owner: text("owner").notNull(),
    license: text("license").notNull(),
    allowedPurpose: text("allowed_purpose").notNull(),
    retention: text("retention").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("riskshield_datasets_status_check", sql`${table.status} IN ('staging', 'ready', 'invalid', 'unavailable')`),
  ],
);

export const riskshieldDatasetVersions = sqliteTable(
  "riskshield_dataset_versions",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id").notNull().references(() => riskshieldDatasets.id),
    versionNumber: integer("version_number").notNull(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    rowCount: integer("row_count").notNull(),
    encoding: text("encoding").notNull(),
    delimiter: text("delimiter").notNull(),
    headersJson: text("headers_json").notNull(),
    keywordColumn: text("keyword_column").notNull(),
    objectKey: text("object_key"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("riskshield_dataset_versions_number_idx").on(table.datasetId, table.versionNumber),
    uniqueIndex("riskshield_dataset_versions_sha_idx").on(table.datasetId, table.sha256),
  ],
);

export const riskshieldCandidates = sqliteTable(
  "riskshield_candidates",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().default("pending"),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("riskshield_candidates_status_idx").on(table.status, table.updatedAt),
    check("riskshield_candidates_status_check", sql`${table.status} IN ('pending', 'approved', 'merged', 'held', 'rejected')`),
  ],
);

export const riskshieldCandidateDecisions = sqliteTable(
  "riskshield_candidate_decisions",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id").notNull().references(() => riskshieldCandidates.id),
    decision: text("decision").notNull(),
    note: text("note"),
    mergeSkillId: text("merge_skill_id").references(() => riskSkills.id),
    actorId: text("actor_id").notNull().references(() => riskshieldUsers.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [check("riskshield_candidate_decisions_decision_check", sql`${table.decision} IN ('approve','approve_with_edits','merge','hold','reject')`)],
);

export const riskshieldCandidateTerminalClaims = sqliteTable("riskshield_candidate_terminal_claims", {
  candidateId: text("candidate_id").primaryKey().references(() => riskshieldCandidates.id),
  decisionId: text("decision_id").notNull().unique(),
  actorId: text("actor_id").notNull().references(() => riskshieldUsers.id),
  createdAt: text("created_at").notNull(),
});

export const riskshieldTrainingRuns = sqliteTable("riskshield_training_runs", {
  id: text("id").primaryKey(),
  datasetVersionId: text("dataset_version_id").references(() => riskshieldDatasetVersions.id),
  status: text("status").notNull(),
  currentStage: text("current_stage"),
  itemCount: integer("item_count"),
  warningCount: integer("warning_count"),
  estimatedCost: real("estimated_cost"),
  latencyMs: integer("latency_ms"),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const riskshieldSkillRevisions = sqliteTable("riskshield_skill_revisions", {
  id: text("id").primaryKey(),
  skillId: text("skill_id").notNull().references(() => riskSkills.id),
  baseRevision: integer("base_revision").notNull(),
  proposedRevision: integer("proposed_revision").notNull(),
  summary: text("summary").notNull(),
  rationale: text("rationale").notNull(),
  payload: text("payload").notNull(),
  actorId: text("actor_id").notNull().references(() => riskshieldUsers.id),
  createdAt: text("created_at").notNull(),
});

export const riskshieldAuditLogs = sqliteTable(
  "riskshield_audit_logs",
  {
    id: text("id").primaryKey(),
    occurredAt: text("occurred_at").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    result: text("result").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    reason: text("reason"),
  },
  (table) => [
    index("riskshield_audit_occurred_idx").on(table.occurredAt),
    check("riskshield_audit_result_check", sql`${table.result} IN ('succeeded', 'denied', 'failed')`),
  ],
);

export const riskshieldPublicLimits = sqliteTable(
  "riskshield_public_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    day: text("day").notNull(),
    dayCount: integer("day_count").notNull().default(0),
    windowStartedAt: integer("window_started_at").notNull(),
    windowCount: integer("window_count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("riskshield_public_limits_updated_idx").on(table.updatedAt)],
);

export const riskshieldProviderBudgets = sqliteTable("riskshield_provider_budgets", {
  day: text("day").primaryKey(),
  callCount: integer("call_count").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const riskshieldAuditChain = sqliteTable(
  "riskshield_audit_chain",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    auditId: text("audit_id").notNull().unique().references(() => riskshieldAuditLogs.id),
    previousHash: text("previous_hash").notNull().unique(),
    entryHash: text("entry_hash").notNull().unique(),
    createdAt: text("created_at").notNull(),
  },
);
