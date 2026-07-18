import fs from "node:fs/promises";
import path from "node:path";

import { analyzeText, parseCsv } from "../lib/riskshield.ts";
import {
  LiveInterpreter,
  combineHybrid,
  prepareInterpreterInput,
  validateInterpreterPayload,
} from "../lib/v0-4/interpreter.ts";
import {
  GEMMA_LIVE_PILOT_MODEL,
  GoogleGenAiProvider,
} from "../lib/v0-4/google-genai-provider.ts";

const root = path.resolve(import.meta.dirname, "..");
const artifactDirectory = path.join(root, "artifacts", "v0.4");
const progressPath = path.join(artifactDirectory, "gemma-live-pilot-progress.json");
const fiveResultsPath = path.join(artifactDirectory, "gemma-live-pilot-5-results.jsonl");
const sixtyResultsPath = path.join(artifactDirectory, "gemma-live-pilot-60-results.csv");
const repeatResultsPath = path.join(artifactDirectory, "gemma-live-pilot-repeat-results.jsonl");
const metricsPath = path.join(artifactDirectory, "gemma-live-pilot-metrics.json");
const snapshotPath = path.join(root, "artifacts", "v0.3-final", "postmerge-d1-snapshot.json");
const timeoutMs = 20_000;
const minimumCallIntervalMs = 8_000;
const resourceExhaustedRetryFloorMs = 90_000;
const resumeCheckOnly = process.argv.includes("--resume-check");
const targetedRepeatsEnabled = process.argv.includes("--targeted-repeats");
const domains = ["health", "finance", "education", "legal", "privacy", "general"];

const representativeCases = [
  {
    caseId: "PILOT5-DIRECT-HEALTH",
    domain: "health",
    text: "이 제품만 사용하면 부작용 없이 7일 만에 체중이 5kg 줄어듭니다.",
    expectedIntent: "direct_promotional",
    expectedSpeechAct: "claim",
  },
  {
    caseId: "PILOT5-DIRECT-PRIVACY",
    domain: "privacy",
    text: "지금 신청하면 상대방 몰래 위치를 실시간으로 추적할 수 있습니다.",
    expectedIntent: "direct_promotional",
    expectedSpeechAct: "claim",
  },
  {
    caseId: "PILOT5-WARNING-FINANCE",
    domain: "finance",
    text: "원금과 고수익을 보장한다는 투자 광고를 주의하세요.",
    expectedIntent: "contextual_only",
    expectedSpeechAct: "warning",
  },
  {
    caseId: "PILOT5-CRITICISM-EDUCATION",
    domain: "education",
    text: "누구나 합격한다고 장담하는 학원 광고는 과장된 주장입니다.",
    expectedIntent: "contextual_only",
    expectedSpeechAct: "criticism",
  },
  {
    caseId: "PILOT5-DIRECT-LEGAL",
    domain: "legal",
    text: "형사 사건을 맡기면 무조건 무죄 판결을 받아드립니다.",
    expectedIntent: "direct_promotional",
    expectedSpeechAct: "claim",
  },
];

function now() {
  return new Date().toISOString();
}

function secretSafeText(value, apiKey) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (apiKey && text.includes(apiKey)) throw new Error("비밀값이 산출물에 포함될 수 있어 기록을 중단했습니다.");
  return text;
}

