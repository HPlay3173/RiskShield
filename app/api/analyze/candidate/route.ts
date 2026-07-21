import { prepareInterpreterInput } from "../../../../lib/v0-4/interpreter";
import {
  INVALID_JSON_BODY,
  JSON_BODY_TOO_LARGE,
  readJsonValue,
} from "../../../../lib/http/control-response";
import type { CandidateRecord } from "../../../../lib/repositories/contracts";
import { resolveActiveReviewedSkills } from "../../../../lib/active-skills";
import { analyzeText } from "../../../../lib/riskshield";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_EXPRESSION_CHARS = 500;
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

function suggestedClassification(expression: string) {
  const text = expression.normalize("NFKC").toLocaleLowerCase("ko-KR");
  if (/(?:느개미|느금마|느금|운지|노알라|일베충|도그휘슬)/u.test(text)) {
    return { riskFamily: "coded_expression" as const, riskDomain: "숨은 은어·코드 표현", severityFloor: 65 };
  }
  if (/(?:죽여|죽인다|패버려|때려죽|칼로|살해)/u.test(text)) {
    return { riskFamily: "violent_threat" as const, riskDomain: "폭력·위협 표현", severityFloor: 80 };
  }
  if (/(?:병신|개새끼|씨발|꺼져|닥쳐|멍청이|쓰레기)/u.test(text)) {
    return { riskFamily: "abusive_language" as const, riskDomain: "욕설·공격 표현", severityFloor: 68 };
  }
  if (/(?:한남|한녀|김치녀|맘충|틀딱|홍어|장애인|외국인|여자는|남자는)/u.test(text)) {
    return { riskFamily: "hate_discrimination" as const, riskDomain: "혐오·차별 표현", severityFloor: 75 };
  }
  return { riskFamily: "general_substantiation" as const, riskDomain: "미분류 텍스트 위험", severityFloor: 55 };
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
  const expression = body.text.trim();
  const reportType = reportTypeOf(body.reportType);
  if (!expression || expression.length > MAX_EXPRESSION_CHARS) {
    return json({ error: "invalid_expression", message: `후보 문구는 ${MAX_EXPRESSION_CHARS}자 이하여야 합니다.` }, 400);
  }
  const prepared = prepareInterpreterInput(expression, MAX_EXPRESSION_CHARS);
  if (prepared.masked) {
    return json({ error: "personal_data_detected", message: "개인정보가 포함된 문구는 학습 후보로 제공할 수 없습니다." }, 400);
  }

  const classification = suggestedClassification(expression);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${reportType}:${expression.normalize("NFKC")}`));
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  const id = `public_submission_${hash.slice(0, 32)}`;
  const now = new Date().toISOString();
  const retentionDeadline = new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString();
  const payload: CandidateRecord & {
    consentPolicyVersion: string;
    retentionDeadline: string;
    submissionCount: number;
  } = {
    id,
    expression,
    riskFamily: classification.riskFamily,
    riskDomain: classification.riskDomain,
    reportType,
    status: "pending",
    noveltyScore: null,
    confidence: null,
    sourceCount: 1,
    createdAt: now,
    expressionGroup: [expression],
    contextSummary: reportType === "false_positive"
      ? "공개 Analyzer 사용자가 위험하지 않은 문맥을 잘못 탐지했다고 신고했습니다."
      : "공개 Analyzer 사용자가 놓친 위험 표현이라고 명시적으로 신고했습니다. 위험 분류는 검토자가 확정해야 합니다.",
    evidence: [expression],
    positiveTests: reportType === "false_positive" ? [] : [expression],
    negativeTests: [`“${expression}”라는 표현은 사용하지 마세요.`],
    redTeam: null,
    modelConflict: null,
    policyChange: null,
    draft: reportType === "false_positive" ? null : {
      title: "사용자 신고 표현 검토",
      riskSummary: "사용자가 탐지 누락으로 신고한 표현입니다. 의미와 사용 맥락을 확인한 뒤 분류를 확정하세요.",
      riskFamily: classification.riskFamily,
      riskDomain: classification.riskDomain,
      matchMode: "atomic_lexeme",
      triggerPatterns: [expression],
      contextPatterns: [],
      exclusionPatterns: ["뜻", "의미", "표현은 쓰지 마세요", "사용하지 마세요"],
      severityFloor: classification.severityFloor,
      safeRewrite: ["비하·공격 표현 대신 대상과 상황을 사실 중심으로 구체적으로 설명해 주세요."],
    },
    lineage: null,
    sources: [{ title: "Public Analyzer opt-in", url: "", date: now.slice(0, 10) }],
    autoInclusionBlockedReason: "출처 검증, 문맥 분류, 양성·음성·반례 테스트와 사람 승인이 끝날 때까지 active skill로 편입하지 않습니다.",
    consentPolicyVersion: CONSENT_POLICY_VERSION,
    retentionDeadline,
    submissionCount: 1,
  };

  try {
    await db.prepare(
      "DELETE FROM riskshield_candidates WHERE id LIKE 'public_submission_%' AND retention_deadline IS NOT NULL AND retention_deadline <= ?",
    ).bind(now).run();
    const reviewedRows = await db.prepare(
      "SELECT id, review_status, payload FROM risk_skills WHERE review_status = 'reviewed' ORDER BY updated_at DESC",
    ).all<{ id: string; review_status: string; payload: string }>();
    const existingRuleResult = analyzeText(expression, resolveActiveReviewedSkills(reviewedRows.results ?? []));
    if (existingRuleResult.matches.length > 0 && reportType !== "false_positive") {
      return json({ error: "known_expression", message: "이미 검토된 규칙과 일치하는 문구는 신규 후보로 저장하지 않습니다." }, 409);
    }
    const existing = await db.prepare(
      "SELECT status, payload FROM riskshield_candidates WHERE id = ? LIMIT 1",
    ).bind(id).first<{ status: string; payload: string }>();
    if (existing?.status === "approved" || existing?.status === "merged" || existing?.status === "rejected") {
      return json({ acknowledged: true, candidateId: id, status: existing.status, autoActivated: false, reviewRequired: false });
    }
    if (existing?.payload) {
      try {
        const previous = JSON.parse(existing.payload) as { submissionCount?: unknown };
        payload.submissionCount = typeof previous.submissionCount === "number"
          ? Math.max(1, Math.floor(previous.submissionCount)) + 1
          : 2;
      } catch {
        payload.submissionCount = 2;
      }
    }
    await db.prepare(`
      INSERT INTO riskshield_candidates (id, status, payload, retention_deadline, created_at, updated_at)
      VALUES (?, 'pending', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = CASE WHEN riskshield_candidates.status IN ('pending', 'held') THEN excluded.payload ELSE riskshield_candidates.payload END,
        retention_deadline = CASE WHEN riskshield_candidates.status IN ('pending', 'held') THEN excluded.retention_deadline ELSE riskshield_candidates.retention_deadline END,
        status = CASE WHEN riskshield_candidates.status = 'held' THEN 'pending' ELSE riskshield_candidates.status END,
        updated_at = CASE WHEN riskshield_candidates.status IN ('pending', 'held') THEN excluded.updated_at ELSE riskshield_candidates.updated_at END
    `).bind(id, JSON.stringify(payload), retentionDeadline, now, now).run();
    return json({
      acknowledged: true,
      candidateId: id,
      status: "pending",
      autoActivated: false,
      reviewRequired: true,
    });
  } catch {
    return json({ error: "candidate_storage_unavailable", message: "후보를 저장하지 못했습니다." }, 503);
  }
}
