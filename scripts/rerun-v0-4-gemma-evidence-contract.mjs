import fs from "node:fs/promises";
import path from "node:path";

import { analyzeText, parseCsv } from "../lib/riskshield.ts";
import { LiveInterpreter, combineHybrid, prepareInterpreterInput } from "../lib/v0-4/interpreter.ts";
import { GEMMA_LIVE_PILOT_MODEL, GoogleGenAiProvider } from "../lib/v0-4/google-genai-provider.ts";

const root = path.resolve(import.meta.dirname, "..");
const artifactDirectory = path.join(root, "artifacts", "v0.4");
const baselinePath = path.join(artifactDirectory, "gemma-live-pilot-60-results.csv");
const progressPath = path.join(artifactDirectory, "gemma-evidence-contract-progress.json");
const rerunsPath = path.join(artifactDirectory, "gemma-evidence-contract-reruns.csv");
const adjustedPath = path.join(artifactDirectory, "gemma-evidence-contract-adjusted-60.csv");
const metricsPath = path.join(artifactDirectory, "gemma-evidence-contract-metrics.json");
const snapshotPath = path.join(root, "artifacts", "v0.3-final", "postmerge-d1-snapshot.json");
const minimumCallIntervalMs = 8_000;
const timeoutMs = 20_000;
const checkOnly = process.argv.includes("--check");
const recomputeOnly = process.argv.includes("--recompute-only");
const semanticCaseIds = [
  "development60:DEV016",
  "development60:DEV034",
  "development60:DEV047",
];

function now() {
  return new Date().toISOString();
}

function columns(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvText(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function csvRecords(relativePath) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  const [headers, ...rows] = parseCsv(source.replace(/^\uFEFF/u, ""));
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

async function loadCaseMap() {
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
    });
  }
  for (const row of frozen.rows) {
    cases.push({
      caseId: `frozen100:${row[frozen.column.case_id]}`,
      dataset: "frozen100",
      domain: normalizedDomain(row[frozen.column.domain]),
      expectedClass: expectedClass(row[frozen.column.expected_class]),
      text: row[frozen.column.original_text],
    });
  }
  for (const row of final50.rows) {
    cases.push({
      caseId: `final50:${row[final50.column.case_id]}`,
      dataset: "final50",
      domain: normalizedDomain(row[final50.column.domain]),
      expectedClass: expectedClass(row[final50.column.expected_class]),
      text: row[final50.column.original_text],
    });
  }
  return new Map(cases.map((item) => [item.caseId, item]));
}

function rowFor(headers, item) {
  const values = {
    case_id: item.caseInfo.caseId,
    dataset: item.caseInfo.dataset,
    domain: item.caseInfo.domain,
    expected_class: item.caseInfo.expectedClass,
    input_hash: item.run.inputHash,
    model: item.run.model,
    schema_valid: String(item.run.schemaValid),
    risk_intent: item.run.payload?.risk_intent ?? "",
    speech_act: item.run.payload?.speech_act ?? "",
    context_relation: item.run.payload?.context_relation ?? "",
    claim_target: item.run.payload?.claim_target ?? "",
    confidence: item.run.payload?.confidence ?? "",
    hybrid_status: item.hybrid.status,
    hybrid_score: item.hybrid.score,
    conflict: String(item.hybrid.conflict),
    verdict: item.verdict,
    latency_ms: item.run.latencyMs.toFixed(3),
    timed_out: String(item.run.timedOut),
    errors: item.run.errors.join("|"),
  };
  return headers.map((header) => values[header] ?? "");
}

function verdict(expected, status) {
  if (expected === "risky") return status !== "no_match" ? "PASS" : "FAIL";
  if (expected === "safe") return status === "no_match" ? "PASS" : "FAIL";
  return status !== "high" ? "PASS" : "FAIL";
}

function distribution(rows, column, expected, statuses) {
  const subset = rows.filter((row) => row[column.expected_class] === expected);
  return Object.fromEntries(statuses.map((status) => [
    status,
    subset.filter((row) => row[column.hybrid_status] === status).length,
  ]));
}

