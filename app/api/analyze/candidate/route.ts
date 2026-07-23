import { prepareInterpreterInput } from "../../../../lib/v0-4/interpreter";
import {
  INVALID_JSON_BODY,
  JSON_BODY_TOO_LARGE,
  readJsonValue,
} from "../../../../lib/http/control-response";
import type { CandidateRecord } from "../../../../lib/repositories/contracts";
import { resolveActiveReviewedSkills } from "../../../../lib/active-skills";
import { analyzeText } from "../../../../lib/riskshield";
import { GoogleCollectorQualificationProvider } from "../../../../lib/collectors/google-qualification-provider";
import { GoogleCollectorSearchVerificationProvider } from "../../../../lib/collectors/google-search-verification-provider";
import {
  expressionAppearsInContext,
  normalizePublicFeedbackExpression,
  PUBLIC_FEEDBACK_GATE_VERSION,
  verifiedContextTests,
  verifyPublicFeedbackExpression,
} from "../../../../lib/public-feedback/intake";
import type { ScorableRiskFamily } from "../../../../lib/risk-family";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_EXPRESSION_CHARS = 80;
const MAX_CONTEXT_CHARS = 2_000;
const WINDOW_MS = 60 * 60 * 1_000;
const SUBMISSION_LIMIT = 5;
const DAILY_SUBMISSION_LIMIT = 20;

const CONSENT_POLICY_VERSION = "public-candidate-2026-07-21";
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

function riskFamily(value: string): ScorableRiskFamily {
  return value === "hate_discrimination" || value === "abusive_language" || value === "coded_expression" || value === "violent_threat"
    ? value
    : "general_substantiation";
}

function riskDomain(value: string) {
  return value === "hate_discrimination" ? "혐오·차별 표현"
    : value === "abusive_language" ? "욕설·공격 표현"
      : value === "coded_expression" ? "숨은 은어·코드 표현"
        : value === "violent_threat" ? "폭력·위협 표현"
          : "과장·기만 표현";
}

