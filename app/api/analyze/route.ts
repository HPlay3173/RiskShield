import {
  DEFAULT_SEVERITY_RULES,
  COMPATIBILITY_MATCHER_POLICY_VERSION,
  analyzeText,
  parseSeverityRules,
  type AnalysisResult,
  type RiskSkill,
  type SeverityRules,
} from "../../../lib/riskshield";
import { resolveActiveReviewedSkills } from "../../../lib/active-skills";
import { GEMMA_LIVE_PILOT_MODEL, GoogleGenAiProvider } from "../../../lib/v0-4/google-genai-provider";
import {
  INTERPRETER_PROMPT_VERSION,
  INTERPRETER_SCHEMA_VERSION,
  LiveInterpreter,
  hashInterpreterInput,
  prepareInterpreterInput,
  type ClaimTarget,
  type InterpreterRun,
} from "../../../lib/v0-4/interpreter";
import { PRODUCT_VERSION, SITES_VERSION, SOURCE_COMMIT } from "../../../lib/release";
import {
  INVALID_JSON_BODY,
  JSON_BODY_TOO_LARGE,
  readJsonValue,
} from "../../../lib/http/control-response";
import {
  aggregateDocumentScore,
  documentDecisionReason,
  scoreClaim,
  segmentClaims,
  type ClaimScore,
} from "../../../lib/v0-5/document-scoring";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_INPUT_CHARS = 2_000;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 256;
const BURST_WINDOW_MS = 60 * 1_000;
const BURST_LIMIT = 6;
const DAILY_REQUEST_LIMIT = 40;
const DAILY_PROVIDER_CALL_LIMIT = 250;
const MAX_PROVIDER_CONCURRENCY = 4;
const MAX_RETRY_AFTER_SECONDS = 2;
const MAX_AI_ANALYZED_CLAIMS = 6;

const ANALYSIS_PROFILES = {
  balanced: {
    label: "균형 분석",
    focus: "위험 점수, 분야, 문맥, 불확실성을 기본 순서로 함께 표시합니다.",
    emphasis: "balanced",
  },
  advertising: {
    label: "광고·주장",
    focus: "잠긴 v4 점수는 바꾸지 않고 광고·효능·보장 관련 분야를 결과 상단에 배치합니다.",
    emphasis: "claims",
  },
  context: {
    label: "문맥 우선",
    focus: "잠긴 v4 점수는 바꾸지 않고 인용·비판·부정 관계와 불확실성 설명을 먼저 표시합니다.",
    emphasis: "context",
  },
} as const;

type AnalysisProfile = keyof typeof ANALYSIS_PROFILES;

type CacheEntry = {
  expiresAt: number;
  run: InterpreterRun;
};

const verifiedResultCache = new Map<string, CacheEntry>();
const inFlightInterpreterRuns = new Map<string, Promise<InterpreterRun>>();
let activeProviderCalls = 0;

async function getRuntimeEnvironment() {
  const { env } = await import("cloudflare:workers");
  return env as typeof env & {
    RISKSHIELD_ENABLE_DEV_PRINCIPAL?: string;
    RISKSHIELD_INTERPRETER_API_KEY?: string;
  };
}

type RuntimeEnvironment = Awaited<ReturnType<typeof getRuntimeEnvironment>>;

function developmentRuleFallback(runtime: RuntimeEnvironment) {
  return process.env.NODE_ENV !== "production" && runtime.RISKSHIELD_ENABLE_DEV_PRINCIPAL === "1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function analysisProfile(value: unknown): AnalysisProfile {
  return typeof value === "string" && value in ANALYSIS_PROFILES
    ? value as AnalysisProfile
    : "balanced";
}

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function cacheKeyFor(text: string, skills: readonly RiskSkill[], severityRules: SeverityRules) {
  const prepared = prepareInterpreterInput(text, MAX_INPUT_CHARS);
  return hashInterpreterInput(
    JSON.stringify({
      schema: INTERPRETER_SCHEMA_VERSION,
      prompt: INTERPRETER_PROMPT_VERSION,
      model: GEMMA_LIVE_PILOT_MODEL,
      matcherPolicy: COMPATIBILITY_MATCHER_POLICY_VERSION,
      skills: skills.map((skill) => [skill.id, skill.revision, skill.updatedAt]),
      severityRules,
      text: prepared.modelText,
    }),
  );
}

