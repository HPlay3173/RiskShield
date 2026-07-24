import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject } from "../../../../../lib/http/control-response";
import { deactivateAutomaticRule } from "../../../../../lib/public-feedback/automatic-rule-lifecycle";
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
  const result = await deactivateAutomaticRule(db, {
    skillId,
    active,
    actorId: principal.userId,
    now,
  });
  if (!result.changed) return controlJson({ error: "skill_deactivation_conflict", message: "다른 변경과 충돌해 비활성화하지 못했습니다." }, 409);

  return controlJson({
    acknowledged: true,
    skillId,
    alreadyInactive: false,
    message: "자동 검증 규칙을 비활성화하고 사람 검토함으로 되돌렸습니다. 공개 분석기에 더 이상 적용되지 않습니다.",
  });
}
