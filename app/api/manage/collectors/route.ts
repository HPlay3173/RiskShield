import { requireApiCapability } from "../../../../lib/auth/authorize";
import { controlJson } from "../../../../lib/http/control-response";
import { handleCollectorMutation } from "../../../../lib/collectors/control-api";

async function runtimeDb() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

export async function GET(request: Request) {
  const denied = await requireApiCapability(request, "dataset:manage");
  if (denied) return denied;
  const db = await runtimeDb();
  if (!db) return controlJson({ error: "collector_storage_unavailable" }, 503);
  const [sources, runs] = await Promise.all([
    db.prepare(`SELECT id, provider, label, query, endpoint, enabled, interval_minutes, last_run_at, last_status, last_message FROM riskshield_collector_sources_v2 ORDER BY enabled DESC, updated_at DESC`).all(),
    db.prepare(`SELECT id, source_id, status, fetched_count, new_count, candidate_count, message, started_at, finished_at FROM riskshield_collector_runs_v2 ORDER BY started_at DESC LIMIT 30`).all(),
  ]);
  return controlJson({ sources: sources.results ?? [], runs: runs.results ?? [] });
}

export async function POST(request: Request) {
  return handleCollectorMutation(request);
}