function readCached(key: string) {
  const entry = verifiedResultCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    verifiedResultCache.delete(key);
    return null;
  }
  verifiedResultCache.delete(key);
  verifiedResultCache.set(key, entry);
  return entry.run;
}

function writeCached(key: string, run: InterpreterRun) {
  if (!run.ok || !run.schemaValid || !run.payload) return;
  for (const [cachedKey, entry] of verifiedResultCache) {
    if (entry.expiresAt <= Date.now()) verifiedResultCache.delete(cachedKey);
  }
  while (verifiedResultCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = verifiedResultCache.keys().next().value as string | undefined;
    if (!oldest) break;
    verifiedResultCache.delete(oldest);
  }
  verifiedResultCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, run });
}

async function readReviewedSkills(runtime: RuntimeEnvironment): Promise<RiskSkill[]> {
  try {
    if (!runtime.DB) throw new Error("storage_unavailable");
    const rows = await runtime.DB.prepare(
      "SELECT id, review_status, payload FROM risk_skills ORDER BY updated_at DESC",
    ).all<{ id: string; review_status: string; payload: string }>();
    return resolveActiveReviewedSkills(rows.results ?? []);
  } catch (error) {
    if (developmentRuleFallback(runtime)) {
      return resolveActiveReviewedSkills([]);
    }
    throw error;
  }
}

async function readSeverityRules(runtime: RuntimeEnvironment): Promise<SeverityRules> {
  if (!runtime.DB) return DEFAULT_SEVERITY_RULES;
  try {
    const row = await runtime.DB.prepare(
      "SELECT payload FROM riskshield_settings WHERE key = 'severity_rules'",
    ).first<{ payload?: string }>();
    if (!row?.payload) return DEFAULT_SEVERITY_RULES;
    const parsed = parseSeverityRules(row.payload);
    return parsed.issues.length === 0 ? parsed.rules : DEFAULT_SEVERITY_RULES;
  } catch (error) {
    if (developmentRuleFallback(runtime)) return DEFAULT_SEVERITY_RULES;
    throw error;
  }
}

async function reserveProviderCall(runtime: RuntimeEnvironment) {
  if (!runtime.DB) return developmentRuleFallback(runtime);
  const day = utcDay();
  const result = await runtime.DB.prepare(`
    INSERT INTO riskshield_provider_budgets (day, call_count, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(day) DO UPDATE SET
      call_count = riskshield_provider_budgets.call_count + 1,
      updated_at = excluded.updated_at
    WHERE riskshield_provider_budgets.call_count < ?
    RETURNING call_count
  `).bind(day, new Date().toISOString(), DAILY_PROVIDER_CALL_LIMIT).first<{ call_count: number }>();
  return Boolean(result && result.call_count <= DAILY_PROVIDER_CALL_LIMIT);
}

async function runInterpreter(
  text: string,
  domainHint: ClaimTarget | undefined,
  apiKey: string,
  runtime: RuntimeEnvironment,
) {
  if (!await reserveProviderCall(runtime)) {
    return unavailableRun(hashInterpreterInput(text), text, "provider_budget_exhausted");
  }
  const interpreter = new LiveInterpreter(new GoogleGenAiProvider(apiKey));
  const run = await interpreter.interpret({ text, domainHint });
  if (!run.resourceExhausted) return run;
  if (
    run.retryAfterSeconds === null ||
    run.retryAfterSeconds === undefined ||
    run.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS ||
    !await reserveProviderCall(runtime)
  ) {
    return run;
  }
  await new Promise((resolve) => setTimeout(resolve, run.retryAfterSeconds! * 1_000));
  return interpreter.interpret({ text, domainHint });
}

function runInterpreterOnce(
  key: string,
  text: string,
  domainHint: ClaimTarget | undefined,
  apiKey: string,
  runtime: RuntimeEnvironment,
) {
  const existing = inFlightInterpreterRuns.get(key);
  if (existing) return existing;
  if (activeProviderCalls >= MAX_PROVIDER_CONCURRENCY) {
    return Promise.resolve(unavailableRun(key, text, "provider_concurrency_saturated"));
  }
  activeProviderCalls += 1;
  const pending = runInterpreter(text, domainHint, apiKey, runtime).finally(() => {
    inFlightInterpreterRuns.delete(key);
    activeProviderCalls = Math.max(0, activeProviderCalls - 1);
  });
  inFlightInterpreterRuns.set(key, pending);
  return pending;
}

