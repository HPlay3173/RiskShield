import { requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject } from "../../../../../lib/http/control-response";

export async function POST(request: Request) {
  const denied = await requireApiCapability(request, "evaluation:run");
  if (denied) return denied;
  const invalid = await requireMutationIntegrity(request);
  if (invalid) return invalid;
  const body = await readJsonObject(request);
  if (body === JSON_BODY_TOO_LARGE) return controlJson({ error: "request_payload_too_large" }, 413);
  const policyId = typeof body?.policyId === "string" ? body.policyId.trim() : "";
  if (!policyId) return controlJson({ error: "calibration_policy_required" }, 400);
  const { env } = await import("cloudflare:workers");
  if (!env.DB) return controlJson({ error: "evaluation_storage_unavailable" }, 503);
  const policy = await env.DB.prepare(`SELECT id, sample_count FROM riskshield_calibration_policies WHERE id = ? LIMIT 1`).bind(policyId).first<{ id: string; sample_count: number }>();
  if (!policy || policy.sample_count < 20) return controlJson({ error: "calibration_policy_ineligible", message: "최소 표본 기준을 통과한 보정 정책만 활성화할 수 있습니다." }, 409);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE riskshield_calibration_policies SET active = 0 WHERE active = 1`),
    env.DB.prepare(`UPDATE riskshield_calibration_policies SET active = 1, activated_at = ? WHERE id = ?`).bind(now, policyId),
  ]);
  return controlJson({ acknowledged: true, policyId, activatedAt: now });
}
