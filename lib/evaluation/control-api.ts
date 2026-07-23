import { requireApiCapability } from "../auth/authorize";
import { requireMutationIntegrity } from "../auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject } from "../http/control-response";
import { resolveActiveReviewedSkills } from "../active-skills";
import { analyzeText } from "../riskshield";
import { PRODUCT_VERSION, SOURCE_COMMIT } from "../release";
import { aggregateDocumentScore, scoreClaim, segmentClaims } from "../v0-5/document-scoring";
import { fitIsotonicCalibration, measureScores, type LabeledScore } from "./calibration";
import { evaluationEnabledForRuleFeedback } from "./rule-feedback";

export async function handleEvaluationMutation(request: Request) {
  const denied = await requireApiCapability(request, "evaluation:run");
  if (denied) return denied;
  const invalid = await requireMutationIntegrity(request);
  if (invalid) return invalid;
  const body = await readJsonObject(request);
  if (body === JSON_BODY_TOO_LARGE) return controlJson({ error: "request_payload_too_large" }, 413);
  const action = typeof body?.action === "string" ? body.action : "";
  const { env } = await import("cloudflare:workers");
  const db = env.DB;
  if (!db) return controlJson({ error: "evaluation_storage_unavailable" }, 503);
  if (action === "add_case") {
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 2_000) : "";
    const expectedRisk = body?.expectedRisk === true;
    const expectedFamily = typeof body?.expectedFamily === "string" && body.expectedFamily ? body.expectedFamily.slice(0, 80) : null;
    const context = typeof body?.context === "string" && body.context ? body.context.slice(0, 80) : "general";
    if (!text) return controlJson({ error: "evaluation_text_required" }, 400);
    const id = `eval_case_${crypto.randomUUID()}`; const now = new Date().toISOString();
    await db.prepare(`INSERT INTO riskshield_evaluation_cases (id, text, expected_risk, expected_family, context, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind(id, text, expectedRisk ? 1 : 0, expectedFamily, context, now, now).run();
    return controlJson({ acknowledged: true, id });
  }
  if (action === "review_false_positive") {
    const id = typeof body?.id === "string" ? body.id : "";
    const decision = body?.decision === "approve" || body?.decision === "reject" ? body.decision : null;
    if (!id || !decision) return controlJson({ error: "invalid_rule_feedback_decision" }, 400);
    const feedback = await db.prepare(`SELECT id, evaluation_case_id, status FROM riskshield_rule_feedback_cases WHERE id = ? LIMIT 1`)
      .bind(id).first<{ id: string; evaluation_case_id: string | null; status: string }>();
    if (!feedback) return controlJson({ error: "rule_feedback_not_found" }, 404);
    if (feedback.status !== "pending_review") return controlJson({ error: "rule_feedback_already_decided" }, 409);
    const now = new Date().toISOString();
    const status = decision === "approve" ? "accepted" : "rejected";
    const statements = [
      db.prepare("UPDATE riskshield_rule_feedback_cases SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending_review'")
        .bind(status, now, id),
    ];
    if (feedback.evaluation_case_id) {
      statements.push(db.prepare("UPDATE riskshield_evaluation_cases SET enabled = ?, updated_at = ? WHERE id = ?")
        .bind(evaluationEnabledForRuleFeedback(decision), now, feedback.evaluation_case_id));
    }
    await db.batch(statements);
    return controlJson({ acknowledged: true, id, status, evaluationEnabled: decision === "approve" });
  }
  if (action !== "run") return controlJson({ error: "unsupported_evaluation_action" }, 400);
  const [caseRows, skillRows] = await Promise.all([
    db.prepare(`SELECT id, text, expected_risk, expected_family, context FROM riskshield_evaluation_cases WHERE enabled = 1 ORDER BY id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, review_status, payload FROM risk_skills WHERE review_status = 'reviewed' ORDER BY updated_at DESC`).all<{ id: string; review_status: string; payload: string }>(),
  ]);
  const cases = caseRows.results ?? [];
  if (!cases.length) return controlJson({ error: "evaluation_cases_required", message: "라벨이 붙은 평가 사례를 먼저 추가해 주세요." }, 409);
  const skills = resolveActiveReviewedSkills(skillRows.results ?? []);
  const scores: LabeledScore[] = [];
  const results = cases.map((item) => {
    const input = String(item.text);
    const claims = segmentClaims(input).map((segment) => scoreClaim(segment, analyzeText(segment.text, skills), null));
    const scoring = aggregateDocumentScore(claims);
    const expectedRisk = Boolean(item.expected_risk);
    scores.push({ id: String(item.id), rawScore: scoring.finalScore, expectedRisk });
    const expectedFamily = typeof item.expected_family === "string" ? item.expected_family : null;
    return {
      id: String(item.id), text: input, context: String(item.context), expectedRisk, expectedFamily,
      rawScore: scoring.finalScore, status: scoring.status, predictedFamily: scoring.primaryCategory?.id ?? null,
      riskCorrect: (scoring.finalScore >= 70) === expectedRisk,
      familyCorrect: expectedFamily ? scoring.primaryCategory?.id === expectedFamily : null,
    };
  });
  const metrics = measureScores(scores);
  const positiveCount = scores.filter((item) => item.expectedRisk).length;
  const negativeCount = scores.length - positiveCount;
  const eligible = scores.length >= 20 && positiveCount >= 5 && negativeCount >= 5;
  const mapping = eligible ? fitIsotonicCalibration(scores) : null;
  const runId = `evaluation_run_${crypto.randomUUID()}`; const now = new Date().toISOString();
  const calibration = { eligible, reason: eligible ? "라벨 분포와 최소 표본 기준을 통과했습니다." : "최소 20개, 위험·비위험 각 5개 사례가 필요합니다.", mapping };
  await db.prepare(`INSERT INTO riskshield_evaluation_runs (id, status, case_count, metrics_json, results_json, calibration_json, source_commit, scoring_policy, created_at) VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(runId, scores.length, JSON.stringify(metrics), JSON.stringify(results), JSON.stringify(calibration), SOURCE_COMMIT, "4.0.0", now).run();
  if (eligible && mapping) {
    await db.prepare(`INSERT INTO riskshield_calibration_policies (id, evaluation_run_id, mapping_json, sample_count, active, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
      .bind(`calibration_${crypto.randomUUID()}`, runId, JSON.stringify(mapping), scores.length, now).run();
  }
  return controlJson({ runId, productVersion: PRODUCT_VERSION, caseCount: scores.length, metrics, results, calibration });
}