function domainHintFor(skills: readonly RiskSkill[]): ClaimTarget | undefined {
  const value = skills[0]?.riskDomain.toLocaleLowerCase("ko-KR") ?? "";
  if (/(privacy|개인정보|위치정보|사생활)/u.test(value)) return "privacy";
  if (/(legal|법률|전문서비스)/u.test(value)) return "legal";
  if (/(education|교육|입시)/u.test(value)) return "education";
  if (/(medical|health|의료|건강)/u.test(value)) return "health";
  if (/(finance|금융|투자)/u.test(value)) return "finance";
  return value ? "general" : undefined;
}

function projectRules(rules: AnalysisResult, profile: AnalysisProfile) {
  const categoryScores = rules.categoryScores.map(({ category, score }) => ({ category, score }));
  if (profile === "advertising") {
    categoryScores.sort((left, right) => {
      const leftPriority = /(광고|효능|보장|과장|의료|건강|금융|투자|수익|비교)/u.test(left.category) ? 1 : 0;
      const rightPriority = /(광고|효능|보장|과장|의료|건강|금융|투자|수익|비교)/u.test(right.category) ? 1 : 0;
      return rightPriority - leftPriority || right.score - left.score;
    });
  }
  return {
    finalScore: rules.finalScore,
    grade: rules.grade,
    status: rules.status,
    statusLabel: rules.statusLabel,
    speechAct: rules.speechAct,
    recommendation: rules.recommendation,
    reason: rules.reason,
    suggestedRewrite: rules.suggestedRewrite,
    dominantFloor: rules.dominantFloor,
    topCategoryScore: rules.topCategoryScore,
    categoryScores,
    evidence: (rules.primaryMatch?.hits ?? []).map(({ start, end, text, role }) => ({
      start,
      end,
      text,
      role,
    })),
    generatedAt: rules.generatedAt,
  };
}

async function abuseKey(request: Request) {
  const day = utcDay();
  const address =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unavailable";
  const bytes = new TextEncoder().encode(`riskshield:public-analyze:${day}:${address}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function enforceRateLimit(request: Request, runtime: RuntimeEnvironment) {
  const key = await abuseKey(request);
  const now = Date.now();
  const day = utcDay();
  if (!runtime.DB) {
    return developmentRuleFallback(runtime)
      ? null
      : json({ error: "rate_limit_storage_unavailable", message: "요청 제한 저장소를 사용할 수 없습니다." }, 503);
  }
  let bucket: { day_count: number; window_started_at: number; window_count: number } | null;
  try {
    bucket = await runtime.DB.prepare(`
      INSERT INTO riskshield_public_limits
      (bucket_key, day, day_count, window_started_at, window_count, updated_at)
    VALUES (?, ?, 1, ?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      day = excluded.day,
      day_count = CASE
        WHEN riskshield_public_limits.day = excluded.day THEN riskshield_public_limits.day_count + 1
        ELSE 1
      END,
      window_started_at = CASE
        WHEN riskshield_public_limits.day <> excluded.day
          OR excluded.window_started_at - riskshield_public_limits.window_started_at >= ?
        THEN excluded.window_started_at
        ELSE riskshield_public_limits.window_started_at
      END,
      window_count = CASE
        WHEN riskshield_public_limits.day <> excluded.day
          OR excluded.window_started_at - riskshield_public_limits.window_started_at >= ?
        THEN 1
        ELSE riskshield_public_limits.window_count + 1
      END,
      updated_at = excluded.updated_at
    RETURNING day_count, window_started_at, window_count
    `).bind(key, day, now, new Date(now).toISOString(), BURST_WINDOW_MS, BURST_WINDOW_MS)
      .first<{ day_count: number; window_started_at: number; window_count: number }>();
  } catch {
    if (developmentRuleFallback(runtime)) return null;
    return json({ error: "rate_limit_unavailable", message: "요청 제한을 확인하지 못했습니다." }, 503);
  }
  if (!bucket) return json({ error: "rate_limit_unavailable", message: "요청 제한을 확인하지 못했습니다." }, 503);
  const burstBlocked = bucket.window_count > BURST_LIMIT;
  const dailyBlocked = bucket.day_count > DAILY_REQUEST_LIMIT;
  if (burstBlocked || dailyBlocked) {
    const retryAfter = burstBlocked
      ? Math.max(1, Math.ceil((bucket.window_started_at + BURST_WINDOW_MS - now) / 1_000))
      : Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00.000Z`) + 86_400_000 - now) / 1_000));
    return Response.json(
      { error: "rate_limited", message: "요청이 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "retry-after": String(retryAfter), "cache-control": "no-store" } },
    );
  }
  return null;
}

