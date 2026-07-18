import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { analyzeText, parseCsv } from "../lib/riskshield.ts";

const root = path.resolve(import.meta.dirname, "..");
const frozenCasesPath = path.join(root, "artifacts", "v0.3-final", "final-blind-cases.csv");
const freezePath = path.join(root, "artifacts", "v0.3-final", "final-blind-freeze.json");
const snapshotPath = path.join(root, "artifacts", "v0.3-final", "postmerge-d1-snapshot.json");
const developmentCasesPath = path.join(root, "artifacts", "v0.3.1", "development-cases.csv");
const developmentResultsPath = path.join(root, "artifacts", "v0.3.1", "development-results.csv");
const metricsPath = path.join(root, "artifacts", "v0.3.1", "local-gate-metrics.json");

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

function parseRange(value) {
  const match = /^(\d+)-(\d+)$/u.exec(value);
  if (!match) throw new Error(`Invalid expected range: ${value}`);
  return { min: Number(match[1]), max: Number(match[2]) };
}

function stableResult(result) {
  return JSON.stringify({
    status: result.status,
    score: result.finalScore,
    primary: result.primaryMatch?.skill.id ?? "",
    matches: result.matches.map((match) => match.skill.id),
  });
}

const [freeze, snapshot, frozenBuffer, developmentBuffer] = await Promise.all([
  fs.readFile(freezePath, "utf8").then(JSON.parse),
  fs.readFile(snapshotPath, "utf8").then(JSON.parse),
  fs.readFile(frozenCasesPath),
  fs.readFile(developmentCasesPath),
]);
const frozenSha256 = crypto.createHash("sha256").update(frozenBuffer).digest("hex");
if (frozenSha256 !== freeze.casesSha256) throw new Error("Frozen 100 SHA-256 mismatch");
if (snapshot.skills.length !== 29) throw new Error(`Expected 29 D1 skills, got ${snapshot.skills.length}`);
if (snapshot.skills.filter((skill) => skill.reviewStatus === "reviewed").length !== 24) {
  throw new Error("Expected 24 reviewed D1 skills");
}

const [frozenHeaders, ...frozenRows] = parseCsv(frozenBuffer.toString("utf8").replace(/^\uFEFF/u, ""));
const frozenColumn = columns(frozenHeaders);
const [developmentHeaders, ...developmentRows] = parseCsv(developmentBuffer.toString("utf8").replace(/^\uFEFF/u, ""));
const developmentColumn = columns(developmentHeaders);
if (frozenRows.length !== 100) throw new Error(`Expected frozen 100, got ${frozenRows.length}`);
if (developmentRows.length !== 60) throw new Error(`Expected development 60, got ${developmentRows.length}`);

const evaluate = (input) => {
  const runs = [0, 1, 2].map(() => analyzeText(input, snapshot.skills, { severityRules: snapshot.severityRules }));
  return {
    result: runs[0],
    repeatConsistent: runs.every((run) => stableResult(run) === stableResult(runs[0])),
  };
};

const frozen = frozenRows.map((row) => ({ row, ...evaluate(row[frozenColumn.original_text]) }));
const development = developmentRows.map((row) => {
  const evaluated = evaluate(row[developmentColumn.original_text]);
  const range = parseRange(row[developmentColumn.expected_range]);
  const type = row[developmentColumn.case_type];
  const classPass = type === "risky"
    ? evaluated.result.status !== "no_match"
    : type === "safe"
      ? evaluated.result.status === "no_match"
      : evaluated.result.status !== "high";
  const rangePass = evaluated.result.finalScore >= range.min && evaluated.result.finalScore <= range.max;
  return { row, ...evaluated, classPass, rangePass, pass: classPass && rangePass && evaluated.repeatConsistent };
});

const risky = frozen.filter(({ row }) => row[frozenColumn.expected_class] === "risky");
const safe = frozen.filter(({ row }) => row[frozenColumn.expected_class] === "safe");
const highConfidenceRisky = risky.filter(({ row }) => row[frozenColumn.label_confidence] === "high");
const safeFalsePositives = safe.filter(({ result }) => result.status !== "no_match");
const safeHighFalsePositives = safe.filter(({ result }) => result.status === "high");
const perDomain = Object.fromEntries(["health", "finance", "education", "legal", "general", "privacy"].map((domain) => {
  const records = risky.filter(({ row }) => row[frozenColumn.domain] === domain);
  const detected = records.filter(({ result }) => result.status !== "no_match").length;
  return [domain, { risky: records.length, detected, detectionRate: detected / records.length }];
}));
const clearDevelopment = development.filter(({ row }) => row[developmentColumn.clarity] === "clear");
const frozenTexts = new Set(frozenRows.map((row) => row[frozenColumn.original_text]));
const exactOverlap = developmentRows.filter((row) => frozenTexts.has(row[developmentColumn.original_text]));
const reviewOnlyIds = new Set([
  "risk_v03_legal_substantiation",
  "risk_v03_general_substantiation",
  "risk_v03_general_urgency",
  "risk_v03_income_guarantee",
  "risk_v03_education_substantiation",
  "risk_v03_privacy_data_access_review",
]);
const reviewOnlyHighViolations = [...frozen, ...development].filter(({ result }) =>
  result.status === "high" && reviewOnlyIds.has(result.primaryMatch?.skill.id ?? ""));

