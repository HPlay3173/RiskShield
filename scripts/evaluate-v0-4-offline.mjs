import fs from "node:fs/promises";
import path from "node:path";

import { analyzeText, parseCsv } from "../lib/riskshield.ts";
import {
  LiveInterpreter,
  MockInterpreter,
  RecordedInterpreter,
  combineHybrid,
  interpreterOnlyStatus,
  toRecordedInterpreterRecord,
} from "../lib/v0-4/interpreter.ts";
import { OpenAiCompatibleProvider } from "../lib/v0-4/openai-compatible-provider.ts";

const root = path.resolve(import.meta.dirname, "..");
const artifactDirectory = path.join(root, "artifacts", "v0.4");
const recordingsPath = path.join(artifactDirectory, "recorded-interpreter-responses.jsonl");
const resultsPath = path.join(artifactDirectory, "hybrid-evaluation-results.csv");
const metricsPath = path.join(artifactDirectory, "hybrid-metrics.json");
const snapshotPath = path.join(root, "artifacts", "v0.3-final", "postmerge-d1-snapshot.json");
const refreshRecordings = process.argv.includes("--refresh-recordings");
const liveMode = process.argv.includes("--live");
if (refreshRecordings && liveMode) throw new Error("--refresh-recordings와 --live는 함께 사용할 수 없습니다.");
const coreDomains = ["health", "finance", "education", "legal", "privacy", "general"];

