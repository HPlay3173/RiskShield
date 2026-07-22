import { requireApiCapability } from "../../../../lib/auth/authorize";
import { controlJson } from "../../../../lib/http/control-response";
import { handleEvaluationMutation } from "../../../../lib/evaluation/control-api";

async function runtimeDb() { const { env } = await import("cloudflare:workers"); return env.DB; }

export async function GET(request: Request) {
  const denied = await requireApiCapability(request, "evaluation:run");
  if (denied) return denied;
  const db = await runtimeDb();
  if (!db) return controlJson({ error: "evaluation_storage_unavailable" }, 503);
  const [cases, runs, active, policies] = await Promise.all([
    db.prepare(`SELECT id, text, expected_risk, expected_family, context, enabled, created_at FROM riskshield_evaluation_cases ORDER BY created_at DESC LIMIT 500`).all(),
    db.prepare(`SELECT id, status, case_count, metrics_json, calibration_json, source_commit, scoring_policy, created_at FROM riskshield_evaluation_runs ORDER BY created_at DESC LIMIT 30`).all(),
    db.prepare(`SELECT id, evaluation_run_id, mapping_json, sample_count, activated_at FROM riskshield_calibration_policies WHERE active = 1 ORDER BY activated_at DESC LIMIT 1`).first(),
    db.prepare(`SELECT id, evaluation_run_id, sample_count, active, activated_at, created_at FROM riskshield_calibration_policies ORDER BY created_at DESC LIMIT 30`).all(),
  ]);
  return controlJson({ cases: cases.results ?? [], runs: (runs.results ?? []).map((run) => ({ ...run, metrics: JSON.parse(String(run.metrics_json)), calibration: run.calibration_json ? JSON.parse(String(run.calibration_json)) : null })), activeCalibration: active, policies: policies.results ?? [] });
}

export async function POST(request: Request) { return handleEvaluationMutation(request); }
