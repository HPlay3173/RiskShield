import {
  DEFAULT_SEVERITY_RULES,
  analyzeText,
  parseSeverityRules,
  validateSkill,
  type AnalysisResult,
  type RiskSkill,
  type SeverityRules,
  starterSkills,
} from "../../../lib/riskshield";
import { GoogleGenAiProvider } from "../../../lib/v0-4/google-genai-provider";
import {
  INTERPRETER_PROMPT_VERSION,
  INTERPRETER_SCHEMA_VERSION,
  LiveInterpreter,
  combinePrivateBetaHybrid,
  hashInterpreterInput,
  prepareInterpreterInput,
  type ClaimTarget,
  type InterpreterRun,
} from "../../../lib/v0-4/interpreter";
import {
  INVALID_JSON_BODY,
  JSON_BODY_TOO_LARGE,
  readJsonValue,
} from "../../../lib/http/control-response";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_INPUT_CHARS = 2_000;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 256;
const BURST_WINDOW_MS = 60 * 1_000;
const BURST_LIMIT = 6;
const DAILY_REQUEST_LIMIT = 40;
const DAILY_PROVIDER_CALL_LIMIT = 250;
const MAX_RETRY_AFTER_SECONDS = 2;

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

type AbuseBucket = {
  day: string;
  dayCount: number;
  windowStartedAt: number;
  windowCount: number;
};

