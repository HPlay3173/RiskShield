import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject } from "../../../../../lib/http/control-response";
import type { RiskSkill } from "../../../../../lib/riskshield";

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
  if (!skillId) return controlJson({ error: "skill_id_required", message: "비활성화할 규칙 ID가 필요합니다." }, 400);

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
  if (!row) return controlJson({ error: "skill_not_found", message: "규칙을 찾을 수 없습니다." }, 404);

  let active: RiskSkill;
  try {
    active = JSON.parse(row.payload) as RiskSkill;
  } catch {
    return controlJson({ error: "invalid_skill_payload", message: "규칙 payload를 읽을 수 없습니다." }, 409);
  }
  if (!active.recentContextTags?.includes("auto_verified")) {
    return controlJson({ error: "manual_skill_requires_revision", message: "자동 검증 규칙만 여기서 즉시 비활성화할 수 있습니다." }, 409);
  }
  if (row.review_status !== "reviewed") {
    return controlJson({ acknowledged: true, skillId, alreadyInactive: true, message: "이미 비활성 상태입니다." });
  }

  const now = new Date().toISOString();
  const rejected: RiskSkill = {
    ...active,
    reviewStatus: "rejected",
    dominantRisk: false,
    updatedAt: now,
    recentContextTags: [...new Set([...active.recentContextTags, "auto_deactivated", "human_review_required"])],
  };
  const result = await db.prepare(`UPDATE risk_skills
    SET review_status = 'rejected', dominant_risk = 0, payload = ?, updated_at = ?
    WHERE id = ? AND review_status = 'reviewed'`)
    .bind(JSON.stringify(rejected), now, skillId).run();
  if (!result.meta.changes) return controlJson({ error: "skill_deactivation_conflict", message: "다른 변경과 충돌해 비활성화하지 못했습니다." }, 409);

  await db.prepare(`INSERT INTO riskshield_audit_logs
    (id, occurred_at, actor_id, action, resource_type, resource_id, result, before_json, after_json, reason)
    VALUES (?, ?, ?, 'skill.auto_deactivate', 'skill', ?, 'succeeded', ?, ?, ?)`)
    .bind(crypto.randomUUID(), now, principal.userId, skillId, JSON.stringify(active), JSON.stringify(rejected), "관리자가 자동 검증 규칙을 즉시 비활성화했습니다.").run();

  return controlJson({
    acknowledged: true,
    skillId,
    alreadyInactive: false,
    message: "자동 검증 규칙을 비활성화했습니다. 공개 분석기에 더 이상 적용되지 않습니다.",
  });
}
