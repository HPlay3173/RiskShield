import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeText,
  parseCsv,
  starterSkills,
// @ts-expect-error Node strips TypeScript at runtime.
} from "../lib/riskshield.ts";
import {
  candidateSkillsV031,
// @ts-expect-error Node strips TypeScript at runtime.
} from "../lib/v0-3-1-candidate-skills.ts";
import {
  activateDraftCandidatesForTest,
// @ts-expect-error Node strips TypeScript at runtime.
} from "../lib/v0-3-test-adapter.ts";

const { Workbook } = await import(process.env.ARTIFACT_TOOL_MODULE ?? "@oai/artifact-tool");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.join(root, "artifacts", "v0.3", "preapproval-blind-cases.csv");
const outputPath = path.join(root, "artifacts", "v0.3", "preapproval-blind-results.csv");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvText(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const frozenBuffer = await fs.readFile(inputPath);
const frozenSha256 = crypto.createHash("sha256").update(frozenBuffer).digest("hex");
const parsed = parseCsv(frozenBuffer.toString("utf8").replace(/^\uFEFF/u, ""));
const [headers, ...cases] = parsed;
const column = Object.fromEntries(headers.map((header, index) => [header, index]));
if (cases.length !== 80) throw new Error(`Expected frozen 80 cases, got ${cases.length}`);
if (new Set(cases.map((row) => row[column.case_id])).size !== 80) throw new Error("Duplicate blind case IDs");

const reviewedCandidates = activateDraftCandidatesForTest(candidateSkillsV031);
const evaluationSkills = [...starterSkills, ...reviewedCandidates];
const resultHeaders = [
  ...headers,
  "actual_status", "actual_score", "actual_grade", "primary_skill_id", "matched_skill_ids",
  "actual_reason", "actual_rewrite", "verdict", "failure_type", "frozen_cases_sha256", "evaluator_process",
];
const resultRows = [resultHeaders];

for (const row of cases) {
  const input = row[column.input];
  const expectedClass = row[column.expected_class];
  const result = analyzeText(input, evaluationSkills);
  const pass = expectedClass === "risky"
    ? result.status === "high"
    : expectedClass === "safe"
      ? result.status === "no_match"
      : result.status !== "high";
  const failureType = pass ? "" : expectedClass === "risky"
    ? "false_negative"
    : expectedClass === "safe"
      ? "false_positive"
      : "ambiguous_overhigh";
  resultRows.push([
    ...row,
    result.status,
    result.finalScore,
    result.grade,
    result.primaryMatch?.skill.id ?? "",
    result.matches.map((match) => match.skill.id).join("|"),
    result.reason ?? "",
    result.suggestedRewrite ?? "",
    pass ? "PASS" : "FAIL",
    failureType,
    frozenSha256,
    "evaluation-v0.3.1-post-freeze",
  ]);
}

const risky = resultRows.slice(1).filter((row) => row[column.expected_class] === "risky");
const safe = resultRows.slice(1).filter((row) => row[column.expected_class] === "safe");
const ambiguous = resultRows.slice(1).filter((row) => row[column.expected_class] === "ambiguous");
const statusIndex = resultHeaders.indexOf("actual_status");
const verdictIndex = resultHeaders.indexOf("verdict");
const tagIndex = resultHeaders.indexOf("control_tag");
const riskyHigh = risky.filter((row) => row[statusIndex] === "high");
const safeFp = safe.filter((row) => row[statusIndex] !== "no_match");
const prohibitionCriticismFp = safe.filter((row) => ["prohibition", "criticism"].includes(row[tagIndex]) && row[statusIndex] !== "no_match");
const overHighControls = resultRows.slice(1).filter((row) =>
  ["simple_amount", "past_statistic", "icon_hiding"].includes(row[tagIndex]) && row[statusIndex] === "high");

const metrics = {
  frozenCasesSha256: frozenSha256,
  total: cases.length,
  risky: risky.length,
  safe: safe.length,
  ambiguous: ambiguous.length,
  riskyHigh: riskyHigh.length,
  riskyRecall: riskyHigh.length / risky.length,
  safeFalsePositives: safeFp.length,
  safeFalsePositiveRate: safeFp.length / safe.length,
  prohibitionCriticismFalsePositives: prohibitionCriticismFp.length,
  simpleAmountStatisticIconOverHigh: overHighControls.length,
  failures: resultRows.slice(1).filter((row) => row[verdictIndex] === "FAIL").length,
};

const outputCsv = csvText(resultRows);
await fs.writeFile(outputPath, outputCsv, "utf8");
await fs.writeFile(path.join(root, "artifacts", "v0.3", "preapproval-blind-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

const workbook = await Workbook.fromCSV(outputCsv, { sheetName: "BlindResults" });
const tableCheck = await workbook.inspect({
  kind: "table",
  range: "BlindResults!A1:U81",
  include: "values,formulas",
  tableMaxRows: 5,
  tableMaxCols: 21,
  maxChars: 8000,
});
const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(tableCheck.ndjson);
console.log(errorCheck.ndjson);
console.log(JSON.stringify(metrics, null, 2));
