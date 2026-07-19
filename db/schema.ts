import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
