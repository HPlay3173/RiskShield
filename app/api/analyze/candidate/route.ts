import { prepareInterpreterInput } from "../../../../lib/v0-4/interpreter";
import {
  RISK_SKILL_SCHEMA_VERSION,
  type RiskSkill,
} from "../../../../lib/riskshield";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_EXPRESSION_CHARS = 500;
const WINDOW_MS = 60 * 60 * 1_000;
const SUBMISSION_LIMIT = 5;

const buckets = new Map<string, { startedAt: number; count: number }>();

const RISK_DOMAINS = new Set([
  "health_claim",
  "financial_guarantee",
  "income_claim",
  "education_outcome",
  "legal_outcome",
  "privacy_intrusion",
  "urgency",
  "general_substantiation",
]);

const DOMAIN_LABELS: Record<string, string> = {
  health_claim: "건강·의료 주장",
  financial_guarantee: "금융·투자 보장",
  income_claim: "소득·부업 주장",
  education_outcome: "교육 결과 주장",
  legal_outcome: "법률 결과 주장",
  privacy_intrusion: "개인정보·감시 위험",
  urgency: "긴급성·희소성 주장",
  general_substantiation: "일반 입증 필요 주장",
  unclassified: "분류 대기",
};

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

async function enforceLimit(request: Request) {
  const key = await requestKey(request);
  const now = Date.now();
  const current = buckets.get(key);
  const bucket = !current || now - current.startedAt >= WINDOW_MS
    ? { startedAt: now, count: 0 }
    : current;
  if (bucket.count >= SUBMISSION_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + WINDOW_MS - now) / 1_000));
    return json({ error: "candidate_rate_limited", message: "후보 제공 횟수를 초과했습니다." }, 429, {
      "retry-after": String(retryAfter),
    });
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const limited = await enforceLimit(request);
  if (limited) return limited;
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: "unsupported_media_type", message: "JSON 요청이 필요합니다." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "payload_too_large", message: "후보 문구가 너무 깁니다." }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json", message: "올바른 JSON 요청이 필요합니다." }, 400);
  }
  if (!isRecord(body) || body.consent !== true || typeof body.text !== "string") {
    return json({ error: "explicit_consent_required", message: "후보 제공 동의가 필요합니다." }, 400);
  }
  const expression = body.text.trim();
  if (!expression || expression.length > MAX_EXPRESSION_CHARS) {
    return json({ error: "invalid_expression", message: `후보 문구는 ${MAX_EXPRESSION_CHARS}자 이하여야 합니다.` }, 400);
  }
  const prepared = prepareInterpreterInput(expression, MAX_EXPRESSION_CHARS);
  if (prepared.masked) {
    return json({ error: "personal_data_detected", message: "개인정보가 포함된 문구는 학습 후보로 제공할 수 없습니다." }, 400);
  }

  const riskDomain = typeof body.riskDomain === "string" && RISK_DOMAINS.has(body.riskDomain)
    ? body.riskDomain
    : "unclassified";
  const confidence = typeof body.confidence === "number" && Number.isFinite(body.confidence)
    ? Math.min(1, Math.max(0, body.confidence))
    : null;
  const score = typeof body.score === "number" && Number.isFinite(body.score)
    ? Math.min(100, Math.max(0, Math.round(body.score)))
    : null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expression.normalize("NFKC")));
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  const id = `public_${hash.slice(0, 32)}`;
  const now = new Date().toISOString();
  const payload: RiskSkill = {
    schemaVersion: RISK_SKILL_SCHEMA_VERSION,
    revision: 1,
    id,
    category: DOMAIN_LABELS[riskDomain] ?? DOMAIN_LABELS.unclassified,
    subcategory: "공개 제보 후보",
    patternType: "candidate_expression_pending_review",
    triggerPatterns: [expression],
    contextPatterns: [],
    anyOfPatterns: [],
    exclusionPatterns: [],
    conditionScope: "sentence",
    maxDistance: 48,
    surfaceMeaning: expression,
    riskSummary: "공개 Analyzer 사용자가 명시적으로 제공한 신규 표현 후보입니다.",
    socialContext: "실제 사용 문맥, 반복성, 출처를 추가로 확인해야 합니다.",
    legalOrEthicIssue: "자동 법률 판단이 아니며 사람의 정책 검토가 필요합니다.",
    riskReason: score === null
      ? "현재 규칙에 없는 표현으로 분류되어 검토 대기 중입니다."
      : `결정론적 분석 점수 ${score}점의 미등록 표현으로 분류되어 검토 대기 중입니다.`,
    severityFloor: score ?? 0,
    dominantRisk: false,
    confidence: confidence ?? 0,
    riskDomain,
    recentContextTags: ["public-opt-in", "novel-expression"],
    safeRewrite: [],
    falsePositiveNote: "인용·비판·교육·부정 문맥과 우연한 단어 중복을 반드시 확인하세요.",
    notes: "자동 활성화 금지. 양성·음성·반례 테스트와 출처 검증 후 사람이 승인합니다.",
    source: {
      title: "Public Analyzer opt-in",
      url: "",
      date: now.slice(0, 10),
      sourceId: id,
      provenanceStatus: "synthetic_unverified",
    },
    createdAt: now,
    updatedAt: now,
    reviewStatus: "draft",
  };

  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) return json({ error: "candidate_storage_unavailable" }, 503);
    await env.DB.prepare(`
      INSERT INTO risk_skills (
        id, category, review_status, severity_floor, dominant_risk,
        payload, created_at, updated_at
      )
      VALUES (?, ?, 'draft', ?, 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        category = CASE WHEN risk_skills.review_status = 'draft' THEN excluded.category ELSE risk_skills.category END,
        severity_floor = CASE WHEN risk_skills.review_status = 'draft' THEN excluded.severity_floor ELSE risk_skills.severity_floor END,
        payload = CASE WHEN risk_skills.review_status = 'draft' THEN excluded.payload ELSE risk_skills.payload END,
        updated_at = CASE WHEN risk_skills.review_status = 'draft' THEN excluded.updated_at ELSE risk_skills.updated_at END
    `).bind(
      id,
      payload.category,
      payload.severityFloor,
      JSON.stringify(payload),
      now,
      now,
    ).run();
    return json({
      acknowledged: true,
      candidateId: id,
      status: "draft",
      autoActivated: false,
      reviewRequired: true,
    });
  } catch {
    return json({ error: "candidate_storage_unavailable", message: "후보를 저장하지 못했습니다." }, 503);
  }
}
