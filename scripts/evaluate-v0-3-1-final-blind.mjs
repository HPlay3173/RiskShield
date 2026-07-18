import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { analyzeText, parseCsv } from "../lib/riskshield.ts";

const root = path.resolve(import.meta.dirname, "..");
const casesPath = path.join(root, "artifacts", "v0.3.1-final", "final-blind-cases.csv");
const freezePath = path.join(root, "artifacts", "v0.3.1-final", "final-blind-freeze.json");
const snapshotPath = path.join(root, "artifacts", "v0.3-final", "postmerge-d1-snapshot.json");
const resultsPath = path.join(root, "artifacts", "v0.3.1-final", "final-blind-results.csv");
const metricsPath = path.join(root, "artifacts", "v0.3.1-final", "final-blind-metrics.json");
const coreDomains = ["health", "finance", "education", "legal", "general", "privacy"];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvText(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function columns(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

function stableResult(result) {
  return JSON.stringify({
    status: result.status,
    score: result.finalScore,
    primary: result.primaryMatch?.skill.id ?? "",
    matches: result.matches.map((match) => match.skill.id),
  });
}

async function listCsvFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "dist", ".vinext", ".wrangler"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (fullPath.includes(`${path.sep}artifacts${path.sep}computer-use-test`)) continue;
      files.push(...await listCsvFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".csv")) {
      files.push(fullPath);
    }
  }
  return files;
}

const [casesBuffer, freeze, snapshot] = await Promise.all([
  fs.readFile(casesPath),
  fs.readFile(freezePath, "utf8").then(JSON.parse),
  fs.readFile(snapshotPath, "utf8").then(JSON.parse),
]);
const casesSha256 = crypto.createHash("sha256").update(casesBuffer).digest("hex");
if (casesSha256 !== freeze.casesSha256) throw new Error("Final blind cases SHA-256 mismatch");
if (!freeze.labelsFrozenBeforeAnalyzerExecution || freeze.labelMutationAfterFreezeAllowed) {
  throw new Error("Final blind label freeze contract is invalid");
}

const [headers, ...rows] = parseCsv(casesBuffer.toString("utf8").replace(/^\uFEFF/u, ""));
const column = columns(headers);
if (rows.length !== 50) throw new Error(`Expected 50 final blind rows, got ${rows.length}`);
for (const required of [
  "case_id", "domain", "source_url", "original_text", "speech_act", "expected_class",
  "label_confidence", "label_frozen_at", "authoring_phase",
]) {
  if (!(required in column)) throw new Error(`Missing final blind column: ${required}`);
}

const composition = Object.fromEntries(["risky", "safe", "ambiguous"].map((label) => [
  label,
  rows.filter((row) => row[column.expected_class] === label).length,
]));
if (composition.risky !== 20 || composition.safe !== 20 || composition.ambiguous !== 10) {
  throw new Error(`Unexpected final blind composition: ${JSON.stringify(composition)}`);
}
const uniqueUrls = new Set(rows.map((row) => row[column.source_url]));
if (uniqueUrls.size < 25) throw new Error(`Expected at least 25 public URLs, got ${uniqueUrls.size}`);
if (rows.some((row) => row[column.authoring_phase] !== freeze.authoringPhase)) {
  throw new Error("Final blind authoring phase differs from freeze metadata");
}
if (rows.some((row) => row[column.label_frozen_at] !== freeze.frozenAt)) {
  throw new Error("Final blind label timestamp differs from freeze metadata");
}

const newTexts = new Set(rows.map((row) => row[column.original_text]));
if (newTexts.size !== rows.length) throw new Error("Duplicate text exists inside final blind cases");
const newCaseIds = new Set(rows.map((row) => row[column.case_id]));
if (newCaseIds.size !== rows.length) throw new Error("Duplicate case id exists inside final blind cases");