function unavailableRun(key: string, text: string, reason = "server_secret_unavailable"): InterpreterRun {
  return {
    ok: false,
    payload: null,
    schemaValid: false,
    errors: [reason],
    inputHash: key,
    masked: prepareInterpreterInput(text).masked,
    minimized: false,
    mode: "live",
    providerId: "google-genai-native-rest",
    model: "unavailable",
    promptVersion: "unavailable",
    schemaVersion: INTERPRETER_SCHEMA_VERSION,
    latencyMs: 0,
    providerRequestMs: 0,
    validationMs: 0,
    estimatedCost: 0,
    tokenUsage: null,
    timedOut: false,
    timeoutStage: null,
  };
}

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function publicAiFallback(run: InterpreterRun) {
  if (run.ok) return { reasonCode: null, reasonLabel: null };
  const reason = run.errors.join(" ").toLocaleLowerCase("en-US");
  if (reason.includes("server_secret_unavailable")) return { reasonCode: "configuration_missing", reasonLabel: "AI 설정이 준비되지 않았습니다." };
  if (reason.includes("budget")) return { reasonCode: "daily_limit", reasonLabel: "오늘의 AI 분석 한도에 도달했습니다." };
  if (reason.includes("concurrency") || reason.includes("saturated")) return { reasonCode: "temporarily_busy", reasonLabel: "AI 분석 요청이 몰려 잠시 사용할 수 없습니다." };
  if (run.timedOut || reason.includes("timeout") || reason.includes("aborted")) return { reasonCode: "provider_timeout", reasonLabel: "AI 응답 시간이 초과되었습니다." };
  if (reason.includes("429") || reason.includes("resource_exhausted")) return { reasonCode: "provider_rate_limited", reasonLabel: "AI 제공자의 일시적 호출 제한이 적용되었습니다." };
  if (reason.includes("http 400")) return { reasonCode: "provider_request_rejected", reasonLabel: "AI 제공자가 분석 요청 형식을 거부했습니다." };
  if (reason.includes("http 401") || reason.includes("http 403")) return { reasonCode: "provider_credentials_rejected", reasonLabel: "AI 제공자가 현재 인증 설정을 허용하지 않았습니다." };
  if (reason.includes("http 404")) return { reasonCode: "provider_model_unavailable", reasonLabel: "설정된 AI 모델을 현재 사용할 수 없습니다." };
  if (reason.includes("http 5")) return { reasonCode: "provider_unavailable", reasonLabel: "AI 제공자 서비스가 일시적으로 응답하지 않습니다." };
  if (reason.includes("schema") || reason.includes("validation") || reason.includes("evidence") || reason.includes("함수 인자") || reason.includes("enum") || reason.includes("허용되지 않은 필드")) return { reasonCode: "response_validation_failed", reasonLabel: "AI 응답을 안전하게 검증하지 못했습니다." };
  return { reasonCode: "provider_error", reasonLabel: "AI 문맥 분석 중 일시적인 오류가 발생했습니다." };
}

