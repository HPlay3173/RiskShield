import { prepareInterpreterInput } from "../../../../lib/v0-4/interpreter";
import {
  INVALID_JSON_BODY,
  JSON_BODY_TOO_LARGE,
  readJsonValue,
} from "../../../../lib/http/control-response";
import { resolveActiveReviewedSkills } from "../../../../lib/active-skills";
import { analyzeText } from "../../../../lib/riskshield";
import {
  expressionAppearsInContext,
  normalizePublicFeedbackExpression,
} from "../../../../lib/public-feedback/intake";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_EXPRESSION_CHARS = 80;
const MAX_CONTEXT_CHARS = 2_000;
const WINDOW_MS = 60 * 60 * 1_000;
const SUBMISSION_LIMIT = 5;
const DAILY_SUBMISSION_LIMIT = 20;

const RETENTION_DAYS = 30;

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

async function requestKey(request: Request) {
  const address = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unavailable";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`riskshield:candidate:${address}`),
  );
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function enforceLimit(request: Request, db: D1Database) {
  const key = await requestKey(request);
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const bucket = await db.prepare(`
    INSERT INTO riskshield_public_limits
      (bucket_key, day, day_count, window_started_at, window_count, updated_at)
    VALUES (?, ?, 1, ?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      day = excluded.day,
      day_count = CASE WHEN riskshield_public_limits.day = excluded.day THEN riskshield_public_limits.day_count + 1 ELSE 1 END,
      window_started_at = CASE
        WHEN riskshield_public_limits.day <> excluded.day
          OR excluded.window_started_at - riskshield_public_limits.window_started_at >= ?
        THEN excluded.window_started_at ELSE riskshield_public_limits.window_started_at END,
      window_count = CASE
        WHEN riskshield_public_limits.day <> excluded.day
          OR excluded.window_started_at - riskshield_public_limits.window_started_at >= ?
        THEN 1 ELSE riskshield_public_limits.window_count + 1 END,
      updated_at = excluded.updated_at
    RETURNING day_count, window_started_at, window_count
  `).bind(key, day, now, new Date(now).toISOString(), WINDOW_MS, WINDOW_MS)
    .first<{ day_count: number; window_started_at: number; window_count: number }>();
  if (!bucket) return json({ error: "candidate_rate_limit_unavailable" }, 503);
  if (bucket.window_count > SUBMISSION_LIMIT || bucket.day_count > DAILY_SUBMISSION_LIMIT) {
    const retryAfter = bucket.window_count > SUBMISSION_LIMIT
      ? Math.max(1, Math.ceil((bucket.window_started_at + WINDOW_MS - now) / 1_000))
      : Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00.000Z`) + 86_400_000 - now) / 1_000));
    return json({ error: "candidate_rate_limited", message: "후보 제공 횟수를 초과했습니다." }, 429, {
      "retry-after": String(retryAfter),
    });
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ReportType = "missed_detection" | "false_positive" | "new_expression";

function reportTypeOf(value: unknown): ReportType {
  return value === "false_positive" || value === "new_expression" ? value : "missed_detection";
}

function stringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function compactExpression(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "");
}

function contextRuleCoversExpression(
  expression: string,
  matches: ReturnType<typeof analyzeText>["matches"],
) {
  const normalizedExpression = compactExpression(expression);
  if (!normalizedExpression) return false;
  return matches.some((match) => match.hits.some((hit) => {
    const normalizedHit = compactExpression(hit.text);
    return normalizedHit.includes(normalizedExpression) || normalizedExpression.includes(normalizedHit);
  }));
}

export async function POST(request: Request) {
  let db: D1Database;
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) return json({ error: "candidate_storage_unavailable" }, 503);
    db = env.DB;
  } catch {
    return json({ error: "candidate_storage_unavailable" }, 503);
  }
  const limited = await enforceLimit(request, db);
  if (limited) return limited;
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: "unsupported_media_type", message: "JSON 요청이 필요합니다." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "payload_too_large", message: "후보 문구가 너무 깁니다." }, 413);
  }

  const body = await readJsonValue(request, MAX_REQUEST_BYTES);
  if (body === JSON_BODY_TOO_LARGE) {
    return json({ error: "payload_too_large", message: "후보 문구가 너무 깁니다." }, 413);
  }
  if (body === INVALID_JSON_BODY) {
    return json({ error: "invalid_json", message: "올바른 JSON 요청이 필요합니다." }, 400);
  }
  if (!isRecord(body) || body.consent !== true || typeof body.text !== "string") {
    return json({ error: "explicit_consent_required", message: "후보 제공 동의가 필요합니다." }, 400);
  }
  const reportType = reportTypeOf(body.reportType);
  const context = body.text.trim();
  const expression = reportType === "false_positive"
    ? context.slice(0, MAX_EXPRESSION_CHARS)
    : typeof body.expression === "string" ? body.expression.trim() : "";
  if (!context || context.length > MAX_CONTEXT_CHARS) {
    return json({ error: "invalid_context", message: `신고 문맥은 ${MAX_CONTEXT_CHARS}자 이하여야 합니다.` }, 400);
  }
  if (!expression || expression.length > MAX_EXPRESSION_CHARS) {
    return json({ error: "invalid_expression", message: `놓친 표현을 ${MAX_EXPRESSION_CHARS}자 이하로 따로 입력해 주세요.` }, 400);
  }
  if (reportType !== "false_positive" && !expressionAppearsInContext(expression, context)) {
    return json({ error: "expression_not_found_in_context", message: "놓친 표현이 신고 문맥 안에 포함되어야 합니다." }, 400);
  }
  const preparedContext = prepareInterpreterInput(context, MAX_CONTEXT_CHARS);
  const preparedExpression = prepareInterpreterInput(expression, MAX_EXPRESSION_CHARS);
  if (preparedContext.masked || preparedExpression.masked) {
    return json({ error: "personal_data_detected", message: "개인정보가 포함된 문구는 학습 후보로 제공할 수 없습니다." }, 400);
  }

  const normalizedExpression = normalizePublicFeedbackExpression(expression);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${reportType}:${normalizedExpression}`));
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  const id = `public_intake_${hash.slice(0, 32)}`;
  const now = new Date().toISOString();
  const retentionDeadline = new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString();
  try {
    await db.prepare(
      "DELETE FROM riskshield_candidates WHERE id LIKE 'public_verified_%' AND retention_deadline IS NOT NULL AND retention_deadline <= ?",
    ).bind(now).run();
    await db.prepare(
      "DELETE FROM riskshield_public_feedback_intakes WHERE retention_deadline <= ?",
    ).bind(now).run();
    const reviewedRows = await db.prepare(
      "SELECT id, review_status, payload FROM risk_skills WHERE review_status = 'reviewed' ORDER BY updated_at DESC",
    ).all<{ id: string; review_status: string; payload: string }>();
    const reviewedSkills = resolveActiveReviewedSkills(reviewedRows.results ?? []);
    const contextRuleResult = analyzeText(context, reviewedSkills);
    const existingExpressionResult = analyzeText(expression, reviewedSkills);
    if (
      existingExpressionResult.matches.length > 0
      && contextRuleCoversExpression(expression, contextRuleResult.matches)
      && reportType !== "false_positive"
    ) {
      return json({ error: "known_expression", message: "이미 검토된 규칙과 일치하는 문구는 신규 후보로 저장하지 않습니다." }, 409);
    }

    const reporterFingerprint = await requestKey(request);
    const existing = await db.prepare(`SELECT status, contexts_json, reporter_fingerprints_json, submission_count,
      candidate_id, rule_feedback_case_id, next_check_at FROM riskshield_public_feedback_intakes
      WHERE normalized_expression = ? AND report_type = ? LIMIT 1`)
      .bind(normalizedExpression, reportType).first<{
        status: "received" | "verifying" | "monitor" | "rejected" | "promoted" | "verification_error";
        contexts_json: string; reporter_fingerprints_json: string; submission_count: number;
        candidate_id: string | null; rule_feedback_case_id: string | null; next_check_at: string | null;
      }>();
    const contexts = [...new Set([...stringArray(existing?.contexts_json), context])].slice(-5);
    const reporters = [...new Set([...stringArray(existing?.reporter_fingerprints_json), reporterFingerprint])].slice(-20);
    const submissionCount = (existing?.submission_count ?? 0) + 1;
    await db.prepare(`INSERT INTO riskshield_public_feedback_intakes
      (id, normalized_expression, expression, report_type, status, contexts_json, reporter_fingerprints_json,
       submission_count, retention_deadline, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'received', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_expression, report_type) DO UPDATE SET
        expression = excluded.expression, contexts_json = excluded.contexts_json,
        reporter_fingerprints_json = excluded.reporter_fingerprints_json,
        submission_count = excluded.submission_count, retention_deadline = excluded.retention_deadline,
        updated_at = excluded.updated_at`)
      .bind(id, normalizedExpression, expression, reportType, JSON.stringify(contexts), JSON.stringify(reporters),
        submissionCount, retentionDeadline, now, now).run();

    if (existing?.status === "promoted") {
      return json({ acknowledged: true, intakeStatus: "promoted", candidateId: existing.candidate_id, ruleFeedbackCaseId: existing.rule_feedback_case_id, reviewRequired: true });
    }
    if ((existing?.status === "monitor" || existing?.status === "rejected" || existing?.status === "verification_error")
      && existing.next_check_at && Date.parse(existing.next_check_at) > Date.now()) {
      return json({ acknowledged: true, intakeStatus: existing.status, reviewRequired: false });
    }

    if (reportType === "false_positive") {
      const skillIds = [...new Set(contextRuleResult.matches.map((match) => match.skill.id))];
      if (!skillIds.length) {
        await db.prepare("UPDATE riskshield_public_feedback_intakes SET status = 'rejected', last_error = 'no_detected_rule', updated_at = ? WHERE id = ?")
          .bind(now, id).run();
        return json({ acknowledged: true, intakeStatus: "rejected", reviewRequired: false });
      }
      const caseId = `rule_feedback_${hash.slice(0, 32)}`;
      const evaluationCaseId = `evaluation_false_positive_${hash.slice(0, 24)}`;
      await db.batch([
        db.prepare(`INSERT INTO riskshield_rule_feedback_cases
          (id, intake_id, evaluation_case_id, text, skill_ids_json, expected_risk, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, 'pending_review', ?, ?)
          ON CONFLICT(intake_id) DO UPDATE SET evaluation_case_id = excluded.evaluation_case_id,
            text = excluded.text, skill_ids_json = excluded.skill_ids_json, updated_at = excluded.updated_at`)
          .bind(caseId, id, evaluationCaseId, context, JSON.stringify(skillIds), now, now),
        db.prepare(`INSERT INTO riskshield_evaluation_cases
          (id, text, expected_risk, expected_family, context, enabled, created_at, updated_at)
          VALUES (?, ?, 0, NULL, 'public_false_positive', 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`)
          .bind(evaluationCaseId, context, now, now),
        db.prepare(`UPDATE riskshield_public_feedback_intakes SET status = 'promoted', rule_feedback_case_id = ?,
          qualification_json = NULL, search_verification_json = NULL, last_error = NULL, next_check_at = NULL, updated_at = ? WHERE id = ?`)
          .bind(caseId, now, id),
      ]);
      return json({ acknowledged: true, intakeStatus: "promoted", ruleFeedbackCaseId: caseId, reviewRequired: true, feedbackKind: "negative_regression" });
    }

    await db.prepare(`UPDATE riskshield_public_feedback_intakes
      SET status = 'received', last_error = NULL, next_check_at = NULL, updated_at = ?
      WHERE id = ? AND status <> 'promoted'`).bind(now, id).run();
    return json({
      acknowledged: true,
      intakeId: id,
      intakeStatus: "received",
      reviewRequired: false,
      message: "신고가 접수되었습니다. 의미와 실제 사용 사례를 자동으로 확인한 뒤, 근거가 충분한 경우에만 관리자 검토함으로 전달됩니다.",
    }, 202);
  } catch {
    return json({ error: "candidate_storage_unavailable", message: "신고를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 503);
  }
}