function columns(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

async function csvRecords(relativePath) {
  const text = await fs.readFile(path.join(root, relativePath), "utf8");
  const [headers, ...rows] = parseCsv(text.replace(/^\uFEFF/u, ""));
  return { headers, rows, column: columns(headers) };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvText(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function normalizeExpected(value) {
  if (value === "boundary" || value === "review") return "ambiguous";
  if (value === "detect" || value === "high") return "risky";
  if (value === "no_match") return "safe";
  if (value === "error") return "invalid";
  return value;
}

function domainFromCategory(value) {
  const text = String(value ?? "").toLocaleLowerCase("ko-KR");
  if (/(privacy|개인정보|위치|사생활)/u.test(text)) return "privacy";
  if (/(legal|법률|전문서비스)/u.test(text)) return "legal";
  if (/(education|교육|입시|합격)/u.test(text)) return "education";
  if (/(health|medical|의료|건강|body)/u.test(text)) return "health";
  if (/(finance|금융|투자)/u.test(text)) return "finance";
  if (/(general|income|urgency|평판|브랜드|구인|부업)/u.test(text)) return "general";
  return "unclassified";
}

function normalizedDomain(value) {
  if (coreDomains.includes(value)) return value;
  if (value === "income" || value === "mixed") return "general";
  return domainFromCategory(value);
}

async function loadCases() {
  const cases = [];

  const frozen = await csvRecords("artifacts/v0.3-final/final-blind-cases.csv");
  for (const row of frozen.rows) {
    cases.push({
      caseId: `frozen100:${row[frozen.column.case_id]}`,
      dataset: "frozen100",
      text: row[frozen.column.original_text],
      expectedClass: normalizeExpected(row[frozen.column.expected_class]),
      domain: normalizedDomain(row[frozen.column.domain]),
      annotatedSpeechAct: "",
    });
  }

  const development = await csvRecords("artifacts/v0.3.1/development-cases.csv");
  for (const row of development.rows) {
    cases.push({
      caseId: `development60:${row[development.column.case_id]}`,
      dataset: "development60",
      text: row[development.column.original_text],
      expectedClass: normalizeExpected(row[development.column.case_type]),
      domain: normalizedDomain(row[development.column.domain]),
      annotatedSpeechAct: "",
    });
  }

  const final50 = await csvRecords("artifacts/v0.3.1-final/final-blind-cases.csv");
  for (const row of final50.rows) {
    cases.push({
      caseId: `final50:${row[final50.column.case_id]}`,
      dataset: "final50",
      text: row[final50.column.original_text],
      expectedClass: normalizeExpected(row[final50.column.expected_class]),
      domain: normalizedDomain(row[final50.column.domain]),
      annotatedSpeechAct: row[final50.column.speech_act],
    });
  }

  const v01 = await csvRecords("tests/fixtures/test_cases_expected_behavior.csv");
  for (const [index, row] of v01.rows.entries()) {
    cases.push({
      caseId: `fixture-v0.1:V01-${String(index + 1).padStart(2, "0")}`,
      dataset: "fixture-v0.1",
      text: row[v01.column.input_text],
      expectedClass: "risky",
      domain: domainFromCategory(row[v01.column.expected_category]),
      annotatedSpeechAct: "",
    });
  }

  const v02 = await csvRecords("tests/fixtures/analyzer-v0.2-cases.csv");
  for (const row of v02.rows) {
    cases.push({
      caseId: `fixture-v0.2:${row[v02.column.test_id]}`,
      dataset: "fixture-v0.2",
      text: row[v02.column.input],
      expectedClass: normalizeExpected(row[v02.column.expectation]),
      domain: "unclassified",
      annotatedSpeechAct: "",
    });
  }

  const v03 = await csvRecords("tests/fixtures/analyzer-v0.3-generalization.csv");
  for (const row of v03.rows) {
    cases.push({
      caseId: `fixture-v0.3:${row[v03.column.test_id]}`,
      dataset: "fixture-v0.3",
      text: row[v03.column.input],
      expectedClass: normalizeExpected(row[v03.column.expected_status]),
      domain: domainFromCategory(row[v03.column.category]),
      annotatedSpeechAct: "",
    });
  }

  if (cases.length !== 364) throw new Error(`평가 자산 행 수가 364가 아닙니다: ${cases.length}`);
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) throw new Error("중복 case_id가 있습니다.");
  return cases;
}

async function buildRecordings(cases) {
  const mock = new MockInterpreter();
  const unique = new Map(cases.map((item) => [item.text, item]));
  const records = [];
  for (const { text } of unique.values()) {
    const run = await mock.interpret({ text });
    if (!run.ok || !run.payload) {
      throw new Error(`MockInterpreter가 유효한 응답을 만들지 못했습니다: ${run.errors.join(" ")}`);
    }
    records.push(toRecordedInterpreterRecord(run));
  }
  records.sort((left, right) => left.input_hash.localeCompare(right.input_hash, "en"));
  return records;
}

function stableInterpreter(run) {
  return JSON.stringify({
    ok: run.ok,
    payload: run.payload,
    schemaValid: run.schemaValid,
    errors: run.errors,
    timedOut: run.timedOut,
  });
}

function stableHybrid(decision) {
  return JSON.stringify({
    status: decision.status,
    score: decision.score,
    conflict: decision.conflict,
    reasons: decision.conflictReasons,
  });
}

function verdictFor(expectedClass, status) {
  if (expectedClass === "risky") return status !== "no_match" ? "PASS" : "FAIL";
  if (expectedClass === "safe") return status === "no_match" ? "PASS" : "FAIL";
  if (expectedClass === "ambiguous") return status !== "high" ? "PASS" : "FAIL";
  return ["no_match", "review"].includes(status) ? "PASS" : "FAIL";
}

function distribution(records, selector) {
  const values = ["no_match", "review", "attention", "high"];
  return Object.fromEntries(values.map((value) => [value, records.filter((item) => selector(item) === value).length]));
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function datasetMetrics(records) {
  const risky = records.filter((item) => item.case.expectedClass === "risky");
  const safe = records.filter((item) => item.case.expectedClass === "safe");
  return {
    total: records.length,
    composition: Object.fromEntries(["risky", "safe", "ambiguous", "invalid"].map((label) => [
      label,
      records.filter((item) => item.case.expectedClass === label).length,
    ])),
    rulesRiskyRecall: ratio(risky.filter((item) => item.rules.status !== "no_match").length, risky.length),
    rulesSafeFalsePositiveRate: ratio(safe.filter((item) => item.rules.status !== "no_match").length, safe.length),
    hybridRiskyRecall: ratio(risky.filter((item) => item.hybrid.status !== "no_match").length, risky.length),
    hybridSafeFalsePositiveRate: ratio(safe.filter((item) => item.hybrid.status !== "no_match").length, safe.length),
    hybridReviewRate: ratio(records.filter((item) => item.hybrid.status === "review").length, records.length),
    failures: records.filter((item) => item.verdict === "FAIL").map((item) => item.case.caseId),
  };
}

await fs.mkdir(artifactDirectory, { recursive: true });
const [cases, snapshot] = await Promise.all([
  loadCases(),
  fs.readFile(snapshotPath, "utf8").then(JSON.parse),
]);
if (snapshot.skills.filter((skill) => skill.reviewStatus === "reviewed").length !== 24) {
  throw new Error("운영 스냅샷의 reviewed skill 수가 24가 아닙니다.");
}

let records = [];
if (!liveMode) {
  try {
    const source = await fs.readFile(recordingsPath, "utf8");
    const recorded = RecordedInterpreter.fromJsonl(source);
    records = source.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
    if (refreshRecordings) records = await buildRecordings(cases);
    else {
      for (const item of cases) {
        const replay = await recorded.interpret({ text: item.text });
        if (!replay.ok) throw new Error(`녹화 응답 누락 또는 오류: ${item.caseId}`);
      }
    }
  } catch (error) {
    if (!refreshRecordings && error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("녹화 응답이 없습니다. 최초 1회 --refresh-recordings로 생성하세요.");
    }
    if (!refreshRecordings) throw error;
    records = await buildRecordings(cases);
  }
}

if (refreshRecordings) {
  await fs.writeFile(recordingsPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

const interpreter = liveMode
  ? new LiveInterpreter(OpenAiCompatibleProvider.fromEnvironment())
  : new RecordedInterpreter(records);
const evaluated = [];
const liveRuns = [];
for (const item of cases) {
  const rules = analyzeText(item.text, snapshot.skills, { severityRules: snapshot.severityRules });
  const runs = await Promise.all([0, 1, 2].map(() => interpreter.interpret({ text: item.text })));
  const hybrids = runs.map((run) => combineHybrid(rules, run));
  const interpreterConsistent = runs.every((run) => stableInterpreter(run) === stableInterpreter(runs[0]));
  const hybridConsistent = hybrids.every((decision) => stableHybrid(decision) === stableHybrid(hybrids[0]));
  const interpreterStatus = interpreterOnlyStatus(runs[0]);
  const hybrid = hybrids[0];
  if (liveMode) {
    for (const [runIndex, run] of runs.entries()) {
      liveRuns.push({
        case_id: item.caseId,
        input_hash: run.inputHash,
        run: runIndex + 1,
        masked: run.masked,
        model: run.model,
        provider_id: run.providerId,
        prompt_version: run.promptVersion,
        schema_version: run.schemaVersion,
        latency_ms: run.latencyMs,
        estimated_cost: run.estimatedCost,
        token_usage: run.tokenUsage,
        schema_valid: run.schemaValid,
        timed_out: run.timedOut,
        errors: run.errors,
        response: run.payload,
        hybrid: hybrids[runIndex],
      });
    }
  }
  evaluated.push({
    case: item,
    rules,
    run: runs[0],
    interpreterStatus,
    hybrid,
    repeatConsistent: interpreterConsistent && hybridConsistent,
    verdict: verdictFor(item.expectedClass, hybrid.status),
  });
}

const risky = evaluated.filter((item) => item.case.expectedClass === "risky");
const safe = evaluated.filter((item) => item.case.expectedClass === "safe");
const warningCriticism = safe.filter((item) =>
  ["warning", "criticism"].includes(item.case.annotatedSpeechAct)
  || ["warning", "criticism"].includes(item.run.payload?.speech_act ?? ""));
const perDomain = Object.fromEntries(coreDomains.map((domain) => {
  const domainRisky = risky.filter((item) => item.case.domain === domain);
  const detected = domainRisky.filter((item) => item.hybrid.status !== "no_match").length;
  return [domain, {
    risky: domainRisky.length,
    detected,
    detectionRate: ratio(detected, domainRisky.length),
  }];
}));
const schemaSuccesses = evaluated.filter((item) => item.run.schemaValid).length;
const repeatInconsistencies = evaluated.filter((item) => !item.repeatConsistent);
const safeFalsePositives = safe.filter((item) => item.hybrid.status !== "no_match");
const warningCriticismHigh = warningCriticism.filter((item) => item.hybrid.status === "high");
const recovered = evaluated.filter((item) => item.hybrid.recoveredByInterpreter);
const conflicts = evaluated.filter((item) => item.hybrid.conflict);
const latencies = evaluated.map((item) => item.run.latencyMs);
const costs = evaluated.map((item) => item.run.estimatedCost);
const riskyRecall = ratio(risky.filter((item) => item.hybrid.status !== "no_match").length, risky.length);
const safeFalsePositiveRate = ratio(safeFalsePositives.length, safe.length);
const schemaSuccessRate = ratio(schemaSuccesses, evaluated.length);
const repeatMismatchRate = ratio(repeatInconsistencies.length, evaluated.length);
const allCoreDomainsAtLeast60 = Object.values(perDomain).every((item) =>
  item.detectionRate !== null && item.detectionRate >= 0.6);

const gates = {
  riskyRecallAtLeast85: (riskyRecall ?? 0) >= 0.85,
  safeFalsePositiveRateAtMost5: (safeFalsePositiveRate ?? 1) <= 0.05,
  warningCriticismHighFalsePositivesZero: warningCriticismHigh.length === 0,
  allCoreDomainsAtLeast60,
  jsonSchemaSuccessRateAtLeast99: (schemaSuccessRate ?? 0) >= 0.99,
  repeatFinalStatusMismatchAtMost1: (repeatMismatchRate ?? 1) <= 0.01,
  rulesNoMatchRiskRecovered: recovered.some((item) => item.case.expectedClass === "risky"),
};
const offlineGatePass = Object.values(gates).every(Boolean);

const headers = [
  "case_id",
  "expected_class",
  "rules_status",
  "rules_score",
  "rules_skill_ids",
  "interpreter_risk_intent",
  "interpreter_speech_act",
  "interpreter_context_relation",
  "interpreter_claim_target",
  "interpreter_confidence",
  "interpreter_schema_valid",
  "hybrid_status",
  "hybrid_score",
  "verdict",
  "latency_ms",
  "estimated_cost",
  "notes",
];
const resultRows = [headers, ...evaluated.map((item) => [
  item.case.caseId,
  item.case.expectedClass,
  item.rules.status,
  item.rules.finalScore,
  item.rules.matches.map((match) => match.skill.id).join("|"),
  item.run.payload?.risk_intent ?? "",
  item.run.payload?.speech_act ?? "",
  item.run.payload?.context_relation ?? "",
  item.run.payload?.claim_target ?? "",
  item.run.payload?.confidence ?? "",
  item.run.schemaValid ? "true" : "false",
  item.hybrid.status,
  item.hybrid.score,
  item.verdict,
  item.run.latencyMs.toFixed(3),
  item.run.estimatedCost.toFixed(8),
  [
    `dataset=${item.case.dataset}`,
    `domain=${item.case.domain}`,
    `input_hash=${item.run.inputHash}`,
    `masked=${item.run.masked}`,
    `conflict=${item.hybrid.conflict}`,
    `recovered=${item.hybrid.recoveredByInterpreter}`,
    `repeat_consistent=${item.repeatConsistent}`,
    `source=${liveMode ? "live_provider" : "recorded_from_deterministic_mock"}`,
  ].join(";"),
])];

const metrics = {
  schemaVersion: "1.0.0",
  prototype: "RiskShield-v0.4-offline-hybrid",
  evaluatedAt: new Date().toISOString(),
  sourceMode: liveMode ? "live_provider" : "recorded_from_deterministic_mock",
  liveInterpreterExecuted: liveMode,
  liveProviderConfigured: Boolean(
    process.env.RISKSHIELD_INTERPRETER_ENDPOINT
    && process.env.RISKSHIELD_INTERPRETER_API_KEY
    && process.env.RISKSHIELD_INTERPRETER_MODEL,
  ),
  claimsScope: liveMode
    ? "Live provider regression evaluation; not blind performance and not deploy approval"
    : "engineering regression only; not blind performance and not Live LLM quality",
  assets: {
    totalRows: evaluated.length,
    uniqueInputHashes: new Set(evaluated.map((item) => item.run.inputHash)).size,
    datasets: Object.fromEntries([...new Set(evaluated.map((item) => item.case.dataset))].map((dataset) => [
      dataset,
      datasetMetrics(evaluated.filter((item) => item.case.dataset === dataset)),
    ])),
  },
  composition: Object.fromEntries(["risky", "safe", "ambiguous", "invalid"].map((label) => [
    label,
    evaluated.filter((item) => item.case.expectedClass === label).length,
  ])),
  comparison: {
    rulesOnlyStatus: distribution(evaluated, (item) => item.rules.status),
    interpreterOnlyStatus: distribution(evaluated, (item) => item.interpreterStatus),
    hybridStatus: distribution(evaluated, (item) => item.hybrid.status),
  },
  risky: {
    total: risky.length,
    detected: risky.filter((item) => item.hybrid.status !== "no_match").length,
    recall: riskyRecall,
    missedCaseIds: risky.filter((item) => item.hybrid.status === "no_match").map((item) => item.case.caseId),
  },
  safe: {
    total: safe.length,
    falsePositives: safeFalsePositives.length,
    falsePositiveRate: safeFalsePositiveRate,
    falsePositiveCaseIds: safeFalsePositives.map((item) => item.case.caseId),
    warningCriticismCases: warningCriticism.length,
    warningCriticismHighFalsePositives: warningCriticismHigh.length,
    warningCriticismHighFalsePositiveCaseIds: warningCriticismHigh.map((item) => item.case.caseId),
  },
  perDomain,
  jsonSchema: {
    valid: schemaSuccesses,
    total: evaluated.length,
    successRate: schemaSuccessRate,
  },
  review: {
    count: evaluated.filter((item) => item.hybrid.status === "review").length,
    rate: ratio(evaluated.filter((item) => item.hybrid.status === "review").length, evaluated.length),
  },
  conflicts: {
    count: conflicts.length,
    rate: ratio(conflicts.length, evaluated.length),
    caseIds: conflicts.map((item) => item.case.caseId),
  },
  interpreterRecovery: {
    rulesNoMatchCandidatesFound: recovered.length,
    riskyRecoveredToReviewOrAbove: recovered.filter((item) => item.case.expectedClass === "risky").length,
    caseIds: recovered.map((item) => item.case.caseId),
  },
  performance: {
    averageLatencyMs: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    p95LatencyMs: percentile(latencies, 0.95),
    averageEstimatedCost: costs.reduce((sum, value) => sum + value, 0) / costs.length,
    timeoutRate: ratio(evaluated.filter((item) => item.run.timedOut).length, evaluated.length),
    measurementScope: liveMode
      ? "LiveInterpreter provider calls"
      : "RecordedInterpreter replaying deterministic MockInterpreter responses",
  },
  repetition: {
    runsPerInput: 3,
    inconsistentFinalStatuses: repeatInconsistencies.length,
    inconsistencyRate: repeatMismatchRate,
    caseIds: repeatInconsistencies.map((item) => item.case.caseId),
  },
  gates,
  offlineEngineeringGate: liveMode ? "NOT_APPLICABLE" : offlineGatePass ? "PASS" : "FAIL",
  liveSemanticGate: liveMode ? offlineGatePass ? "PASS" : "FAIL" : "NOT_RUN",
  finalDecision: liveMode
    ? offlineGatePass ? "LIVE_REGRESSION_PASS_NO_DEPLOY" : "FAIL_REVIEW_FIRST_NO_DEPLOY"
    : offlineGatePass ? "ENGINEERING_PASS_LIVE_UNVERIFIED_NO_DEPLOY" : "FAIL_REVIEW_FIRST_NO_DEPLOY",
};

const writes = [
  fs.writeFile(resultsPath, csvText(resultRows), "utf8"),
  fs.writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8"),
];
if (liveMode) {
  writes.push(fs.writeFile(
    path.join(artifactDirectory, "live-interpreter-runs.jsonl"),
    `${liveRuns.map((run) => JSON.stringify(run)).join("\n")}\n`,
    "utf8",
  ));
}
await Promise.all(writes);
console.log(JSON.stringify(metrics, null, 2));
if (!offlineGatePass) process.exitCode = 1;