const priorUrls = new Set();
const priorTexts = new Set();
for (const csvPath of await listCsvFiles(root)) {
  if ([casesPath, resultsPath].includes(csvPath)) continue;
  const csv = await fs.readFile(csvPath, "utf8");
  const [priorHeaders, ...priorRows] = parseCsv(csv.replace(/^\uFEFF/u, ""));
  const priorColumn = columns(priorHeaders);
  for (const row of priorRows) {
    for (const header of priorHeaders) {
      const value = row[priorColumn[header]]?.trim();
      if (!value) continue;
      if (/(^|_)url$/u.test(header)) priorUrls.add(value);
      if (["original_text", "input", "input_text"].includes(header)) priorTexts.add(value);
    }
  }
}
const priorUrlOverlap = rows.filter((row) => priorUrls.has(row[column.source_url]));
const priorTextOverlap = rows.filter((row) => priorTexts.has(row[column.original_text]));
if (priorUrlOverlap.length !== 0 || priorTextOverlap.length !== 0) {
  throw new Error(`Final blind overlap detected: urls=${priorUrlOverlap.length}, texts=${priorTextOverlap.length}`);
}

const evaluate = (input) => {
  const runs = [0, 1, 2].map(() => analyzeText(input, snapshot.skills, { severityRules: snapshot.severityRules }));
  return {
    result: runs[0],
    repeatConsistent: runs.every((run) => stableResult(run) === stableResult(runs[0])),
  };
};

const evaluated = rows.map((row) => ({ row, ...evaluate(row[column.original_text]) }));
const risky = evaluated.filter(({ row }) => row[column.expected_class] === "risky");
const safe = evaluated.filter(({ row }) => row[column.expected_class] === "safe");
const ambiguous = evaluated.filter(({ row }) => row[column.expected_class] === "ambiguous");
const riskyMisses = risky.filter(({ result }) => result.status === "no_match");
const safeFalsePositives = safe.filter(({ result }) => result.status !== "no_match");
const warningCriticismHighFalsePositives = safe.filter(({ row, result }) =>
  ["warning", "criticism"].includes(row[column.speech_act]) && result.status === "high");
const repeatInconsistencies = evaluated.filter(({ repeatConsistent }) => !repeatConsistent);
const perDomain = Object.fromEntries(coreDomains.map((domain) => {
  const records = risky.filter(({ row }) => row[column.domain] === domain);
  const detected = records.filter(({ result }) => result.status !== "no_match").length;
  return [domain, {
    risky: records.length,
    detected,
    detectionRate: records.length === 0 ? null : detected / records.length,
  }];
}));

const riskyRecall = (risky.length - riskyMisses.length) / risky.length;
const safeFalsePositiveRate = safeFalsePositives.length / safe.length;
const allCoreDomainsAtLeast60 = Object.values(perDomain).every(({ detectionRate }) =>
  detectionRate !== null && detectionRate >= 0.6);
const automatedGatePass = riskyRecall >= 0.85
  && safeFalsePositiveRate <= 0.05
  && warningCriticismHighFalsePositives.length === 0
  && allCoreDomainsAtLeast60
  && repeatInconsistencies.length === 0
  && priorUrlOverlap.length === 0
  && priorTextOverlap.length === 0;
const uiCriticalErrors = process.env.RISKSHIELD_UI_CRITICAL_ERRORS === undefined
  ? null
  : Number(process.env.RISKSHIELD_UI_CRITICAL_ERRORS);
if (uiCriticalErrors !== null && (!Number.isInteger(uiCriticalErrors) || uiCriticalErrors < 0)) {
  throw new Error("RISKSHIELD_UI_CRITICAL_ERRORS must be a non-negative integer");
}
const uiNonCriticalConsoleErrors = process.env.RISKSHIELD_UI_NONCRITICAL_CONSOLE_ERRORS === undefined
  ? null
  : Number(process.env.RISKSHIELD_UI_NONCRITICAL_CONSOLE_ERRORS);
