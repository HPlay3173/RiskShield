import { requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject } from "../../../../../lib/http/control-response";

async function runtimeDb() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

async function authorize(request: Request) {
  return await requireApiCapability(request, "dataset:manage") ?? await requireMutationIntegrity(request);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await authorize(request);
  if (denied) return denied;
  const body = await readJsonObject(request);
  if (body === JSON_BODY_TOO_LARGE) return controlJson({ error: "request_payload_too_large" }, 413);
  if (typeof body?.enabled !== "boolean") return controlJson({ error: "invalid_collector_state", message: "수집 상태가 올바르지 않습니다." }, 400);
  const { id } = await context.params;
  const db = await runtimeDb();
  if (!db) return controlJson({ error: "collector_storage_unavailable" }, 503);
  const result = await db.prepare("UPDATE riskshield_collector_sources_v3 SET enabled = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL")
    .bind(body.enabled ? 1 : 0, new Date().toISOString(), id).run();
  if (!result.meta.changes) return controlJson({ error: "collector_source_not_found" }, 404);
  return controlJson({ acknowledged: true, id, enabled: body.enabled, message: body.enabled ? "예약 수집을 다시 켰습니다." : "예약 수집을 일시중지했습니다." });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await authorize(request);
  if (denied) return denied;
  const { id } = await context.params;
  const db = await runtimeDb();
  if (!db) return controlJson({ error: "collector_storage_unavailable" }, 503);
  const now = new Date().toISOString();
  const result = await db.prepare("UPDATE riskshield_collector_sources_v3 SET enabled = 0, archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL")
    .bind(now, now, id).run();
  if (!result.meta.changes) return controlJson({ error: "collector_source_not_found" }, 404);
  return controlJson({ acknowledged: true, id, archived: true, message: "수집 설정을 보관했습니다. 과거 근거와 실행 기록은 유지됩니다." });
}