export async function POST(request: Request) {
  const runtime = await getRuntimeEnvironment();
  const limited = await enforceRateLimit(request, runtime);
  if (limited) return limited;
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: "unsupported_media_type", message: "JSON 요청이 필요합니다." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "payload_too_large", message: "분석 문구가 너무 깁니다." }, 413);
  }

  const body = await readJsonValue(request, MAX_REQUEST_BYTES);
  if (body === JSON_BODY_TOO_LARGE) {
    return json({ error: "payload_too_large", message: "분석 문구가 너무 깁니다." }, 413);
  }
  if (body === INVALID_JSON_BODY) {
    return json({ error: "invalid_json", message: "올바른 JSON 요청이 필요합니다." }, 400);
  }
  if (!isRecord(body) || typeof body.text !== "string" || !body.text.trim()) {
    return json({ error: "text_required", message: "분석할 문구가 필요합니다." }, 400);
  }
  if (body.text.length > MAX_INPUT_CHARS) {
    return json(
      { error: "text_too_long", message: `분석 문구는 ${MAX_INPUT_CHARS.toLocaleString("ko-KR")}자 이하여야 합니다.` },
      413,
    );
  }

  const text = body.text.trim();
  const profile = analysisProfile(body.profile);
  try {
    const apiKey = runtime.RISKSHIELD_INTERPRETER_API_KEY ?? "";
    const [skills, severityRules] = await Promise.all([
      readReviewedSkills(runtime),
      readSeverityRules(runtime),
    ]);
    const rules = analyzeText(text, skills, { severityRules });
    const segments = segmentClaims(text);
    const rulesByClaim = segments.map((segment) => analyzeText(segment.text, skills, { severityRules }));
    const aiClaimIndexes = new Set(rulesByClaim
      .map((claimRules, index) => ({ index, score: scoreClaim(segments[index], claimRules, null).scoring.finalScore }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, MAX_AI_ANALYZED_CLAIMS)
      .map((item) => item.index));
    const claimScores: ClaimScore[] = [];
    const claimRuns: InterpreterRun[] = [];
    for (let offset = 0; offset < segments.length; offset += 3) {
      const batch = await Promise.all(segments.slice(offset, offset + 3).map(async (segment, batchIndex) => {
        const claimIndex = offset + batchIndex;
        const claimRules = rulesByClaim[claimIndex];
        if (!aiClaimIndexes.has(claimIndex)) {
          const claimRun = unavailableRun(hashInterpreterInput(segment.text), segment.text, "claim_ai_limit");
          return { score: scoreClaim(segment, claimRules, null), run: claimRun };
        }
        const key = cacheKeyFor(segment.text, skills, severityRules);
        let claimRun = readCached(key);
        if (!claimRun && apiKey) {
          claimRun = await runInterpreterOnce(
            key,
            segment.text,
            domainHintFor(claimRules.primaryMatch ? [claimRules.primaryMatch.skill] : []),
            apiKey,
            runtime,
          );
          writeCached(key, claimRun);
        }
        claimRun ??= unavailableRun(key, segment.text, "server_secret_unavailable");
        return { score: scoreClaim(segment, claimRules, claimRun.payload), run: claimRun };
      }));
      for (const item of batch) {
        claimScores.push(item.score);
        claimRuns.push(item.run);
      }
    }
    const scoring = aggregateDocumentScore(claimScores);
    const primaryIndex = claimScores.reduce((best, claim, index) =>
      claim.scoring.finalScore > (claimScores[best]?.scoring.finalScore ?? -1) ? index : best, 0);
    const primaryClaim = claimScores[primaryIndex] ?? null;
    const run = claimRuns[primaryIndex] ?? unavailableRun(hashInterpreterInput(text), text, "server_secret_unavailable");
    const payload = run.payload;
      const uncertainty = !run.ok || scoring.conflict || scoring.status === "review"
        ? {
            level: "high" as const,
            reason: !run.ok
              ? "AI 문맥 해석을 사용할 수 없어 사람의 확인이 더 중요합니다."
              : "규칙과 문맥 신호가 충돌하거나 검토 경계에 있습니다.",
          }
        : scoring.status === "no_match" || (payload?.confidence ?? 0) < 0.75
          ? {
              level: "medium" as const,
              reason: "직접 위험 근거가 없거나 문맥 신뢰도가 제한적입니다.",
            }
          : {
              level: "low" as const,
              reason: "규칙 근거와 문맥 신호가 같은 방향을 가리킵니다.",
            };
      const exactEvidenceCount = rules.primaryMatch?.hits.length ?? 0;
      const aiOnlyCategoryCount = scoring.categoryScores.filter((category) => category.aiScore > 0 && category.ruleScore === 0).length;
      const novelty = exactEvidenceCount > 0
        ? {
            state: "known_pattern" as const,
            label: "알려진 패턴과 연결",
            reason: "검토된 규칙의 정확한 evidence 구간이 있습니다.",
            candidateRegistration: run.masked ? "disabled" as const : "available" as const,
          }
        : aiOnlyCategoryCount > 0
          ? {
              state: "possible_new_expression" as const,
              label: "새 위험 표현 후보",
              reason: "AI 다축 분석에서 위험 신호를 찾았지만 현재 검토 규칙에는 같은 근거가 없습니다.",
              candidateRegistration: run.masked ? "disabled" as const : "available" as const,
            }
          : {
              state: "insufficient_evidence" as const,
              label: "근거 부족",
              reason: "신규성이나 기존 패턴 여부를 확정할 근거가 충분하지 않습니다.",
              candidateRegistration: run.masked ? "disabled" as const : "available" as const,
            };
      const aiFallback = publicAiFallback(run);
      if (!run.ok) console.warn("RiskShield interpreter fallback", { reasonCode: aiFallback.reasonCode, timedOut: run.timedOut });
      return json({
        beta: "RiskShield v0.5 alpha",
        release: {
          productVersion: PRODUCT_VERSION,
          sitesVersion: SITES_VERSION,
          sourceCommit: SOURCE_COMMIT,
          interpreterSchema: INTERPRETER_SCHEMA_VERSION,
          interpreterPrompt: INTERPRETER_PROMPT_VERSION,
          scoringPolicy: scoring.policyVersion,
        },
        profile: {
          id: profile,
          ...ANALYSIS_PROFILES[profile],
          kernel: "v4-compatibility",
        },
        rules: projectRules(rules, profile),
        scoring: {
          ...scoring,
          status: scoring.status,
          rawScore: scoring.finalScore,
          calibratedScore: null,
          calibration: null,
          totalClaimCount: segments.length,
          rulesAnalyzedClaimCount: segments.length,
          aiAnalyzedClaimCount: aiClaimIndexes.size,
        },
        claims: claimScores.map((claim, index) => ({
          id: claim.id,
          index: index + 1,
          text: claim.text,
          start: claim.start,
          end: claim.end,
          score: claim.scoring.finalScore,
          status: claim.scoring.status,
          primaryCategory: claim.scoring.primaryCategory,
          evidence: [
            ...(claim.rules.primaryMatch?.hits ?? []).map((hit) => ({
              start: claim.start + hit.start,
              end: claim.start + hit.end,
              text: hit.text,
              source: "rule" as const,
            })),
            ...(claim.payload?.evidence_spans ?? []).map((span) => ({
              start: claim.start + span.start,
              end: claim.start + span.end,
              text: span.text,
              source: "ai" as const,
            })),
          ],
          aiState: claimRuns[index]?.ok ? "ready" as const : "fallback" as const,
        })),
        ai: {
          state: run.ok ? "ready" : "fallback",
          ...aiFallback,
          confidence: payload?.confidence ?? null,
          riskIntent: payload?.risk_intent ?? null,
          speechAct: payload?.speech_act ?? null,
          contextRelation: payload?.context_relation ?? null,
          claimStrength: payload?.claim_strength ?? null,
          policyRelevance: payload?.policy_relevance ?? null,
          riskFamily: payload?.risk_family ?? null,
          evidenceSpans: (payload?.evidence_spans ?? []).map((span) => ({
            ...span,
            start: (primaryClaim?.start ?? 0) + span.start,
            end: (primaryClaim?.start ?? 0) + span.end,
          })),
          masked: run.masked,
        },
        feedback: {
          missedDetectionAvailable: !run.masked && exactEvidenceCount === 0,
          falsePositiveAvailable: !run.masked && exactEvidenceCount > 0,
        },
        hybrid: {
          status: scoring.status,
          score: scoring.finalScore,
          conflict: scoring.conflict,
          reason: documentDecisionReason(scoring),
        },
        uncertainty,
        novelty,
        notice: scoring.status === "no_match"
          ? "현재 규칙과 AI 문맥 분석에서 직접 위험 주장이 확인되지 않았습니다. 이는 자동 승인이나 안전 보장을 의미하지 않습니다."
          : "AI 분석은 담당자의 최종 검토를 돕는 보조 신호이며 자동 승인·자동 금지를 의미하지 않습니다.",
      });
  } catch (error) {
    console.error(
      "[RiskShield public analyze] request failed",
      error instanceof Error ? error.name : "unknown_error",
    );
    return json(
      { error: "analysis_unavailable", message: "분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      503,
    );
  }
}