async function safeWrite(filePath, value, apiKey) {
  const text = secretSafeText(value, apiKey);
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, text, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function writeProgress(progress, apiKey = "") {
  await safeWrite(progressPath, `${secretSafeText(progress, apiKey)}\n`, apiKey);
}

function isResourceExhausted(run) {
  return run.errors.some((error) => /RESOURCE_EXHAUSTED \(429\)/u.test(error));
}

function retryAfterSecondsFromRun(run) {
  for (const error of run.errors) {
    const match = /retry_after_seconds=(\d+)/u.exec(error);
    if (match) return Number(match[1]);
  }
  return null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function evidenceOffsetsValid(text, payload) {
  return payload.evidence_spans.every((span) =>
    Number.isInteger(span.start)
    && Number.isInteger(span.end)
    && span.start >= 0
    && span.end > span.start
    && text.slice(span.start, span.end) === span.text);
}

function resultRecord(caseInfo, run, hybrid = null) {
  return {
    case_id: caseInfo.caseId,
    input_hash: run.inputHash,
    domain: caseInfo.domain,
    expected_class: caseInfo.expectedClass ?? null,
    model: run.model,
    provider_id: run.providerId,
    ok: run.ok,
    schema_valid: run.schemaValid,
    timed_out: run.timedOut,
    errors: run.errors,
    latency_ms: run.latencyMs,
    token_usage: run.tokenUsage,
    payload: run.payload,
    hybrid: hybrid ? {
      status: hybrid.status,
      score: hybrid.score,
      conflict: hybrid.conflict,
      conflict_reasons: hybrid.conflictReasons,
    } : null,
  };
}

async function verifyFallbacks() {
  const text = "원금을 100% 보장합니다";
  const prepared = prepareInterpreterInput(text);
  const invalidPayload = {
    schema_version: "1.0.0",
    risk_intent: "direct_promotional",
    speech_act: "claim",
    claim_target: "finance",
    context_relation: "supports",
    actor: "advertiser",
    claim_strength: "absolute",
    confidence: 0.99,
    evidence_spans: [{ start: 0, end: 2, text: "불일치" }],
    policy_reason: "DIRECT_ABSOLUTE_CLAIM",
  };
  const strictValidation = validateInterpreterPayload(invalidPayload, prepared);
  const rules = analyzeText(text, []);
  const failingProvider = {
    id: "pilot-local-error-provider",
    async complete() { throw new Error("local synthetic provider failure"); },
  };
  const timeoutProvider = {
    id: "pilot-local-timeout-provider",
    async complete(request) {
      return await new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  };
  const [failureRun, timeoutRun] = await Promise.all([
    new LiveInterpreter(failingProvider, 50).interpret({ text }),
    new LiveInterpreter(timeoutProvider, 10).interpret({ text }),
  ]);
  return {
    strict_invalid_rejected: !strictValidation.success,
    strict_invalid_routes_review: combineHybrid(rules, {
      ...failureRun,
      errors: strictValidation.success ? [] : strictValidation.errors,
    }).status === "review",
    provider_error_routes_review: combineHybrid(rules, failureRun).status === "review",
    timeout_routes_review: timeoutRun.timedOut && combineHybrid(rules, timeoutRun).status === "review",
  };
}

function columns(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

async function csvRecords(relativePath) {
  const text = await fs.readFile(path.join(root, relativePath), "utf8");
  const [headers, ...rows] = parseCsv(text.replace(/^\uFEFF/u, ""));
  return { rows, column: columns(headers) };
}

function expectedClass(value) {
  if (["boundary", "review", "ambiguous"].includes(value)) return "ambiguous";
  if (["detect", "high", "risky"].includes(value)) return "risky";
  if (["no_match", "safe"].includes(value)) return "safe";
  return "invalid";
}

function normalizedDomain(value) {
  return value === "income" || value === "mixed" ? "general" : value;
}

async function loadEvaluationUniverse() {
  const [development, frozen, final50] = await Promise.all([
    csvRecords("artifacts/v0.3.1/development-cases.csv"),
    csvRecords("artifacts/v0.3-final/final-blind-cases.csv"),
    csvRecords("artifacts/v0.3.1-final/final-blind-cases.csv"),
  ]);
  const cases = [];
  for (const row of development.rows) {
    cases.push({
      caseId: `development60:${row[development.column.case_id]}`,
      dataset: "development60",
      domain: normalizedDomain(row[development.column.domain]),
      expectedClass: expectedClass(row[development.column.case_type]),
      text: row[development.column.original_text],
      annotatedSpeechAct: "",
    });
  }
  for (const row of frozen.rows) {
    cases.push({
      caseId: `frozen100:${row[frozen.column.case_id]}`,
      dataset: "frozen100",
      domain: normalizedDomain(row[frozen.column.domain]),
      expectedClass: expectedClass(row[frozen.column.expected_class]),
      text: row[frozen.column.original_text],
      annotatedSpeechAct: "",
    });
  }
  for (const row of final50.rows) {
    cases.push({
      caseId: `final50:${row[final50.column.case_id]}`,
      dataset: "final50",
      domain: normalizedDomain(row[final50.column.domain]),
      expectedClass: expectedClass(row[final50.column.expected_class]),
      text: row[final50.column.original_text],
      annotatedSpeechAct: row[final50.column.speech_act],
    });
  }
  return cases;
}

function selectSixty(universe) {
  const targets = { risky: 4, safe: 4, ambiguous: 2 };
  const selected = [];
  const usedText = new Set();
  for (const domain of domains) {
    for (const [label, count] of Object.entries(targets)) {
      const candidates = universe
        .filter((item) => item.domain === domain && item.expectedClass === label && !usedText.has(item.text))
        .sort((left, right) => left.caseId.localeCompare(right.caseId, "en"));
      if (candidates.length < count) {
        throw new Error(`${domain}/${label} 파일럿 사례가 부족합니다: ${candidates.length}/${count}`);
      }
      for (const item of candidates.slice(0, count)) {
        selected.push(item);
        usedText.add(item.text);
      }
    }
  }
  if (selected.length !== 60) throw new Error(`60건 선택 실패: ${selected.length}`);
  return selected;
}

function verdict(expected, status) {
  if (expected === "risky") return status !== "no_match" ? "PASS" : "FAIL";
  if (expected === "safe") return status === "no_match" ? "PASS" : "FAIL";
  return status !== "high" ? "PASS" : "FAIL";
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function computeMetrics(evaluated) {
  const risky = evaluated.filter((item) => item.caseInfo.expectedClass === "risky");
  const safe = evaluated.filter((item) => item.caseInfo.expectedClass === "safe");
  const warningCriticism = safe.filter((item) =>
    ["warning", "criticism"].includes(item.caseInfo.annotatedSpeechAct)
    || ["warning", "criticism"].includes(item.run.payload?.speech_act ?? ""));
  const safeFalsePositives = safe.filter((item) => item.hybrid.status !== "no_match");
  const warningCriticismHigh = warningCriticism.filter((item) => item.hybrid.status === "high");
  const perDomain = Object.fromEntries(domains.map((domain) => {
    const subset = risky.filter((item) => item.caseInfo.domain === domain);
    const detected = subset.filter((item) => item.hybrid.status !== "no_match").length;
    return [domain, { risky: subset.length, detected, detection_rate: ratio(detected, subset.length) }];
  }));
  const riskyRecall = ratio(risky.filter((item) => item.hybrid.status !== "no_match").length, risky.length);
  const safeFalsePositiveRate = ratio(safeFalsePositives.length, safe.length);
  const schemaSuccessRate = ratio(evaluated.filter((item) => item.run.schemaValid).length, evaluated.length);
  const reviewRate = ratio(evaluated.filter((item) => item.hybrid.status === "review").length, evaluated.length);
  const latencies = evaluated.map((item) => item.run.latencyMs).filter(Number.isFinite);
  const metrics = {
    evaluated_at: now(),
    model: GEMMA_LIVE_PILOT_MODEL,
    total: evaluated.length,
    composition: Object.fromEntries(["risky", "safe", "ambiguous"].map((label) => [
      label,
      evaluated.filter((item) => item.caseInfo.expectedClass === label).length,
    ])),
    risky_recall: riskyRecall,
    safe_false_positive_rate: safeFalsePositiveRate,
    review_rate: reviewRate,
    warning_criticism_high_false_positives: warningCriticismHigh.length,
    json_schema_success_rate: schemaSuccessRate,
    conflicts: evaluated.filter((item) => item.hybrid.conflict).map((item) => item.caseInfo.caseId),
    failures: evaluated.filter((item) => item.verdict === "FAIL").map((item) => item.caseInfo.caseId),
    per_domain: perDomain,
    latency_ms: {
      average: latencies.length === 0 ? 0 : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      p95: percentile(latencies, 0.95),
    },
  };
  const gates = {
    risky_recall_at_least_85: (riskyRecall ?? 0) >= 0.85,
    safe_false_positive_rate_at_most_5: (safeFalsePositiveRate ?? 1) <= 0.05,
    warning_criticism_high_false_positives_zero: warningCriticismHigh.length === 0,
    all_core_domains_at_least_60: Object.values(perDomain).every((item) => (item.detection_rate ?? 0) >= 0.6),
    json_schema_success_rate_at_least_99: (schemaSuccessRate ?? 0) >= 0.99,
  };
  const nearCriteria = (riskyRecall ?? 0) >= 0.8
    && (safeFalsePositiveRate ?? 1) <= 0.1
    && warningCriticismHigh.length <= 1
    && Object.values(perDomain).every((item) => (item.detection_rate ?? 0) >= 0.5)
    && (schemaSuccessRate ?? 0) >= 0.95;
  return { ...metrics, gates, gate_pass: Object.values(gates).every(Boolean), near_criteria: nearCriteria };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function evaluationCsv(evaluated) {
  const rows = [[
    "case_id", "dataset", "domain", "expected_class", "input_hash", "model", "schema_valid",
    "risk_intent", "speech_act", "context_relation", "claim_target", "confidence",
    "hybrid_status", "hybrid_score", "conflict", "verdict", "latency_ms", "timed_out", "errors",
  ]];
  for (const item of evaluated) {
    rows.push([
      item.caseInfo.caseId,
      item.caseInfo.dataset,
      item.caseInfo.domain,
      item.caseInfo.expectedClass,
      item.run.inputHash,
      item.run.model,
      item.run.schemaValid,
      item.run.payload?.risk_intent ?? "",
      item.run.payload?.speech_act ?? "",
      item.run.payload?.context_relation ?? "",
      item.run.payload?.claim_target ?? "",
      item.run.payload?.confidence ?? "",
      item.hybrid.status,
      item.hybrid.score,
      item.hybrid.conflict,
      item.verdict,
      item.run.latencyMs.toFixed(3),
      item.run.timedOut,
      item.run.errors.join("|"),
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

async function loadResumeState(selected, selectedSummary) {
  let savedProgress;
  try {
    savedProgress = JSON.parse(await fs.readFile(progressPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  if (savedProgress.status !== "STOPPED_RESOURCE_EXHAUSTED"
    && savedProgress.status !== "STOPPED_RESOURCE_EXHAUSTED_SECOND") return null;
  if (JSON.stringify(savedProgress.selected_sixty) !== JSON.stringify(selectedSummary)) {
    throw new Error("저장된 60건 선택 목록이 현재 동결 목록과 일치하지 않습니다.");
  }

  const fiveRecords = (await fs.readFile(fiveResultsPath, "utf8"))
    .trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  if (fiveRecords.length !== 5 || !fiveRecords.every((record) => record.pass === true)) {
    throw new Error("저장된 대표 5건 게이트가 완전 통과 상태가 아닙니다.");
  }

  const [headers, ...rows] = parseCsv(await fs.readFile(sixtyResultsPath, "utf8"));
  const column = columns(headers);
  const evaluated = [];
  let resourceExhaustedRows = 0;
  for (const row of rows) {
    if ((row[column.errors] ?? "").includes("RESOURCE_EXHAUSTED (429)")) {
      resourceExhaustedRows += 1;
      continue;
    }
    const caseInfo = selected[evaluated.length];
    if (!caseInfo || row[column.case_id] !== caseInfo.caseId) {
      throw new Error(`저장된 완료 사례 순서가 동결 목록과 다릅니다: ${row[column.case_id]}`);
    }
    const expectedHash = prepareInterpreterInput(caseInfo.text).inputHash;
    if (row[column.input_hash] !== expectedHash) {
      throw new Error(`저장된 완료 사례 해시가 다릅니다: ${caseInfo.caseId}`);
    }
    const payload = row[column.risk_intent]
      ? {
        risk_intent: row[column.risk_intent],
        speech_act: row[column.speech_act],
        context_relation: row[column.context_relation],
        claim_target: row[column.claim_target],
        confidence: Number(row[column.confidence]),
      }
      : null;
    const run = {
      inputHash: row[column.input_hash],
      model: row[column.model],
      schemaValid: row[column.schema_valid] === "true",
      payload,
      latencyMs: Number(row[column.latency_ms]),
      timedOut: row[column.timed_out] === "true",
      errors: row[column.errors] ? row[column.errors].split("|") : [],
    };
    const hybrid = {
      status: row[column.hybrid_status],
      score: Number(row[column.hybrid_score]),
      conflict: row[column.conflict] === "true",
    };
    evaluated.push({ caseInfo, run, hybrid, verdict: row[column.verdict] });
  }
  if (resourceExhaustedRows < 1) throw new Error("재개 상태에 RESOURCE_EXHAUSTED 행이 없습니다.");
  if (new Set(evaluated.map((item) => item.caseInfo.caseId)).size !== evaluated.length) {
    throw new Error("저장된 완료 사례에 중복 ID가 있습니다.");
  }
  return {
    savedProgress,
    fiveRecords,
    evaluated,
    priorAttempts: Number(savedProgress.external_calls_attempted ?? savedProgress.external_calls_completed ?? 0),
    priorResourceExhaustedRows: resourceExhaustedRows,
  };
}

async function verifySecretNotPersisted(apiKey) {
  if (!apiKey) return true;
  const candidatePaths = [progressPath, fiveResultsPath, sixtyResultsPath, repeatResultsPath, metricsPath];
  for (const filePath of candidatePaths) {
    try {
      if ((await fs.readFile(filePath, "utf8")).includes(apiKey)) return false;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return true;
}

await fs.mkdir(artifactDirectory, { recursive: true });
const fallbackChecks = await verifyFallbacks();
if (!Object.values(fallbackChecks).every(Boolean)) throw new Error("로컬 review 폴백 사전 검증에 실패했습니다.");
const universe = await loadEvaluationUniverse();
const selectedSixty = selectSixty(universe);
const selectedSixtySummary = selectedSixty.map((item) => ({
  case_id: item.caseId,
  input_hash: prepareInterpreterInput(item.text).inputHash,
  domain: item.domain,
  expected_class: item.expectedClass,
}));
const resumeState = await loadResumeState(selectedSixty, selectedSixtySummary);
if (resumeCheckOnly) {
  console.log(JSON.stringify({
    resumable: Boolean(resumeState),
    five_completed: resumeState?.fiveRecords.length ?? 0,
    sixty_completed: resumeState?.evaluated.length ?? 0,
    next_case_id: resumeState ? selectedSixty[resumeState.evaluated.length]?.caseId ?? null : null,
    prior_attempts: resumeState?.priorAttempts ?? 0,
    prior_resource_exhausted_rows: resumeState?.priorResourceExhaustedRows ?? 0,
  }, null, 2));
  process.exit(0);
}

const apiKey = process.env.RISKSHIELD_INTERPRETER_API_KEY ?? "";
if (!apiKey) {
  await writeProgress({
    schema_version: "1.0.0",
    model: GEMMA_LIVE_PILOT_MODEL,
    status: "BLOCKED_MISSING_API_KEY",
    external_calls_completed: 0,
    fallback_checks: fallbackChecks,
    selected_sixty: selectedSixtySummary,
    updated_at: now(),
  });
  console.error("Live pilot 중단: RISKSHIELD_INTERPRETER_API_KEY 환경 변수가 없습니다. 외부 호출 0건.");
  process.exit(2);
}

const snapshot = await fs.readFile(snapshotPath, "utf8").then(JSON.parse);
const interpreter = new LiveInterpreter(GoogleGenAiProvider.fromEnvironment(), timeoutMs);
if (resumeState) {
  const evaluated = [...resumeState.evaluated];
  const progress = {
    ...resumeState.savedProgress,
    status: "RUNNING_SIXTY_CASE_EVALUATION_RESUMED",
    external_calls_attempted: resumeState.priorAttempts,
    external_calls_completed: 5 + evaluated.length,
    five_completed: 5,
    sixty_completed: evaluated.length,
    repeat_completed: 0,
    resume_429_count: 0,
    prior_resource_exhausted_events: resumeState.priorResourceExhaustedRows,
    minimum_call_interval_ms: minimumCallIntervalMs,
    targeted_repeats_enabled: false,
    last_error: null,
    updated_at: now(),
  };
  await safeWrite(sixtyResultsPath, evaluationCsv(evaluated), apiKey);
  await writeProgress(progress, apiKey);

  let lastCallCompletedAt = 0;
  while (evaluated.length < selectedSixty.length) {
    if (lastCallCompletedAt > 0) {
      const remainingInterval = minimumCallIntervalMs - (Date.now() - lastCallCompletedAt);
      if (remainingInterval > 0) await delay(remainingInterval);
    }
    const caseInfo = selectedSixty[evaluated.length];
    const run = await interpreter.interpret({ text: caseInfo.text, domainHint: caseInfo.domain });
    lastCallCompletedAt = Date.now();
    progress.external_calls_attempted += 1;
    progress.updated_at = now();

    if (isResourceExhausted(run)) {
      progress.resume_429_count += 1;
      progress.last_error = "RESOURCE_EXHAUSTED (429)";
      progress.last_case_id = caseInfo.caseId;
      progress.retry_after_seconds_header = retryAfterSecondsFromRun(run);
      if (progress.resume_429_count >= 2) {
        progress.status = "STOPPED_RESOURCE_EXHAUSTED_SECOND";
        await writeProgress(progress, apiKey);
        console.error(`Live pilot 재개 중단: 두 번째 RESOURCE_EXHAUSTED. 완료 ${progress.sixty_completed}/60건.`);
        process.exit(3);
      }

      const retryAfterMs = (progress.retry_after_seconds_header ?? 0) * 1_000;
      const waitMs = Math.max(resourceExhaustedRetryFloorMs, retryAfterMs);
      progress.status = "WAITING_RESOURCE_EXHAUSTED_SINGLE_RETRY";
      progress.retry_wait_ms = waitMs;
      progress.retry_not_before = new Date(Date.now() + waitMs).toISOString();
      await writeProgress(progress, apiKey);
      console.error(`RESOURCE_EXHAUSTED: ${Math.ceil(waitMs / 1_000)}초 대기 후 한 번만 재개합니다.`);
      await delay(waitMs);
      progress.status = "RUNNING_SIXTY_CASE_EVALUATION_RESUMED";
      progress.updated_at = now();
      await writeProgress(progress, apiKey);
      lastCallCompletedAt = 0;
      continue;
    }

    const rules = analyzeText(caseInfo.text, snapshot.skills, { severityRules: snapshot.severityRules });
    const hybrid = combineHybrid(rules, run);
    evaluated.push({ caseInfo, run, hybrid, verdict: verdict(caseInfo.expectedClass, hybrid.status) });
    progress.external_calls_completed = 5 + evaluated.length;
    progress.sixty_completed = evaluated.length;
    progress.last_case_id = caseInfo.caseId;
    progress.last_error = run.errors.length > 0 ? run.errors.join(" | ") : null;
    progress.updated_at = now();
    await safeWrite(sixtyResultsPath, evaluationCsv(evaluated), apiKey);
    await writeProgress(progress, apiKey);
  }

  const metrics = computeMetrics(evaluated);
  await safeWrite(metricsPath, `${secretSafeText(metrics, apiKey)}\n`, apiKey);
  progress.secret_not_persisted = await verifySecretNotPersisted(apiKey);
  if (!progress.secret_not_persisted) throw new Error("비밀값 미노출 사후 검증에 실패했습니다.");
  progress.status = metrics.gate_pass ? "COMPLETED_GATE_PASS_NO_DEPLOY" : "COMPLETED_REVIEW_REQUIRED_NO_DEPLOY";
  progress.updated_at = now();
  await writeProgress(progress, apiKey);
  console.log(JSON.stringify({
    status: progress.status,
    model: GEMMA_LIVE_PILOT_MODEL,
    resumed_from_completed_sixty: resumeState.evaluated.length,
    external_calls_attempted: progress.external_calls_attempted,
    external_calls_completed: progress.external_calls_completed,
    five_gate_pass: true,
    sixty_metrics: metrics,
    targeted_repeat_calls: 0,
    secret_not_persisted: progress.secret_not_persisted,
  }, null, 2));
  if (!metrics.gate_pass) process.exitCode = 1;
} else {
const progress = {
  schema_version: "1.0.0",
  model: GEMMA_LIVE_PILOT_MODEL,
  status: "RUNNING_FIVE_CASE_GATE",
  external_calls_completed: 0,
  five_completed: 0,
  sixty_completed: 0,
  repeat_completed: 0,
  fallback_checks: fallbackChecks,
  selected_sixty: selectedSixtySummary,
  updated_at: now(),
};
await writeProgress(progress, apiKey);

const fiveRecords = [];
for (const caseInfo of representativeCases) {
  const run = await interpreter.interpret({ text: caseInfo.text, domainHint: caseInfo.domain });
  progress.external_calls_completed += 1;
  progress.five_completed += 1;
  progress.updated_at = now();
  const offsetValid = Boolean(run.payload && evidenceOffsetsValid(caseInfo.text, run.payload));
  const modelCallSucceeded = run.model !== "unavailable" && run.tokenUsage !== null && !run.timedOut;
  const semanticPass = Boolean(run.payload
    && run.payload.risk_intent === caseInfo.expectedIntent
    && run.payload.speech_act === caseInfo.expectedSpeechAct);
  const record = {
    ...resultRecord(caseInfo, run),
    checks: {
      authentication_and_model_call: modelCallSucceeded,
      expected_korean_context: semanticPass,
      strict_json_validation: run.schemaValid,
      evidence_offsets: offsetValid,
      fallback_checks: fallbackChecks,
    },
    pass: modelCallSucceeded && run.ok && semanticPass && run.schemaValid && offsetValid
      && Object.values(fallbackChecks).every(Boolean),
  };
  fiveRecords.push(record);
  await Promise.all([
    safeWrite(fiveResultsPath, `${fiveRecords.map((item) => secretSafeText(JSON.stringify(item), apiKey)).join("\n")}\n`, apiKey),
    writeProgress(progress, apiKey),
  ]);
  if (isResourceExhausted(run)) {
    progress.status = "STOPPED_RESOURCE_EXHAUSTED";
    progress.updated_at = now();
    await writeProgress(progress, apiKey);
    console.error(`Live pilot 중단: RESOURCE_EXHAUSTED. 완료 호출 ${progress.external_calls_completed}건.`);
    process.exit(3);
  }
}

const fivePass = fiveRecords.length === 5 && fiveRecords.every((item) => item.pass);
if (!fivePass) {
  progress.status = "STOPPED_FIVE_CASE_GATE_FAILED";
  progress.updated_at = now();
  progress.secret_not_persisted = await verifySecretNotPersisted(apiKey);
  await writeProgress(progress, apiKey);
  console.error("Live pilot 중단: 대표 5건 게이트가 전부 통과하지 않았습니다. 60건 호출 0건.");
  process.exit(1);
}

progress.status = "RUNNING_SIXTY_CASE_EVALUATION";
progress.updated_at = now();
await writeProgress(progress, apiKey);
const evaluated = [];
for (const caseInfo of selectedSixty) {
  const rules = analyzeText(caseInfo.text, snapshot.skills, { severityRules: snapshot.severityRules });
  const run = await interpreter.interpret({ text: caseInfo.text, domainHint: caseInfo.domain });
  const hybrid = combineHybrid(rules, run);
  evaluated.push({ caseInfo, run, hybrid, verdict: verdict(caseInfo.expectedClass, hybrid.status) });
  progress.external_calls_completed += 1;
  progress.sixty_completed += 1;
  progress.updated_at = now();
  await Promise.all([
    safeWrite(sixtyResultsPath, evaluationCsv(evaluated), apiKey),
    writeProgress(progress, apiKey),
  ]);
  if (isResourceExhausted(run)) {
    progress.status = "STOPPED_RESOURCE_EXHAUSTED";
    progress.updated_at = now();
    await writeProgress(progress, apiKey);
    console.error(`Live pilot 중단: RESOURCE_EXHAUSTED. 완료 호출 ${progress.external_calls_completed}건.`);
    process.exit(3);
  }
}

const metrics = computeMetrics(evaluated);
await safeWrite(metricsPath, `${secretSafeText(metrics, apiKey)}\n`, apiKey);
const repeatCandidates = targetedRepeatsEnabled && metrics.near_criteria
  ? evaluated.filter((item) => item.verdict === "FAIL"
    || item.caseInfo.expectedClass === "ambiguous"
    || item.hybrid.conflict)
  : [];
const repeatRecords = [];
if (repeatCandidates.length > 0) {
  progress.status = "RUNNING_TARGETED_REPEATS";
  progress.repeat_candidates = repeatCandidates.map((item) => item.caseInfo.caseId);
  progress.updated_at = now();
  await writeProgress(progress, apiKey);
  for (const item of repeatCandidates) {
    for (let repeat = 2; repeat <= 3; repeat += 1) {
      const run = await interpreter.interpret({ text: item.caseInfo.text, domainHint: item.caseInfo.domain });
      const rules = analyzeText(item.caseInfo.text, snapshot.skills, { severityRules: snapshot.severityRules });
      const hybrid = combineHybrid(rules, run);
      repeatRecords.push({ repeat, ...resultRecord(item.caseInfo, run, hybrid) });
      progress.external_calls_completed += 1;
      progress.repeat_completed += 1;
      progress.updated_at = now();
      await Promise.all([
        safeWrite(repeatResultsPath, `${repeatRecords.map((record) => secretSafeText(JSON.stringify(record), apiKey)).join("\n")}\n`, apiKey),
        writeProgress(progress, apiKey),
      ]);
      if (isResourceExhausted(run)) {
        progress.status = "STOPPED_RESOURCE_EXHAUSTED";
        progress.updated_at = now();
        await writeProgress(progress, apiKey);
        console.error(`Live pilot 중단: RESOURCE_EXHAUSTED. 완료 호출 ${progress.external_calls_completed}건.`);
        process.exit(3);
      }
    }
  }
}

progress.secret_not_persisted = await verifySecretNotPersisted(apiKey);
if (!progress.secret_not_persisted) throw new Error("비밀값 미노출 사후 검증에 실패했습니다.");
progress.status = metrics.gate_pass ? "COMPLETED_GATE_PASS_NO_DEPLOY" : "COMPLETED_REVIEW_REQUIRED_NO_DEPLOY";
progress.updated_at = now();
await writeProgress(progress, apiKey);
console.log(JSON.stringify({
  status: progress.status,
  model: GEMMA_LIVE_PILOT_MODEL,
  external_calls_completed: progress.external_calls_completed,
  five_gate_pass: fivePass,
  sixty_metrics: metrics,
  targeted_repeat_cases: repeatCandidates.length,
  targeted_repeat_calls: repeatRecords.length,
  secret_not_persisted: progress.secret_not_persisted,
}, null, 2));
if (!metrics.gate_pass) process.exitCode = 1;
}
