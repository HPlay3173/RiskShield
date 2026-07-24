import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { chainedAuditStatements } from "../../../../../lib/audit-chain";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject } from "../../../../../lib/http/control-response";
import { D1SkillRepository } from "../../../../../lib/repositories/d1";
import { validateManagedSkill, type RiskSkill } from "../../../../../lib/riskshield";
import { runSkillActivationRegression } from "../../../../../lib/skill-activation";

export async function POST(request: Request) {
  const denied = await requireApiCapability(request, "skill:propose_revision");
  if (denied) return denied;
  const integrityFailure = await requireMutationIntegrity(request);
  if (integrityFailure) return integrityFailure;
  const principal = await principalFromRequest(request);
  if (!principal) return controlJson({ error: "authentication_required" }, 401);
  const body = await readJsonObject(request);
  if (body === JSON_BODY_TOO_LARGE) return controlJson({ error: "request_payload_too_large" }, 413);
  const skillId = typeof body?.skillId === "string" ? body.skillId.trim().slice(0, 200) : "";
  if (!skillId) return controlJson({ error: "skill_id_required", message: "활성화할 스킬 ID가 필요합니다." }, 400);

  let db: D1Database;
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) return controlJson({ error: "skill_storage_unavailable" }, 503);
    db = env.DB;
  } catch {
    return controlJson({ error: "skill_storage_unavailable" }, 503);
  }

  const row = await db.prepare("SELECT review_status, payload FROM risk_skills WHERE id = ? LIMIT 1")
    .bind(skillId).first<{ review_status: string; payload: string }>();
  if (!row) return controlJson({ error: "skill_not_found", message: "스킬을 찾을 수 없습니다." }, 404);

  let draft: RiskSkill;
  try {
    draft = JSON.parse(row.payload) as RiskSkill;
  } catch {
    return controlJson({ error: "invalid_skill_payload", message: "스킬 payload를 읽을 수 없습니다." }, 409);
  }
  const now = new Date().toISOString();
  if (row.review_status === "reviewed") {
    const tags = draft.recentContextTags ?? [];
    const isPendingAutomaticReview = tags.includes("auto_verified") && tags.includes("human_review_pending");
    if (!isPendingAutomaticReview) {
      return controlJson({ acknowledged: true, skillId, alreadyActive: true, message: "이미 분석 규칙으로 활성화되어 있습니다." });
    }

    const issues = validateManagedSkill(draft);
    if (issues.length) return controlJson({ error: "skill_validation_failed", message: issues[0], issues }, 409);
    const activeSkillsResult = await new D1SkillRepository(db).listReviewed();
    if (activeSkillsResult.status !== "ready") {
      return controlJson({ error: "active_skills_unavailable", message: "기존 활성 규칙을 불러오지 못해 사람 검토 완료 처리를 중단했습니다." }, 503);
    }
    const regression = runSkillActivationRegression(draft, activeSkillsResult.data);
    if (!regression.passed) {
      return controlJson({
        error: "skill_regression_failed",
        message: `회귀 테스트 ${regression.passedCount}/${regression.totalCount}개만 통과해 사람 검토를 완료하지 않았습니다.`,
        checks: regression.checks,
        evaluatedSkillCount: regression.evaluatedSkillCount,
      }, 409);
    }

    const confirmed: RiskSkill = {
      ...draft,
      updatedAt: now,
      recentContextTags: [...new Set([
        ...tags.filter((tag) => tag !== "human_review_pending" && tag !== "human_review_required"),
        "human_reviewed",
      ])],
    };
    const auditStatements = await chainedAuditStatements(db, {
      occurredAt: now,
      actorId: principal.userId,
      action: "skill.auto_review_confirm",
      resourceType: "skill",
      resourceId: skillId,
      result: "succeeded",
      beforeJson: JSON.stringify(draft),
      afterJson: JSON.stringify(confirmed),
      reason: `회귀 테스트 ${regression.passedCount}/${regression.totalCount} 재확인 후 사람 검토 완료`,
    });
    const [result] = await db.batch([
      db.prepare(`UPDATE risk_skills SET payload = ?, updated_at = ?
        WHERE id = ? AND review_status = 'reviewed'`)
        .bind(JSON.stringify(confirmed), now, skillId),
      ...auditStatements,
    ]) as unknown as Array<{ meta: { changes?: number } }>;
    if (!result.meta.changes) return controlJson({ error: "skill_review_conflict", message: "다른 변경과 충돌해 사람 검토를 완료하지 못했습니다." }, 409);

    return controlJson({
      acknowledged: true,
      skillId,
      alreadyActive: true,
      humanReviewConfirmed: true,
      checks: regression.checks,
      evaluatedSkillCount: regression.evaluatedSkillCount,
      message: `회귀 테스트 ${regression.passedCount}/${regression.totalCount}개를 다시 확인하고 사람 검토를 완료했습니다.`,
    });
  }

  const reviewed: RiskSkill = { ...draft, reviewStatus: "reviewed", updatedAt: now };
  const issues = validateManagedSkill(reviewed);
  if (issues.length) return controlJson({ error: "skill_validation_failed", message: issues[0], issues }, 409);

  const activeSkillsResult = await new D1SkillRepository(db).listReviewed();
  if (activeSkillsResult.status !== "ready") {
    return controlJson({
      error: "active_skills_unavailable",
      message: "기존 활성 규칙을 불러오지 못해 활성화를 중단했습니다.",
    }, 503);
  }
  const regression = runSkillActivationRegression(reviewed, activeSkillsResult.data);
  if (!regression.passed) {
    return controlJson({
      error: "skill_regression_failed",
      message: `회귀 테스트 ${regression.passedCount}/${regression.totalCount}개만 통과해 활성화하지 않았습니다.`,
      checks: regression.checks,
      evaluatedSkillCount: regression.evaluatedSkillCount,
    }, 409);
  }

  const auditStatements = await chainedAuditStatements(db, {
    occurredAt: now,
    actorId: principal.userId,
    action: "skill.activate",
    resourceType: "skill",
    resourceId: skillId,
    result: "succeeded",
    beforeJson: JSON.stringify(draft),
    afterJson: JSON.stringify(reviewed),
    reason: `회귀 테스트 ${regression.passedCount}/${regression.totalCount} 통과`,
  });
  const [result] = await db.batch([
    db.prepare(`UPDATE risk_skills
      SET review_status = 'reviewed', category = ?, severity_floor = ?, dominant_risk = ?, payload = ?, updated_at = ?
      WHERE id = ? AND review_status = 'draft'`)
      .bind(reviewed.category, reviewed.severityFloor, reviewed.dominantRisk ? 1 : 0, JSON.stringify(reviewed), now, skillId),
    ...auditStatements,
  ]) as unknown as Array<{ meta: { changes?: number } }>;
  if (!result.meta.changes) return controlJson({ error: "skill_activation_conflict", message: "다른 변경과 충돌해 활성화하지 못했습니다." }, 409);

  return controlJson({
    acknowledged: true,
    skillId,
    alreadyActive: false,
    checks: regression.checks,
    evaluatedSkillCount: regression.evaluatedSkillCount,
    message: `회귀 테스트 ${regression.passedCount}/${regression.totalCount}개를 통과해 Analyzer의 활성 규칙으로 반영했습니다.`,
  });
}