const verifiedResultCache = new Map<string, CacheEntry>();
const inFlightInterpreterRuns = new Map<string, Promise<InterpreterRun>>();
const abuseBuckets = new Map<string, AbuseBucket>();
let serialQueue: Promise<void> = Promise.resolve();
let providerBudget = { day: utcDay(), calls: 0 };

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

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const queued = serialQueue.then(task, task);
  serialQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function cacheKeyFor(text: string) {
  const prepared = prepareInterpreterInput(text, MAX_INPUT_CHARS);
  return hashInterpreterInput(
    `${INTERPRETER_SCHEMA_VERSION}:${INTERPRETER_PROMPT_VERSION}:${prepared.modelText}`,
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
      "SELECT payload FROM risk_skills WHERE review_status = 'reviewed' ORDER BY updated_at DESC",
    ).all<{ payload: string }>();
    return (rows.results ?? []).flatMap((row) => {
      try {
        const parsed = JSON.parse(row.payload) as unknown;
        if (!isRecord(parsed) || parsed.reviewStatus !== "reviewed") return [];
        const skill = parsed as unknown as RiskSkill;
        return validateSkill(skill).length === 0 ? [skill] : [];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (developmentRuleFallback(runtime)) {
      return starterSkills.filter(
        (skill) => skill.reviewStatus === "reviewed" && validateSkill(skill).length === 0,
      );
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

async function runInterpreter(text: string, domainHint: ClaimTarget | undefined, apiKey: string) {
  const interpreter = new LiveInterpreter(new GoogleGenAiProvider(apiKey));
  providerBudget.calls += 1;
  const run = await interpreter.interpret({ text, domainHint });
  if (!run.resourceExhausted) return run;
  if (
    run.retryAfterSeconds === null ||
    run.retryAfterSeconds === undefined ||
    run.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS ||
    !hasProviderBudget()
  ) {
    return run;
  }
  await new Promise((resolve) => setTimeout(resolve, run.retryAfterSeconds! * 1_000));
  providerBudget.calls += 1;
  return interpreter.interpret({ text, domainHint });
}

function runInterpreterOnce(
  key: string,
  text: string,
  domainHint: ClaimTarget | undefined,
  apiKey: string,
) {
  const existing = inFlightInterpreterRuns.get(key);
  if (existing) return existing;
  const pending = runInterpreter(text, domainHint, apiKey).finally(() => {
    inFlightInterpreterRuns.delete(key);
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

function hasProviderBudget() {
  const day = utcDay();
  if (providerBudget.day !== day) providerBudget = { day, calls: 0 };
  return providerBudget.calls < DAILY_PROVIDER_CALL_LIMIT;
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

async function enforceRateLimit(request: Request) {
  const key = await abuseKey(request);
  const now = Date.now();
  const day = utcDay();
  const current = abuseBuckets.get(key);
  const bucket: AbuseBucket = !current || current.day !== day
    ? { day, dayCount: 0, windowStartedAt: now, windowCount: 0 }
    : current;
  if (now - bucket.windowStartedAt >= BURST_WINDOW_MS) {
    bucket.windowStartedAt = now;
    bucket.windowCount = 0;
  }
  const burstBlocked = bucket.windowCount >= BURST_LIMIT;
  const dailyBlocked = bucket.dayCount >= DAILY_REQUEST_LIMIT;
  if (burstBlocked || dailyBlocked) {
    const retryAfter = burstBlocked
      ? Math.max(1, Math.ceil((bucket.windowStartedAt + BURST_WINDOW_MS - now) / 1_000))
      : Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00.000Z`) + 86_400_000 - now) / 1_000));
    return Response.json(
      { error: "rate_limited", message: "요청이 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "retry-after": String(retryAfter), "cache-control": "no-store" } },
    );
  }
  bucket.windowCount += 1;
  bucket.dayCount += 1;
  abuseBuckets.set(key, bucket);
  return null;
}

function unavailableRun(key: string, text: string): InterpreterRun {
  return {
    ok: false,
    payload: null,
    schemaValid: false,
    errors: ["server_secret_unavailable"],
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

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request);
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
    const runtime = await getRuntimeEnvironment();
    const apiKey = runtime.RISKSHIELD_INTERPRETER_API_KEY ?? "";
    return await enqueue(async () => {
      const [skills, severityRules] = await Promise.all([
        readReviewedSkills(runtime),
        readSeverityRules(runtime),
      ]);
      const rules = analyzeText(text, skills, { severityRules });
      const key = cacheKeyFor(text);
      let run = readCached(key);

      if (!run && apiKey && !hasProviderBudget()) {
        return json(
          { error: "daily_budget_exhausted", message: "오늘의 AI 분석 한도에 도달했습니다. 나중에 다시 시도해 주세요." },
          429,
          { "retry-after": "3600" },
        );
      }
      if (!run && apiKey) {
        run = await runInterpreterOnce(
          key,
          text,
          domainHintFor(rules.primaryMatch ? [rules.primaryMatch.skill] : []),
          apiKey,
        );
        writeCached(key, run);
      }
      run ??= unavailableRun(key, text);

      const hybrid = combinePrivateBetaHybrid(rules, run);
      const payload = run.payload;
      const uncertainty = !run.ok || hybrid.conflict || hybrid.status === "review"
        ? {
            level: "high" as const,
            reason: !run.ok
              ? "AI 문맥 해석을 사용할 수 없어 사람의 확인이 더 중요합니다."
              : "규칙과 문맥 신호가 충돌하거나 검토 경계에 있습니다.",
          }
        : hybrid.status === "no_match" || (payload?.confidence ?? 0) < 0.75
          ? {
              level: "medium" as const,
              reason: "직접 위험 근거가 없거나 문맥 신뢰도가 제한적입니다.",
            }
          : {
              level: "low" as const,
              reason: "규칙 근거와 문맥 신호가 같은 방향을 가리킵니다.",
            };
      const exactEvidenceCount = rules.primaryMatch?.hits.length ?? 0;
      const novelty = exactEvidenceCount > 0
        ? {
            state: "known_pattern" as const,
            label: "알려진 패턴과 연결",
            reason: "검토된 규칙의 정확한 evidence 구간이 있습니다.",
            candidateRegistration: "disabled" as const,
          }
        : hybrid.status === "no_match"
          ? {
              state: "possible_new_expression" as const,
              label: "새 표현일 수 있음",
              reason: "현재 검토 지식에서 직접 근거를 찾지 못했습니다. 이는 안전 판정이 아닙니다.",
              candidateRegistration: "disabled" as const,
            }
          : {
              state: "insufficient_evidence" as const,
              label: "근거 부족",
              reason: "신규성이나 기존 패턴 여부를 확정할 근거가 충분하지 않습니다.",
              candidateRegistration: "disabled" as const,
            };
      return json({
        beta: "RiskShield v0.5 public beta",
        profile: {
          id: profile,
          ...ANALYSIS_PROFILES[profile],
          kernel: "v4-compatibility",
        },
        rules: projectRules(rules, profile),
        ai: {
          state: run.ok ? "ready" : "fallback",
          confidence: payload?.confidence ?? null,
          riskIntent: payload?.risk_intent ?? null,
          speechAct: payload?.speech_act ?? null,
          contextRelation: payload?.context_relation ?? null,
          claimStrength: payload?.claim_strength ?? null,
          policyRelevance: payload?.policy_relevance ?? null,
          riskFamily: payload?.risk_family ?? null,
          evidenceSpans: payload?.evidence_spans ?? [],
          masked: run.masked,
        },
        hybrid: {
          status: hybrid.status,
          score: hybrid.score,
          conflict: hybrid.conflict,
          reason: hybrid.reason,
        },
        uncertainty,
        novelty,
        notice: hybrid.status === "no_match"
          ? "현재 규칙과 AI 문맥 분석에서 직접 위험 주장이 확인되지 않았습니다. 이는 자동 승인이나 안전 보장을 의미하지 않습니다."
          : "AI 분석은 담당자의 최종 검토를 돕는 보조 신호이며 자동 승인·자동 금지를 의미하지 않습니다.",
      });
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
