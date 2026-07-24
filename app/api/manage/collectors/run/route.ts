import { requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject } from "../../../../../lib/http/control-response";
import { readCollectorSource, runCollectorSource, type CollectorEnvironment } from "../../../../../lib/collectors/runner";

export async function POST(request: Request) {
  const denied = await requireApiCapability(request, "dataset:manage");
  if (denied) return denied;
  const invalid = await requireMutationIntegrity(request);
  if (invalid) return invalid;
  const body = await readJsonObject(request);
  if (body === JSON_BODY_TOO_LARGE) return controlJson({ error: "request_payload_too_large" }, 413);
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId.trim() : "";
  if (!sourceId) return controlJson({ error: "source_id_required" }, 400);
  const { env } = await import("cloudflare:workers");
  if (!env.DB) return controlJson({ error: "collector_storage_unavailable" }, 503);
  const source = await readCollectorSource(env.DB, sourceId);
  if (!source) return controlJson({ error: "collector_source_not_found" }, 404);
  const result = await runCollectorSource(source, env as unknown as CollectorEnvironment);
  return controlJson(result, result.status === "succeeded" ? 200 : 502);
}