if (uiNonCriticalConsoleErrors !== null
  && (!Number.isInteger(uiNonCriticalConsoleErrors) || uiNonCriticalConsoleErrors < 0)) {
  throw new Error("RISKSHIELD_UI_NONCRITICAL_CONSOLE_ERRORS must be a non-negative integer");
}
const finalGate = uiCriticalErrors === null
  ? "PENDING_UI"
  : automatedGatePass && uiCriticalErrors === 0 ? "PASS" : "FAIL";

const resultHeaders = [
  ...headers,
  "actual_status",
  "actual_score",
  "primary_skill_id",
  "matched_skill_ids",
  "repeat_consistent",
  "class_gate_result",
];
const resultRows = [resultHeaders, ...evaluated.map(({ row, result, repeatConsistent }) => {
  const expectedClass = row[column.expected_class];
  const classGateResult = expectedClass === "risky"
    ? result.status !== "no_match" ? "PASS" : "FAIL"
    : expectedClass === "safe"
      ? result.status === "no_match" ? "PASS" : "FAIL"
      : "NOT_GATED";
  return [
    ...row,
    result.status,
    result.finalScore,
    result.primaryMatch?.skill.id ?? "",
    result.matches.map((match) => match.skill.id).join("|"),
    repeatConsistent ? "PASS" : "FAIL",
    classGateResult,
  ];
})];

const metrics = {
  schemaVersion: "1.0.0",
  release: "v0.3.1-final-blind",
  evaluatedAt: new Date().toISOString(),
  sourceCommit: "439e306b2adfd5051beaa7bea8ae22abb4a1a4de",
  casesSha256,
  labelFreezeVerified: true,
  composition,
  total: evaluated.length,
  uniquePublicUrlCount: uniqueUrls.size,
  priorEvaluationExactUrlOverlap: priorUrlOverlap.length,
  priorEvaluationExactTextOverlap: priorTextOverlap.length,
  risky: {
    total: risky.length,
    detected: risky.length - riskyMisses.length,
    recall: riskyRecall,
    missCaseIds: riskyMisses.map(({ row }) => row[column.case_id]),
  },
  safe: {
    total: safe.length,
    falsePositives: safeFalsePositives.length,
    falsePositiveRate: safeFalsePositiveRate,
    falsePositiveCaseIds: safeFalsePositives.map(({ row }) => row[column.case_id]),
    warningCriticismHighFalsePositives: warningCriticismHighFalsePositives.length,
    warningCriticismHighFalsePositiveCaseIds: warningCriticismHighFalsePositives.map(({ row }) => row[column.case_id]),
  },
  ambiguous: {
    total: ambiguous.length,
    noMatch: ambiguous.filter(({ result }) => result.status === "no_match").length,
    review: ambiguous.filter(({ result }) => result.status === "review").length,
    high: ambiguous.filter(({ result }) => result.status === "high").length,
  },
  perDomain,
  repeatInconsistencies: repeatInconsistencies.length,
  repeatInconsistencyCaseIds: repeatInconsistencies.map(({ row }) => row[column.case_id]),
  uiCriticalErrors,
  uiNonCriticalConsoleErrors,
  gates: {
    riskyRecallAtLeast85: riskyRecall >= 0.85,
    safeFalsePositiveRateAtMost5: safeFalsePositiveRate <= 0.05,
    warningCriticismHighFalsePositivesZero: warningCriticismHighFalsePositives.length === 0,
    allCoreDomainsAtLeast60,
    repeatInconsistenciesZero: repeatInconsistencies.length === 0,
    uiCriticalErrorsZero: uiCriticalErrors === null ? null : uiCriticalErrors === 0,
  },
  automatedGate: automatedGatePass ? "PASS" : "FAIL",
  finalGate,
};

await Promise.all([
  fs.writeFile(resultsPath, csvText(resultRows), "utf8"),
  fs.writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8"),
]);
console.log(JSON.stringify(metrics, null, 2));
if (finalGate === "FAIL" || (finalGate === "PENDING_UI" && !automatedGatePass)) process.exitCode = 1;
