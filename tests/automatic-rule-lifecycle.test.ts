import assert from "node:assert/strict";
import test from "node:test";

import {
  automaticRuleCanBeCreated,
  automaticRuleActivationStatements,
  automaticRuleLineage,
  deactivateAutomaticRule,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/public-feedback/automatic-rule-lifecycle.ts";
import {
  starterSkills,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";

type StoredState = {
  skillStatus: string;
  candidateStatus: string;
  candidatePayload: string;
  auditActions: string[];
  chainCount: number;
};

function statefulD1(state: StoredState) {
  return {
    prepare(sql: string) {
      let values: readonly unknown[] = [];
      const statement = {
        bind(...next: unknown[]) {
          values = next;
          return statement;
        },
        async first<T>() {
          if (sql.includes("FROM riskshield_candidates")) {
            return { payload: state.candidatePayload } as T;
          }
          if (sql.includes("FROM riskshield_audit_chain")) return null;
          return null;
        },
        async run<T>() {
          let changes = 1;
          if (sql.includes("UPDATE risk_skills")) state.skillStatus = "rejected";
          if (sql.includes("UPDATE riskshield_candidates")) {
            state.candidateStatus = "pending";
            state.candidatePayload = String(values[0]);
          }
          if (sql.includes("INSERT INTO risk_skills")) state.skillStatus = "reviewed";
          if (sql.includes("INSERT INTO riskshield_audit_logs")) state.auditActions.push(String(values[3]));
          if (sql.includes("INSERT INTO riskshield_audit_chain")) state.chainCount += 1;
          if (sql.includes("WHERE id = ? AND status = 'approved'") && state.candidateStatus !== "pending") changes = 0;
          return { results: [] as T[], success: true, meta: { changes } };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run<T>(): Promise<{ results: T[]; success: boolean; meta: { changes: number } }> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
}

function automaticSkill() {
  const base = starterSkills.find((skill) => skill.id === "risk_coded_000001");
  assert.ok(base);
  return {
    ...base,
    id: "risk_auto_verified_deadbeef",
    dominantRisk: false,
    recentContextTags: ["public_feedback", "auto_verified", "human_review_pending"],
  };
}

test("automatic rule ids map back to their intake and review candidate", () => {
  assert.deepEqual(automaticRuleLineage("risk_auto_verified_deadbeef"), {
    candidateId: "public_verified_deadbeef",
    intakeId: "public_intake_deadbeef",
  });
  assert.equal(automaticRuleLineage("risk_coded_000001"), null);
  assert.equal(automaticRuleCanBeCreated(null), true);
  assert.equal(automaticRuleCanBeCreated({ review_status: "rejected" }), false);
});

test("deactivating an automatic rule reopens its candidate and appends the chained audit", async () => {
  const state: StoredState = {
    skillStatus: "reviewed",
    candidateStatus: "approved",
    candidatePayload: JSON.stringify({ id: "public_verified_deadbeef", status: "approved" }),
    auditActions: [],
    chainCount: 0,
  };
  const result = await deactivateAutomaticRule(statefulD1(state), {
    skillId: "risk_auto_verified_deadbeef",
    active: automaticSkill(),
    actorId: "reviewer@example.com",
    now: "2026-07-24T00:00:00.000Z",
  });

  assert.equal(result.changed, true);
  assert.equal(result.candidateReopened, true);
  assert.equal(state.skillStatus, "rejected");
  assert.equal(state.candidateStatus, "pending");
  assert.equal(JSON.parse(state.candidatePayload).status, "pending");
  assert.match(JSON.parse(state.candidatePayload).autoInclusionBlockedReason, /사람 검토/u);
  assert.deepEqual(state.auditActions, ["skill.auto_deactivate"]);
  assert.equal(state.chainCount, 1);
});

test("automatic activation writes the rule and its audit-chain entry together", async () => {
  const state: StoredState = {
    skillStatus: "missing",
    candidateStatus: "pending",
    candidatePayload: "{}",
    auditActions: [],
    chainCount: 0,
  };
  const db = statefulD1(state);
  const statements = await automaticRuleActivationStatements(db, automaticSkill(), "2026-07-24T00:00:00.000Z");
  await db.batch(statements);

  assert.equal(state.skillStatus, "reviewed");
  assert.deepEqual(state.auditActions, ["skill.auto_activated"]);
  assert.equal(state.chainCount, 1);
});
