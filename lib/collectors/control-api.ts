import { requireApiCapability } from "../auth/authorize";
import { requireMutationIntegrity } from "../auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject } from "../http/control-response";
import type { CollectorProvider } from "./runner";

const PROVIDERS = new Set<CollectorProvider>(["x", "threads", "dcinside"]);

export async function handleCollectorMutation(request: Request) {
  const denied = await requireApiCapability(request, "dataset:manage");
  if (denied) return denied;
  const invalid = await requireMutationIntegrity(request);
  if (invalid) return invalid;
  const body = await readJsonObject(request);
  if (body === JSON_BODY_TOO_LARGE) return controlJson({ error: "request_payload_too_large" }, 413);
  const provider = typeof body?.provider === "string" ? body.provider as CollectorProvider : "";
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) : "";
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 240) : "";
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim().slice(0, 500) : null;
  const intervalMinutes = Math.max(15, Math.min(10_080, Math.floor(Number(body?.intervalMinutes ?? 60))));
  const enabled = body?.enabled === true;
  if (!PROVIDERS.has(provider as CollectorProvider) || !label || !query) return controlJson({ error: "invalid_collector_source", message: "수집처, 이름, 검색어가 필요합니다." }, 400);
  if (provider === "dcinside") {
    try { const url = new URL(endpoint ?? ""); if (!/(^|\.)dcinside\.com$/iu.test(url.hostname)) throw new Error("invalid"); }
    catch { return controlJson({ error: "invalid_dcinside_endpoint", message: "디시인사이드 공개 피드 또는 검색 주소가 필요합니다." }, 400); }
  }
  const { env } = await import("cloudflare:workers");
  const db = env.DB;
  if (!db) return controlJson({ error: "collector_storage_unavailable" }, 503);
  const id = typeof body?.id === "string" && body.id.trim() ? body.id.trim().slice(0, 160) : `collector_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO riskshield_collector_sources (id, provider, label, query, endpoint, enabled, interval_minutes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, label = excluded.label, query = excluded.query,
      endpoint = excluded.endpoint, enabled = excluded.enabled, interval_minutes = excluded.interval_minutes, updated_at = excluded.updated_at
  `).bind(id, provider, label, query, endpoint, enabled ? 1 : 0, intervalMinutes, now, now).run();
  return controlJson({ acknowledged: true, id, enabled, message: enabled ? "예약 수집을 켰습니다." : "수집 설정을 저장했습니다." });
}