const gates = {
  frozenHighConfidenceRiskyRecall: highConfidenceRisky.filter(({ result }) => result.status !== "no_match").length
    / highConfidenceRisky.length,
  frozenSafeFalsePositiveRate: safeFalsePositives.length / safe.length,
  prohibitionCriticismWarningHighFalsePositives: safeHighFalsePositives.length,
  allCoreDomainsAtLeast60: Object.values(perDomain).every(({ detectionRate }) => detectionRate >= 0.6),
  developmentClearPassRate: clearDevelopment.filter(({ pass }) => pass).length / clearDevelopment.length,
  repeatInconsistencies: [...frozen, ...development].filter(({ repeatConsistent }) => !repeatConsistent).length,
  reviewOnlyHighViolations: reviewOnlyHighViolations.length,
  exactFrozenDevelopmentOverlap: exactOverlap.length,
};
const localDeployGate = gates.frozenHighConfidenceRiskyRecall >= 0.85
  && gates.frozenSafeFalsePositiveRate <= 0.05
  && gates.prohibitionCriticismWarningHighFalsePositives === 0
  && gates.allCoreDomainsAtLeast60
  && gates.developmentClearPassRate >= 0.95
  && gates.repeatInconsistencies === 0
  && gates.reviewOnlyHighViolations === 0
  && gates.exactFrozenDevelopmentOverlap === 0;

const resultHeaders = [
  ...developmentHeaders,
  "actual_status",
  "actual_score",
  "primary_skill_id",
  "matched_skill_ids",
  "class_pass",
  "range_pass",
  "repeat_consistent",
  "verdict",
];
const resultRows = [resultHeaders, ...development.map(({ row, result, classPass, rangePass, repeatConsistent, pass }) => [
  ...row,
  result.status,
  result.finalScore,
  result.primaryMatch?.skill.id ?? "",
  result.matches.map((match) => match.skill.id).join("|"),
  classPass ? "PASS" : "FAIL",
  rangePass ? "PASS" : "FAIL",
  repeatConsistent ? "PASS" : "FAIL",
  pass ? "PASS" : "FAIL",
])];

const metrics = {
  schemaVersion: "1.0.0",
  release: "v0.3.1-local-remediation",
  evaluatedAt: new Date().toISOString(),
  frozenCasesSha256: frozenSha256,
  d1Contract: {
    totalSkills: snapshot.skills.length,
    reviewedSkills: snapshot.skills.filter((skill) => skill.reviewStatus === "reviewed").length,
    reviewOnlyRules: snapshot.skills.filter((skill) => reviewOnlyIds.has(skill.id)).map((skill) => ({
      id: skill.id,
      severityFloor: skill.severityFloor,
      dominantRisk: skill.dominantRisk,
    })),
  },
  frozen: {
    total: frozen.length,
    highConfidenceRisky: highConfidenceRisky.length,
    highConfidenceRiskyDetected: highConfidenceRisky.filter(({ result }) => result.status !== "no_match").length,
    safe: safe.length,
    safeFalsePositiveCaseIds: safeFalsePositives.map(({ row }) => row[frozenColumn.case_id]),
    safeHighFalsePositiveCaseIds: safeHighFalsePositives.map(({ row }) => row[frozenColumn.case_id]),
    perDomain,
  },
  development: {
    total: development.length,
    clear: clearDevelopment.length,
    clearPassed: clearDevelopment.filter(({ pass }) => pass).length,
    composition: Object.fromEntries(["risky", "safe", "boundary"].map((type) => [
      type,
      developmentRows.filter((row) => row[developmentColumn.case_type] === type).length,
    ])),
    failureCaseIds: development.filter(({ pass }) => !pass).map(({ row }) => row[developmentColumn.case_id]),
  },
  gates,
  localDeployGate: localDeployGate ? "PASS" : "FAIL",
};

await fs.mkdir(path.dirname(metricsPath), { recursive: true });
await fs.writeFile(developmentResultsPath, csvText(resultRows), "utf8");
await fs.writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
console.log(JSON.stringify(metrics, null, 2));
if (!localDeployGate) process.exitCode = 1;
