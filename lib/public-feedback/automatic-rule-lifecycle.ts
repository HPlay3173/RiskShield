import type { CandidateRecord } from "../repositories/contracts";
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
import { chainedAuditStatements } from "../audit-chain.ts";
import type { RiskSkill } from "../riskshield";

const AUTOMATIC_SKILL_PREFIX = "risk_auto_verified_";

export function automaticRuleLineage(skillId: string) {
  if (!skillId.startsWith(AUTOMATIC_SKILL_PREFIX)) return null;
  const suffix = skillId.slice(AUTOMATIC_SKILL_PREFIX.length);
  if (!suffix) return null;
  return {
    candidateId: `public_verified_${suffix}`,
    intakeId: `public_intake_${suffix}`,
  };
}

export function automaticRuleCanBeCreated(existing: { review_status: string } | null) {
  return existing === null;
}

export async function automaticRuleActivationStatements(
  db: D1Database,
  skill: RiskSkill,
  now: string,
) {
  const actorId = "system:public-feedback-auto-verification";
  const reason = "LLM·검색 고신뢰 검증과 회귀 검사를 통과한 명백한 원자 유해 표현 자동 활성화";
  const afterJson = JSON.stringify(skill);
  const auditStatements = await chainedAuditStatements(db, {
    occurredAt: now,
    actorId,
    action: "skill.auto_activated",
    resourceType: "skill",
    resourceId: skill.id,
    result: "succeeded",
    afterJson,
    reason,
  });
  return [
    db.prepare(`INSERT INTO risk_skills
      (id, category, review_status, severity_floor, dominant_risk, payload, created_at, updated_at)
      VALUES (?, ?, 'reviewed', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`)
      .bind(skill.id, skill.category, skill.severityFloor, skill.dominantRisk ? 1 : 0, afterJson, now, now),
    ...auditStatements,
  ];
}

export async function reopenAutomaticRuleCandidateStatements(
  db: D1Database,
  skillId: string,
  now: string,
) {
  const lineage = automaticRuleLineage(skillId);
  if (!lineage) return [];
  const row = await db.prepare("SELECT payload FROM riskshield_candidates WHERE id = ? LIMIT 1")
    .bind(lineage.candidateId).first<{ payload: string }>();
  if (!row) return [];

  let payload: CandidateRecord;
  try {
    payload = JSON.parse(row.payload) as CandidateRecord;
  } catch {
    return [];
  }
  const pending: CandidateRecord = {
    ...payload,
    status: "pending",
    autoInclusionBlockedReason: "자동 규칙이 비활성화되어 사람 검토와 회귀 테스트가 필요합니다.",
  };
  return [
    db.prepare(`UPDATE riskshield_candidates
      SET status = 'pending', payload = ?, updated_at = ?
      WHERE id = ? AND status = 'approved'`)
      .bind(JSON.stringify(pending), now, lineage.candidateId),
  ];
}

export async function deactivateAutomaticRule(
  db: D1Database,
  input: {
    skillId: string;
    active: RiskSkill;
    actorId: string;
    now: string;
  },
) {
  const rejected: RiskSkill = {
    ...input.active,
    reviewStatus: "rejected",
    dominantRisk: false,
    updatedAt: input.now,
    recentContextTags: [...new Set([
      ...(input.active.recentContextTags ?? []),
      "auto_deactivated",
      "human_review_required",
    ])],
  };
  const candidateStatements = await reopenAutomaticRuleCandidateStatements(db, input.skillId, input.now);
  const auditStatements = await chainedAuditStatements(db, {
    occurredAt: input.now,
    actorId: input.actorId,
    action: "skill.auto_deactivate",
    resourceType: "skill",
    resourceId: input.skillId,
    result: "succeeded",
    beforeJson: JSON.stringify(input.active),
    afterJson: JSON.stringify(rejected),
    reason: "관리자가 자동 검증 규칙을 비활성화하고 연결된 후보를 사람 검토함으로 되돌렸습니다.",
  });
  const [result] = await db.batch([
    db.prepare(`UPDATE risk_skills
      SET review_status = 'rejected', dominant_risk = 0, payload = ?, updated_at = ?
      WHERE id = ? AND review_status = 'reviewed'`)
      .bind(JSON.stringify(rejected), input.now, input.skillId),
    ...candidateStatements,
    ...auditStatements,
  ]) as unknown as Array<{ meta: { changes?: number } }>;
  return {
    changed: Boolean(result?.meta.changes),
    candidateReopened: candidateStatements.length > 0,
    rejected,
  };
}