function buildMetrics(rerunRows, adjustedRows, baselineRows, column) {
  const risky = adjustedRows.filter((row) => row[column.expected_class] === "risky");
  const safe = adjustedRows.filter((row) => row[column.expected_class] === "safe");
  const jsonValid = adjustedRows.filter((row) => row[column.schema_valid] === "true").length;
  const riskyDetected = risky.filter((row) => row[column.hybrid_status] !== "no_match").length;
  const safeFalsePositives = safe.filter((row) => row[column.hybrid_status] !== "no_match").length;
  const semanticImprovements = semanticCaseIds.map((caseId) => {
    const before = baselineRows.find((row) => row[column.case_id] === caseId);
    const after = adjustedRows.find((row) => row[column.case_id] === caseId);
    return {
      case_id: caseId,
      before: { risk_intent: before[column.risk_intent], hybrid_status: before[column.hybrid_status] },
      after: { risk_intent: after[column.risk_intent], hybrid_status: after[column.hybrid_status] },
      improved: after[column.risk_intent] !== "direct_promotional" && after[column.hybrid_status] === "no_match",
    };
  });
  const latencies = rerunRows.map((row) => Number(row[column.latency_ms]));
  const jsonSuccessRate = jsonValid / adjustedRows.length;
  const riskyRecall = riskyDetected / risky.length;
  const safeFalsePositiveRate = safeFalsePositives / safe.length;
  const viableForFurtherPilot = jsonSuccessRate >= 0.95
    && riskyRecall >= 0.85
    && safeFalsePositiveRate <= 0.1
    && semanticImprovements.every((item) => item.improved);
  return {
    evaluated_at: now(),
    model: GEMMA_LIVE_PILOT_MODEL,
    claims_scope: "targeted evidence-contract rerun; no blind set, no repeated runs, no deploy approval",
    targeted: {
      total: rerunRows.length,
      schema_valid: rerunRows.filter((row) => row[column.schema_valid] === "true").length,
      average_latency_ms: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    },
    adjusted_sixty: {
      total: adjustedRows.length,
      json_valid: jsonValid,
      json_success_rate: jsonSuccessRate,
      risky_recall: riskyRecall,
      safe_false_positive_rate: safeFalsePositiveRate,
      risky_distribution: distribution(adjustedRows, column, "risky", ["high", "review", "attention", "no_match"]),
      safe_distribution: distribution(adjustedRows, column, "safe", ["no_match", "review", "high", "attention"]),
    },
    semantic_improvements: semanticImprovements,
    gemma_4_26b: {
      viable_for_further_pilot: viableForFurtherPilot,
      decision: viableForFurtherPilot ? "KEEP_FOR_FURTHER_PILOT_NO_DEPLOY" : "NOT_READY_REVIEW_REQUIRED_NO_DEPLOY",
      thresholds: {
        json_success_rate_at_least_95: jsonSuccessRate >= 0.95,
        risky_recall_at_least_85: riskyRecall >= 0.85,
        safe_false_positive_rate_at_most_10: safeFalsePositiveRate <= 0.1,
        semantic_cases_all_improved: semanticImprovements.every((item) => item.improved),
      },
    },
    repeated_runs: 0,
    new_blind_cases: 0,
  };
}

