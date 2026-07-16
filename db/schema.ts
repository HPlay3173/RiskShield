import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
      sql`${table.reviewStatus} IN ('draft', 'reviewed')`,
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
