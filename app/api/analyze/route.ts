import {
  DEFAULT_SEVERITY_RULES,
  analyzeText,
  parseSeverityRules,
  validateSkill,
  type RiskSkill,
  type SeverityRules,
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

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_INPUT_CHARS = 2_000;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 256;

type CacheEntry = {
  expiresAt: number;
  run: InterpreterRun;
};

const verifiedResultCache = new Map<string, CacheEntry>();
let serialQueue: Promise<void> = Promise.resolve();
const operationalMetrics = { providerCalls: 0, resourceExhausted: 0 };

async function getRuntimeEnvironment() {
  const { env } = await import("cloudflare:workers");
  return env as typeof env & { RISKSHIELD_INTERPRETER_API_KEY?: string };
}

type RuntimeEnvironment = Awaited<ReturnType<typeof getRuntimeEnvironment>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const queued = serialQueue.then(task, task);
  serialQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function cacheKeyFor(text: string) {
  const prepared = prepareInterpreterInput(text, MAX_INPUT_CHARS);
  const normalizedMaskedInput = prepared.modelText;
  return hashInterpreterInput(`${INTERPRETER_SCHEMA_VERSION}:${INTERPRETER_PROMPT_VERSION}:${normalizedMaskedInput}`);
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
}

async function readSeverityRules(runtime: RuntimeEnvironment): Promise<SeverityRules> {
  if (!runtime.DB) return DEFAULT_SEVERITY_RULES;
  const row = await runtime.DB.prepare(
    "SELECT payload FROM riskshield_settings WHERE key = 'severity_rules'",
  ).first<{ payload?: string }>();
  if (!row?.payload) return DEFAULT_SEVERITY_RULES;
  const parsed = parseSeverityRules(row.payload);
  return parsed.issues.length === 0 ? parsed.rules : DEFAULT_SEVERITY_RULES;
}

function fallbackKind(run: InterpreterRun) {
  if (run.timedOut) return "timeout" as const;
  if (run.resourceExhausted) return "resource_exhausted" as const;
  if (!run.schemaValid && run.validationMs > 0) return "validation" as const;
  return "provider_error" as const;
}

function providerStatus(run: InterpreterRun, cacheHit: boolean) {
  if (cacheHit) return "cached" as const;
  if (run.ok) return "ready" as const;
  if (run.timedOut) return "timeout" as const;
  if (run.resourceExhausted) return "resource_exhausted" as const;
  if (run.errors.includes("server_secret_unavailable")) return "secret_unavailable" as const;
  if (run.validationMs > 0) return "validation_error" as const;
  return "provider_error" as const;
}

async function runInterpreter(text: string, domainHint: ClaimTarget | undefined, apiKey: string) {
  const interpreter = new LiveInterpreter(new GoogleGenAiProvider(apiKey));
  operationalMetrics.providerCalls += 1;
  let run = await interpreter.interpret({ text, domainHint });
  if (!run.resourceExhausted) return run;

  operationalMetrics.resourceExhausted += 1;
  if (run.retryAfterSeconds === null || run.retryAfterSeconds === undefined) return run;
  await new Promise((resolve) => setTimeout(resolve, run.retryAfterSeconds! * 1_000));
  operationalMetrics.providerCalls += 1;
  run = await interpreter.interpret({ text, domainHint });
  if (run.resourceExhausted) operationalMetrics.resourceExhausted += 1;
  return run;
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

export async function POST(request: Request) {
  const routeStartedAt = performance.now();
  if (!request.headers.get("content-type")?.toLocaleLowerCase().includes("application/json")) {
    return Response.json({ error: "JSON 요청이 필요합니다." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "분석 문구가 너무 깁니다." }, { status: 413 });
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: "분석 문구가 너무 깁니다." }, { status: 413 });
    }
    body = JSON.parse(raw) as unknown;
  } catch {
    return Response.json({ error: "올바른 JSON 요청이 필요합니다." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: "분석할 문구가 필요합니다." }, { status: 400 });
  }
  if (body.text.length > MAX_INPUT_CHARS) {
    return Response.json({ error: `분석 문구는 ${MAX_INPUT_CHARS.toLocaleString("ko-KR")}자 이하여야 합니다.` }, { status: 413 });
  }

  const text = body.text.trim();
  const runtime = await getRuntimeEnvironment();
  const apiKey = runtime.RISKSHIELD_INTERPRETER_API_KEY ?? "";

  return enqueue(async () => {
    const [skills, severityRules] = await Promise.all([
      readReviewedSkills(runtime),
      readSeverityRules(runtime),
    ]);
    const rulesStartedAt = performance.now();
    const rules = analyzeText(text, skills, { severityRules });
    const ruleAnalysisMs = performance.now() - rulesStartedAt;
    const key = cacheKeyFor(text);
    let run = readCached(key);
    const cacheHit = Boolean(run);

    if (!run && apiKey) {
      run = await runInterpreter(text, domainHintFor(rules.primaryMatch ? [rules.primaryMatch.skill] : []), apiKey);
      writeCached(key, run);
    }
    if (!run) {
      run = {
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

    const hybrid = combinePrivateBetaHybrid(rules, run);
    const payload = run.payload;
    const routeTotalMs = performance.now() - routeStartedAt;
    return Response.json({
      beta: "RiskShield v0.4.1 AI-assisted private beta",
      rules,
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
        cached: cacheHit,
        latencyMs: Math.round(run.latencyMs),
        fallbackKind: run.ok ? null : fallbackKind(run),
        providerStatus: providerStatus(run, cacheHit),
        timing: {
          routeTotalMs: Math.round(routeTotalMs),
          providerRequestMs: Math.round(run.providerRequestMs),
          validationMs: Math.round(run.validationMs),
          ruleAnalysisMs: Math.round(ruleAnalysisMs),
          cacheStatus: cacheHit ? "hit" : "miss",
          timeoutStage: run.timeoutStage,
        },
      },
      hybrid,
      notice: hybrid.status === "no_match"
        ? "현재 규칙과 AI 문맥 분석에서 직접 위험 주장이 확인되지 않았습니다. 이는 자동 승인이나 안전 보장을 의미하지 않습니다."
        : "AI 분석은 담당자의 최종 검토를 돕는 보조 신호이며 자동 승인·자동 금지를 의미하지 않습니다.",
      cachePolicy: { ttlSeconds: CACHE_TTL_MS / 1_000, storesOriginalText: false },
    });
  });
}
