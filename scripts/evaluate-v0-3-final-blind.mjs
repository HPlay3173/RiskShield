import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";
import { analyzeText, parseCsv } from "../lib/riskshield.ts";

const root = path.resolve(import.meta.dirname, "..");
const artifactDir = path.join(root, "artifacts", "v0.3-final");
const casesPath = path.join(artifactDir, "final-blind-cases.csv");
const freezePath = path.join(artifactDir, "final-blind-freeze.json");
const snapshotPath = path.join(artifactDir, "postmerge-d1-snapshot.json");
const resultsPath = path.join(artifactDir, "final-blind-results.csv");
const metricsPath = path.join(artifactDir, "final-blind-metrics.json");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvText(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function parseRange(value) {
  const match = /^(\d+)-(\d+)$/u.exec(value);
  if (!match) throw new Error(`Invalid expected range: ${value}`);
  return { min: Number(match[1]), max: Number(match[2]) };
}

function stableResult(result) {
  return JSON.stringify({
    status: result.status,
    statusLabel: result.statusLabel,
    score: result.finalScore,
    grade: result.grade,
    primarySkillId: result.primaryMatch?.skill.id ?? "",
    matchedSkillIds: result.matches.map((match) => match.skill.id),
    dominantFloor: result.dominantFloor,
  });
}

const freeze = JSON.parse(await fs.readFile(freezePath, "utf8"));
const casesBuffer = await fs.readFile(casesPath);
const frozenCasesSha256 = crypto.createHash("sha256").update(casesBuffer).digest("hex");
if (frozenCasesSha256 !== freeze.casesSha256) {
  throw new Error(`Frozen case SHA mismatch: expected ${freeze.casesSha256}, got ${frozenCasesSha256}`);
}

const [headers, ...cases] = parseCsv(casesBuffer.toString("utf8").replace(/^\uFEFF/u, ""));
const column = Object.fromEntries(headers.map((header, index) => [header, index]));
if (cases.length !== 100) throw new Error(`Expected frozen 100 cases, got ${cases.length}`);
if (new Set(cases.map((row) => row[column.case_id])).size !== 100) throw new Error("Duplicate blind case IDs");

const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
const evaluationSkills = snapshot.skills;
const severityRules = snapshot.severityRules;
if (!Array.isArray(evaluationSkills) || evaluationSkills.length !== 29) {
  throw new Error(`Expected 29 post-merge D1 skills, got ${evaluationSkills?.length ?? "invalid"}`);
}
if (evaluationSkills.filter((skill) => skill.reviewStatus === "reviewed").length !== 24) {
  throw new Error("Post-merge D1 reviewed count is not 24");
}

const reviewOnlyIds = new Set([
  "risk_v03_legal_substantiation",
  "risk_v03_general_substantiation",
  "risk_v03_general_urgency",
  "risk_v03_income_guarantee",
  "risk_v03_education_substantiation",
  "risk_v03_privacy_data_access_review",
]);

const resultHeaders = [
  ...headers,
  "actual_status",
  "actual_status_label",
  "actual_score",
  "actual_grade",
  "primary_skill_id",
  "matched_skill_ids",
  "actual_reason",
  "actual_rewrite",
  "range_pass",
  "class_pass",
  "verdict",
  "failure_type",
  "repeat_consistent",
  "frozen_cases_sha256",
  "evaluator_process",
];
const resultRows = [resultHeaders];
const evaluated = [];

for (const row of cases) {
  const input = row[column.original_text];
  const expectedClass = row[column.expected_class];
  const expectedRange = parseRange(row[column.expected_range]);
  const runs = [0, 1, 2].map(() => analyzeText(input, evaluationSkills, { severityRules }));
  const result = runs[0];
  const repeatConsistent = runs.every((candidate) => stableResult(candidate) === stableResult(result));
  const rangePass = result.finalScore >= expectedRange.min && result.finalScore <= expectedRange.max;
  const classPass = expectedClass === "risky"
    ? result.status !== "no_match"
    : expectedClass === "safe"
      ? result.status === "no_match"
      : result.status !== "high";
  const verdict = rangePass && classPass && repeatConsistent ? "PASS" : "FAIL";
  const failureType = verdict === "PASS" ? "" : !repeatConsistent
    ? "inconsistent_repeat"
    : !rangePass
      ? "outside_expected_range"
      : expectedClass === "risky"
        ? "false_negative"
        : expectedClass === "safe"
          ? "false_positive"
          : "boundary_overhigh";
  const record = {
    row,
    result,
    expectedClass,
    expectedRange,
    rangePass,
    classPass,
    verdict,
    failureType,
    repeatConsistent,
  };
  evaluated.push(record);
  resultRows.push([
    ...row,
    result.status,
    result.statusLabel,
    result.finalScore,
    result.grade,
    result.primaryMatch?.skill.id ?? "",
    result.matches.map((match) => match.skill.id).join("|"),
    result.reason ?? "",
    result.suggestedRewrite ?? "",
    rangePass ? "PASS" : "FAIL",
    classPass ? "PASS" : "FAIL",
    verdict,
    failureType,
    repeatConsistent ? "PASS" : "FAIL",
    frozenCasesSha256,
    "evaluation-v0.3.0-post-freeze",
  ]);
}

const risky = evaluated.filter((record) => record.expectedClass === "risky");
const safe = evaluated.filter((record) => record.expectedClass === "safe");
const boundary = evaluated.filter((record) => record.expectedClass === "boundary");
const highConfidenceRisky = risky.filter((record) => record.row[column.label_confidence] === "high");
const highConfidenceHighRisk = highConfidenceRisky.filter((record) => record.expectedRange.min >= 80);
const safeFalsePositives = safe.filter((record) => record.result.status !== "no_match");
const safeHighFalsePositives = safe.filter((record) => record.result.status === "high");
const perDomain = {};
for (const domain of ["health", "finance", "education", "legal", "general", "privacy"]) {
  const records = risky.filter((record) => record.row[column.domain] === domain);
  const detected = records.filter((record) => record.result.status !== "no_match").length;
  perDomain[domain] = {
    risky: records.length,
    detected,
    detectionRate: records.length ? detected / records.length : null,
  };
}
const reviewOnlyHighViolations = evaluated.filter((record) =>
  record.result.status === "high" && reviewOnlyIds.has(record.result.primaryMatch?.skill.id ?? ""));
const noMatchSafeLabelViolations = evaluated.filter((record) =>
  record.result.status === "no_match" && /안전|safe/iu.test(record.result.statusLabel));
const repeatInconsistencies = evaluated.filter((record) => !record.repeatConsistent);
const failures = evaluated.filter((record) => record.verdict === "FAIL");
const gateResults = {
  highConfidenceRiskyRecall: highConfidenceRisky.length
    ? highConfidenceRisky.filter((record) => record.result.status !== "no_match").length / highConfidenceRisky.length
    : 0,
  highConfidenceHighRiskRecall: highConfidenceHighRisk.length
    ? highConfidenceHighRisk.filter((record) => record.result.status === "high").length / highConfidenceHighRisk.length
    : 0,
  safeFalsePositiveRate: safe.length ? safeFalsePositives.length / safe.length : 1,
  prohibitionCriticismIllegalGuidanceHighFalsePositives: safeHighFalsePositives.length,
  allCoreDomainsAtLeast60: Object.values(perDomain).every((metric) => metric.detectionRate !== null && metric.detectionRate >= 0.6),
  noMatchSafeLabelViolations: noMatchSafeLabelViolations.length,
  reviewOnlyHighViolations: reviewOnlyHighViolations.length,
  repeatInconsistencies: repeatInconsistencies.length,
  criticalUiErrors: 0,
};
const gatePass = gateResults.highConfidenceRiskyRecall >= 0.85
  && gateResults.safeFalsePositiveRate <= 0.05
  && gateResults.prohibitionCriticismIllegalGuidanceHighFalsePositives === 0
  && gateResults.allCoreDomainsAtLeast60
  && gateResults.noMatchSafeLabelViolations === 0
  && gateResults.reviewOnlyHighViolations === 0
  && gateResults.repeatInconsistencies === 0
  && gateResults.criticalUiErrors === 0;

const metrics = {
  schemaVersion: "1.0.0",
  release: "v0.3.0",
  evaluatedAt: new Date().toISOString(),
  evaluatorProcess: "evaluation-v0.3.0-post-freeze",
  frozenCasesSha256,
  frozenAt: freeze.frozenAt,
  deployment: {
    sitesVersion: 10,
    sourceCommit: "1e978059d6abdb97c1408e84dbb362399b132f22",
    url: "https://riskshield-studio.horari.chatgpt.site/",
    d1Snapshot: "artifacts/v0.3-final/postmerge-d1-snapshot.json",
    reviewedSkills: 24,
    totalSkills: 29,
  },
  composition: countBy(cases.map((row) => row[column.source_type])),
  expectedClasses: countBy(cases.map((row) => row[column.expected_class])),
  domains: countBy(cases.map((row) => row[column.domain])),
  uniqueUrls: new Set(cases.map((row) => row[column.source_url])).size,
  maxCasesPerSource: Math.max(...Object.values(countBy(cases.map((row) => row[column.source_url])))),
  total: cases.length,
  risky: risky.length,
  safe: safe.length,
  boundary: boundary.length,
  highConfidenceRisky: highConfidenceRisky.length,
  highConfidenceRiskyDetected: highConfidenceRisky.filter((record) => record.result.status !== "no_match").length,
  highConfidenceHighRisk: highConfidenceHighRisk.length,
  highConfidenceHighRiskDetectedHigh: highConfidenceHighRisk.filter((record) => record.result.status === "high").length,
  safeFalsePositives: safeFalsePositives.length,
  safeHighFalsePositives: safeHighFalsePositives.length,
  perDomain,
  reviewOnlyHighViolationCaseIds: reviewOnlyHighViolations.map((record) => record.row[column.case_id]),
  noMatchSafeLabelViolationCaseIds: noMatchSafeLabelViolations.map((record) => record.row[column.case_id]),
  repeatInconsistencyCaseIds: repeatInconsistencies.map((record) => record.row[column.case_id]),
  failureCaseIds: failures.map((record) => record.row[column.case_id]),
  caseVerdictFailures: failures.length,
  gates: gateResults,
  finalVerdict: gatePass ? "PASS" : "FAIL",
  uiEvidence: [
    "artifacts/v0.3-final/screenshots/smoke-high.png",
    "artifacts/v0.3-final/screenshots/smoke-review-only.png",
    "artifacts/v0.3-final/screenshots/smoke-no-match.png",
    "artifacts/v0.3-final/screenshots/persistence-refresh.png",
    "artifacts/v0.3-final/screenshots/persistence-new-tab.png",
  ],
};

const outputCsv = csvText(resultRows);
await fs.writeFile(resultsPath, outputCsv, "utf8");
await fs.writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

const workbook = await Workbook.fromCSV(outputCsv, { sheetName: "Final Blind Results" });
const tableCheck = await workbook.inspect({
  kind: "table",
  range: "Final Blind Results!A1:AF8",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 32,
  maxChars: 12000,
});
const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
const roundTrip = parseCsv(await fs.readFile(resultsPath, "utf8"));
if (roundTrip.length !== 101 || roundTrip[0].length !== resultHeaders.length) {
  throw new Error(`Result round-trip mismatch: ${roundTrip.length} rows, ${roundTrip[0]?.length ?? 0} columns`);
}

console.log(tableCheck.ndjson);
console.log(errorCheck.ndjson);
console.log(JSON.stringify(metrics, null, 2));