function severityFloor(value: string) {
  return value === "violent_threat" ? 80
    : value === "hate_discrimination" ? 75
      : value === "abusive_language" ? 68
        : value === "coded_expression" ? 65
          : 60;
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
    if (existingExpressionResult.matches.length > 0 && reportType !== "false_positive") {
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

    await db.prepare("UPDATE riskshield_public_feedback_intakes SET status = 'verifying', last_error = NULL, updated_at = ? WHERE id = ?")
      .bind(now, id).run();
    const { env } = await import("cloudflare:workers");
    const qualificationProvider = new GoogleCollectorQualificationProvider(env.RISKSHIELD_INTERPRETER_API_KEY ?? "");
    const searchProvider = new GoogleCollectorSearchVerificationProvider(env.RISKSHIELD_INTERPRETER_API_KEY ?? "");
    if (!qualificationProvider.configured || !searchProvider.configured) throw Object.assign(new Error("public_feedback_verification_not_configured"), { code: "verification_not_configured" });
    const verification = await verifyPublicFeedbackExpression(
      { expression, contexts },
      { qualify: qualificationProvider.qualify.bind(qualificationProvider), verify: searchProvider.verify.bind(searchProvider) },
      AbortSignal.timeout(35_000),
    );
    const qualificationJson = verification.qualification ? JSON.stringify(verification.qualification) : null;
    const searchJson = verification.searchVerification ? JSON.stringify(verification.searchVerification) : null;
    if (verification.status !== "promoted") {
      const nextCheckAt = verification.status === "monitor"
        ? new Date(Date.now() + 3 * 86_400_000).toISOString()
        : new Date(Date.now() + 30 * 86_400_000).toISOString();
      await db.prepare(`UPDATE riskshield_public_feedback_intakes SET status = ?, qualification_json = ?,
        search_verification_json = ?, last_error = NULL, next_check_at = ?, updated_at = ? WHERE id = ?`)
        .bind(verification.status, qualificationJson, searchJson, nextCheckAt, now, id).run();
      return json({ acknowledged: true, intakeStatus: verification.status, reviewRequired: false });
    }

    const family = riskFamily(verification.searchVerification.riskFamily);
    const domain = riskDomain(verification.searchVerification.riskFamily);
    const candidateId = `public_verified_${hash.slice(0, 32)}`;
    const verifiedTests = verifiedContextTests(contexts, verification.qualification);
    const payload: CandidateRecord & { consentPolicyVersion: string; retentionDeadline: string; submissionCount: number } = {
      id: candidateId,
      expression,
      riskFamily: family,
      riskDomain: domain,
      reportType,
      origin: { type: "user_feedback", reportType },
      qualityGateVersion: PUBLIC_FEEDBACK_GATE_VERSION,
      qualification: {
        disposition: verification.qualification.disposition,
        role: verification.qualification.role,
        riskFamily: family,
        confidence: verification.qualification.confidence,
        reason: verification.qualification.reason,
        directUseCount: 1,
        contextualUseCount: 0,
        distinctAuthorCount: reporters.length,
        distinctPlatformCount: 1,
        observationCount: submissionCount,
      },
      searchVerification: { ...verification.searchVerification, riskFamily: family, verifiedAt: now },
      status: "pending",
      noveltyScore: null,
      confidence: Math.min(verification.qualification.confidence, verification.searchVerification.confidence),
      sourceCount: submissionCount,
      createdAt: now,
      expressionGroup: [expression],
      contextSummary: verification.reason,
      evidence: contexts,
      positiveTests: verifiedTests.positiveTests,
      negativeTests: verifiedTests.negativeTests,
      draft: {
        title: `${expression} 표현 검토`, riskSummary: verification.reason, riskFamily: family, riskDomain: domain,
        matchMode: "atomic_lexeme", triggerPatterns: [expression], contextPatterns: [],
        exclusionPatterns: ["뜻", "의미", "표현은 쓰지 마세요", "사용하지 마세요"],
        severityFloor: severityFloor(verification.searchVerification.riskFamily),
        safeRewrite: ["비하·공격·기만 표현 대신 대상과 상황을 사실 중심으로 구체적으로 설명해 주세요."],
      },
      lineage: null,
      sources: verification.searchVerification.sources.map((source) => ({ title: source.title, url: source.uri, date: now.slice(0, 10) })),
      autoInclusionBlockedReason: "의미·검색 검증은 통과했지만 사람 검토와 회귀 테스트 전에는 활성화하지 않습니다.",
      consentPolicyVersion: CONSENT_POLICY_VERSION,
      retentionDeadline,
      submissionCount,
    };
    await db.prepare(`
      INSERT INTO riskshield_candidates (id, status, payload, retention_deadline, created_at, updated_at)
      VALUES (?, 'pending', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = CASE WHEN riskshield_candidates.status IN ('pending', 'held') THEN excluded.payload ELSE riskshield_candidates.payload END,
        retention_deadline = CASE WHEN riskshield_candidates.status IN ('pending', 'held') THEN excluded.retention_deadline ELSE riskshield_candidates.retention_deadline END,
        status = CASE WHEN riskshield_candidates.status = 'held' THEN 'pending' ELSE riskshield_candidates.status END,
        updated_at = CASE WHEN riskshield_candidates.status IN ('pending', 'held') THEN excluded.updated_at ELSE riskshield_candidates.updated_at END
    `).bind(candidateId, JSON.stringify(payload), retentionDeadline, now, now).run();
    await db.prepare(`UPDATE riskshield_public_feedback_intakes SET status = 'promoted', qualification_json = ?,
      search_verification_json = ?, candidate_id = ?, last_error = NULL, next_check_at = NULL, updated_at = ? WHERE id = ?`)
      .bind(qualificationJson, searchJson, candidateId, now, id).run();
    return json({
      acknowledged: true,
      candidateId,
      intakeStatus: "promoted",
      reviewRequired: true,
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "verification_unavailable";
    const nextCheckAt = new Date(Date.now() + 60 * 60_000).toISOString();
    try {
      await db.prepare(`UPDATE riskshield_public_feedback_intakes SET status = 'verification_error', last_error = ?,
        next_check_at = ?, updated_at = ? WHERE id = ?`).bind(code, nextCheckAt, new Date().toISOString(), id).run();
    } catch { /* preserve the original failure */ }
    return json({ acknowledged: true, intakeStatus: "verification_error", reviewRequired: false,
      message: "신고는 접수했지만 자동 검증을 완료하지 못했습니다. 잠시 후 다시 확인합니다." }, 202);
  }
}