async function secretNotPersisted(apiKey) {
  if (!apiKey) return true;
  for (const filePath of [progressPath, rerunsPath, adjustedPath, metricsPath]) {
    try {
      if ((await fs.readFile(filePath, "utf8")).includes(apiKey)) return false;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return true;
}

await fs.mkdir(artifactDirectory, { recursive: true });
const [baselineSource, caseMap, snapshot] = await Promise.all([
  fs.readFile(baselinePath, "utf8"),
  loadCaseMap(),
  fs.readFile(snapshotPath, "utf8").then(JSON.parse),
]);
const [headers, ...baselineRows] = parseCsv(baselineSource);
const column = columns(headers);
if (baselineRows.length !== 60 || new Set(baselineRows.map((row) => row[column.case_id])).size !== 60) {
  throw new Error("기준 60건 CSV가 완전한 고유 사례 집합이 아닙니다.");
}
const invalidIds = baselineRows
  .filter((row) => row[column.schema_valid] !== "true")
  .map((row) => row[column.case_id]);
const targetIdSet = new Set([...invalidIds, ...semanticCaseIds]);
const targetCases = baselineRows
  .map((row) => caseMap.get(row[column.case_id]))
  .filter((item) => item && targetIdSet.has(item.caseId));
if (invalidIds.length !== 21 || targetIdSet.size !== 24 || targetCases.length !== 24) {
  throw new Error(`target freeze 실패: invalid=${invalidIds.length}, unique=${targetIdSet.size}, cases=${targetCases.length}`);
}
for (const caseInfo of targetCases) {
  const baseline = baselineRows.find((row) => row[column.case_id] === caseInfo.caseId);
  if (baseline[column.input_hash] !== prepareInterpreterInput(caseInfo.text).inputHash) {
    throw new Error(`target input hash 불일치: ${caseInfo.caseId}`);
  }
}

if (checkOnly) {
  console.log(JSON.stringify({
    invalid_targets: invalidIds.length,
    semantic_targets: semanticCaseIds.length,
    unique_targets: targetCases.length,
    target_ids: targetCases.map((item) => item.caseId),
  }, null, 2));
  process.exit(0);
}

if (recomputeOnly) {
  const apiKey = process.env.RISKSHIELD_INTERPRETER_API_KEY ?? "";
  if (!apiKey) throw new Error("RISKSHIELD_INTERPRETER_API_KEY 환경 변수가 필요합니다.");
  const [rerunsSource, adjustedSource, progressSource] = await Promise.all([
    fs.readFile(rerunsPath, "utf8"),
    fs.readFile(adjustedPath, "utf8"),
    fs.readFile(progressPath, "utf8"),
  ]);
  const [rerunHeaders, ...rerunRows] = parseCsv(rerunsSource);
  const [adjustedHeaders, ...adjustedRows] = parseCsv(adjustedSource);
  if (JSON.stringify(rerunHeaders) !== JSON.stringify(headers)
    || JSON.stringify(adjustedHeaders) !== JSON.stringify(headers)) {
    throw new Error("저장된 결과 CSV 헤더가 기준 60건 CSV와 일치하지 않습니다.");
  }
  if (rerunRows.length !== 24 || adjustedRows.length !== 60) {
    throw new Error(`저장된 결과 건수가 잘못되었습니다: reruns=${rerunRows.length}, adjusted=${adjustedRows.length}`);
  }
  const metrics = buildMetrics(rerunRows, adjustedRows, baselineRows, column);
  await safeWrite(metricsPath, `${secretSafeText(metrics, apiKey)}\n`, apiKey);
  const progress = JSON.parse(progressSource);
  progress.metrics_recomputed_at = now();
  progress.secret_not_persisted = await secretNotPersisted(apiKey);
  progress.updated_at = now();
  await safeWrite(progressPath, `${secretSafeText(progress, apiKey)}\n`, apiKey);
  console.log(JSON.stringify(metrics, null, 2));
  process.exit(0);
}

try {
  const existing = JSON.parse(await fs.readFile(progressPath, "utf8"));
  if (existing.calls_attempted > 0) {
    throw new Error("evidence-contract targeted 재실행이 이미 시작되어 중복 호출을 거부합니다.");
  }
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
}

const apiKey = process.env.RISKSHIELD_INTERPRETER_API_KEY ?? "";
if (!apiKey) throw new Error("RISKSHIELD_INTERPRETER_API_KEY 환경 변수가 필요합니다.");
const interpreter = new LiveInterpreter(GoogleGenAiProvider.fromEnvironment(), timeoutMs);
const progress = {
  schema_version: "1.0.0",
  model: GEMMA_LIVE_PILOT_MODEL,
  status: "RUNNING_EVIDENCE_CONTRACT_TARGETED",
  target_count: targetCases.length,
  calls_attempted: 0,
  calls_completed: 0,
  minimum_call_interval_ms: minimumCallIntervalMs,
  target_cases: targetCases.map((item) => ({
    case_id: item.caseId,
    input_hash: prepareInterpreterInput(item.text).inputHash,
    reason: invalidIds.includes(item.caseId) ? "baseline_schema_invalid" : "safe_semantic_misclassification",
  })),
  completed_case_ids: [],
  updated_at: now(),
};
await safeWrite(progressPath, `${secretSafeText(progress, apiKey)}\n`, apiKey);

const reruns = [];
const adjustedById = new Map(baselineRows.map((row) => [row[column.case_id], row]));
let lastCallCompletedAt = 0;
for (const caseInfo of targetCases) {
  if (lastCallCompletedAt > 0) {
    const waitMs = minimumCallIntervalMs - (Date.now() - lastCallCompletedAt);
    if (waitMs > 0) await delay(waitMs);
  }
  const rules = analyzeText(caseInfo.text, snapshot.skills, { severityRules: snapshot.severityRules });
  const run = await interpreter.interpret({ text: caseInfo.text, domainHint: caseInfo.domain });
  lastCallCompletedAt = Date.now();
  progress.calls_attempted += 1;
  progress.last_case_id = caseInfo.caseId;
  progress.updated_at = now();
  if (run.errors.some((error) => /RESOURCE_EXHAUSTED \(429\)/u.test(error))) {
    progress.status = "STOPPED_RESOURCE_EXHAUSTED";
    progress.last_error = "RESOURCE_EXHAUSTED (429)";
    await safeWrite(progressPath, `${secretSafeText(progress, apiKey)}\n`, apiKey);
    console.error(`evidence-contract targeted 중단: RESOURCE_EXHAUSTED, 완료 ${progress.calls_completed}/24건.`);
    process.exit(3);
  }
  const hybrid = combineHybrid(rules, run);
  const item = { caseInfo, run, hybrid, verdict: verdict(caseInfo.expectedClass, hybrid.status) };
  reruns.push(item);
  adjustedById.set(caseInfo.caseId, rowFor(headers, item));
  progress.calls_completed += 1;
  progress.completed_case_ids.push(caseInfo.caseId);
  progress.last_error = run.errors.length > 0 ? run.errors.join(" | ") : null;
  progress.updated_at = now();
  await safeWrite(rerunsPath, csvText([headers, ...reruns.map((record) => rowFor(headers, record))]), apiKey);
  await safeWrite(adjustedPath, csvText([headers, ...baselineRows.map((row) => adjustedById.get(row[column.case_id]))]), apiKey);
  await safeWrite(progressPath, `${secretSafeText(progress, apiKey)}\n`, apiKey);
}

const adjustedRows = baselineRows.map((row) => adjustedById.get(row[column.case_id]));
const risky = adjustedRows.filter((row) => row[column.expected_class] === "risky");
const safe = adjustedRows.filter((row) => row[column.expected_class] === "safe");
const jsonValid = adjustedRows.filter((row) => row[column.schema_valid] === "true").length;
const riskyDetected = risky.filter((row) => row[column.hybrid_status] !== "no_match").length;
const safeFalsePositives = safe.filter((row) => row[column.hybrid_status] !== "no_match").length;
const semanticImprovements = semanticCaseIds.map((caseId) => {
  const before = baselineRows.find((row) => row[column.case_id] === caseId);
  const after = adjustedById.get(caseId);
  return {
    case_id: caseId,
    before: { risk_intent: before[column.risk_intent], hybrid_status: before[column.hybrid_status] },
    after: { risk_intent: after[column.risk_intent], hybrid_status: after[column.hybrid_status] },
    improved: after[column.risk_intent] !== "direct_promotional" && after[column.hybrid_status] === "no_match",
  };
});
const latencies = reruns.map((item) => item.run.latencyMs);
const jsonSuccessRate = jsonValid / adjustedRows.length;
const riskyRecall = riskyDetected / risky.length;
const safeFalsePositiveRate = safeFalsePositives / safe.length;
const viableForFurtherPilot = jsonSuccessRate >= 0.95
  && riskyRecall >= 0.85
  && safeFalsePositiveRate <= 0.1
  && semanticImprovements.every((item) => item.improved);
const metrics = {
  evaluated_at: now(),
  model: GEMMA_LIVE_PILOT_MODEL,
  claims_scope: "targeted evidence-contract rerun; no blind set, no repeated runs, no deploy approval",
  targeted: {
    total: reruns.length,
    schema_valid: reruns.filter((item) => item.run.schemaValid).length,
    average_latency_ms: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
  },
  adjusted_sixty: {
    total: adjustedRows.length,
    json_valid: jsonValid,
    json_success_rate: jsonSuccessRate,
    risky_recall: riskyRecall,
    safe_false_positive_rate: safeFalsePositiveRate,
    risky_distribution: distribution(adjustedRows, column, "risky", ["high", "review", "attention", "no_match"]),
    safe_distribution: distribution(adjustedRows, column, "safe", ["no_match", "review", "high", "attention"]),
  },
  semantic_improvements: semanticImprovements,
  gemma_4_26b: {
    viable_for_further_pilot: viableForFurtherPilot,
    decision: viableForFurtherPilot ? "KEEP_FOR_FURTHER_PILOT_NO_DEPLOY" : "NOT_READY_REVIEW_REQUIRED_NO_DEPLOY",
    thresholds: {
      json_success_rate_at_least_95: jsonSuccessRate >= 0.95,
      risky_recall_at_least_85: riskyRecall >= 0.85,
      safe_false_positive_rate_at_most_10: safeFalsePositiveRate <= 0.1,
      semantic_cases_all_improved: semanticImprovements.every((item) => item.improved),
    },
  },
  repeated_runs: 0,
  new_blind_cases: 0,
};
await safeWrite(metricsPath, `${secretSafeText(metrics, apiKey)}\n`, apiKey);
progress.status = "COMPLETED_EVIDENCE_CONTRACT_TARGETED_NO_DEPLOY";
progress.secret_not_persisted = await secretNotPersisted(apiKey);
progress.updated_at = now();
await safeWrite(progressPath, `${secretSafeText(progress, apiKey)}\n`, apiKey);
console.log(JSON.stringify(metrics, null, 2));
