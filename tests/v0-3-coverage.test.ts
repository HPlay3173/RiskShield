import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeText,
  buildExportBundle,
  parseCsv,
  parseRiskSkillsJsonl,
  starterSkills,
  validateSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";
import {
  candidateSkillIdsV03,
  candidateSkillsV03,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-3-candidate-skills.ts";
import {
  activateDraftCandidatesForTest,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-3-test-adapter.ts";

function readCsv(relativeUrl: string) {
  const source = readFileSync(new URL(relativeUrl, import.meta.url), "utf8").replace(/^\uFEFF/u, "");
  const [headers, ...rows] = parseCsv(source);
  return {
    headers,
    rows,
    column: Object.fromEntries(headers.map((header, index) => [header, index])),
  };
}

const reviewedCandidates = activateDraftCandidatesForTest(candidateSkillsV03);
const v03Skills = [...starterSkills, ...reviewedCandidates];

test("all v0.3 candidates stay valid drafts and the adapter is non-mutating", () => {
  assert.equal(candidateSkillsV03.length, 15);
  assert.equal(new Set(candidateSkillIdsV03).size, candidateSkillsV03.length);
  assert.ok(candidateSkillsV03.every((skill) => skill.reviewStatus === "draft"));
  assert.ok(candidateSkillsV03.every((skill) => validateSkill(skill).length === 0));
  assert.ok(reviewedCandidates.every((skill) => skill.reviewStatus === "reviewed"));
  assert.notEqual(reviewedCandidates[0], candidateSkillsV03[0]);
  assert.notEqual(reviewedCandidates[0].triggerPatterns, candidateSkillsV03[0].triggerPatterns);
  assert.ok(candidateSkillsV03.every((skill) => skill.reviewStatus === "draft"));
  assert.equal(buildExportBundle(candidateSkillsV03, new Date(0)).riskSkillsJsonl, "");
});

test("candidate JSONL round-trips as 15 draft schema 2.0.0 records", () => {
  const source = readFileSync(
    new URL("../artifacts/v0.3/candidate-risk-skills-v0.3.jsonl", import.meta.url),
    "utf8",
  );
  const parsed = parseRiskSkillsJsonl(source);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.skills.length, 15);
  assert.ok(parsed.skills.every((skill) => skill.schemaVersion === "2.0.0"));
  assert.ok(parsed.skills.every((skill) => skill.reviewStatus === "draft"));
  assert.deepEqual(parsed.skills.map((skill) => skill.id), candidateSkillIdsV03);
});

test("75 new generalization cases pass reusable v0.3 rules", () => {
  const fixture = readCsv("./fixtures/analyzer-v0.3-generalization.csv");
  assert.equal(fixture.rows.length, 75);

  const oldCases = readCsv("../artifacts/v0.3/collected-ad-cases-audited.csv");
  const oldInputs = new Set(oldCases.rows.map((row) => row[oldCases.column.original_text]));
  assert.ok(fixture.rows.every((row) => !oldInputs.has(row[fixture.column.input])));

  for (const row of fixture.rows) {
    const id = row[fixture.column.test_id];
    const input = row[fixture.column.input];
    const expectedStatus = row[fixture.column.expected_status];
    const min = Number(row[fixture.column.min_score]);
    const max = Number(row[fixture.column.max_score]);
    const expectedSkill = row[fixture.column.expected_skill];
    const result = analyzeText(input, v03Skills);

    assert.equal(result.status, expectedStatus, `${id}: unexpected status for ${input}`);
    assert.ok(result.finalScore >= min && result.finalScore <= max, `${id}: ${result.finalScore} not in ${min}-${max}`);
    if (expectedSkill) {
      assert.ok(result.matches.some((match) => match.skill.id === expectedSkill), `${id}: missing ${expectedSkill}`);
    }
  }
});

test("key real-world cases meet their v0.3 status requirements", () => {
  const cases = readCsv("../artifacts/v0.3/collected-ad-cases-audited.csv");
  const byId = new Map(cases.rows.map((row) => [row[cases.column.case_id], row[cases.column.original_text]]));
  const expected = new Map([
    ["RW016", "high"],
    ["RW018", "high"],
    ["RW024", "high"],
    ["RW028", "high"],
    ["RW053", "high"],
    ["RW071", "no_match"],
    ["RW082", "no_match"],
  ]);

  for (const [id, status] of expected) {
    const input = byId.get(id);
    assert.ok(input, id);
    assert.equal(analyzeText(input, v03Skills).status, status, id);
  }
});

test("polarity applies to the evidence clause and preserves reversal CTAs", () => {
  const pairs = [
    ["100% 합격 보장은 불법이며 사용하면 안 됩니다.", "no_match"],
    ["100% 합격 보장! 지금 신청하세요.", "high"],
    ["몰래 위치 추적은 불법입니다.", "no_match"],
    ["불법일 수 있지만 들키지 않게 몰래 위치를 추적해 드립니다.", "high"],
    ["부작용이 전혀 없다고 말할 수 없습니다.", "no_match"],
    ["부작용이 전혀 없습니다.", "high"],
  ] as const;

  for (const [input, expectedStatus] of pairs) {
    assert.equal(analyzeText(input, v03Skills).status, expectedStatus, input);
  }
});

test("no-match is neutral, review is distinct, and income is not rewritten as investment", () => {
  const noMatch = analyzeText("오늘 회의는 오후 세 시에 시작합니다.", v03Skills);
  assert.equal(noMatch.status, "no_match");
  assert.equal(noMatch.statusLabel, "규칙 미일치");
  assert.equal(noMatch.reason, null);
  assert.equal(noMatch.suggestedRewrite, null);
  assert.match(noMatch.recommendation, /자동 승인이나 안전 보장을 의미하지 않습니다/u);

  const review = analyzeText("월 200만원 이상 보장", v03Skills);
  assert.equal(review.status, "review");
  assert.equal(review.primaryMatch?.skill.id, "risk_v03_income_guarantee");
  assert.doesNotMatch(review.reason ?? "", /투자|원금/u);
  assert.match(review.suggestedRewrite ?? "", /소득 산정 조건/u);
});

test("audited data preserves the original identity surface and records 25 label changes", () => {
  const originalPath = new URL("../artifacts/real-world-evaluation/collected-ad-cases.csv", import.meta.url);
  const originalBuffer = readFileSync(originalPath);
  assert.equal(
    crypto.createHash("sha256").update(originalBuffer).digest("hex").toUpperCase(),
    "5AAD27324385D0484819ABE15F8F5EE347F0F87AF4909D3D1E2D35CD4F83A7F0",
  );

  const original = readCsv("../artifacts/real-world-evaluation/collected-ad-cases.csv");
  const audited = readCsv("../artifacts/v0.3/collected-ad-cases-audited.csv");
  assert.equal(original.rows.length, 100);
  assert.equal(audited.rows.length, 100);

  let changedLabels = 0;
  for (let index = 0; index < original.rows.length; index += 1) {
    const before = original.rows[index];
    const after = audited.rows[index];
    assert.equal(after[audited.column.case_id], before[original.column.case_id]);
    assert.equal(after[audited.column.original_text], before[original.column.original_text]);
    assert.ok(["high", "medium", "low"].includes(after[audited.column.label_confidence]));
    assert.ok(after[audited.column.label_reason].trim().length > 0);
    if (after[audited.column.expected_class] !== before[original.column.expected_class]) changedLabels += 1;
  }
  assert.equal(changedLabels, 25);
});

test("development and generalization result artifacts meet the declared thresholds", () => {
  const development = readCsv("../artifacts/v0.3/development-set-results.csv");
  const riskyHigh = development.rows.filter((row) =>
    row[development.column.expected_class] === "risky"
      && row[development.column.label_confidence] === "high");
  const detected = riskyHigh.filter((row) => Number(row[development.column.actual_score]) >= 70);
  const safe = development.rows.filter((row) => row[development.column.expected_class] === "safe");
  const safeFp = safe.filter((row) => Number(row[development.column.actual_score]) >= 70);
  const ambiguousHigh = development.rows.filter((row) =>
    row[development.column.expected_class] === "ambiguous"
      && Number(row[development.column.actual_score]) >= 80);

  assert.ok(detected.length / riskyHigh.length >= 0.8);
  assert.ok(safeFp.length / safe.length <= 0.05);
  assert.equal(ambiguousHigh.length, 0);
  assert.equal(development.rows.filter((row) => row[development.column.verdict] === "FAIL").length, 0);

  const generalization = readCsv("../artifacts/v0.3/generalization-results.csv");
  assert.equal(generalization.rows.length, 75);
  assert.equal(generalization.rows.filter((row) => row[generalization.column.verdict] !== "PASS").length, 0);
});

test("production starter skills do not activate draft candidates", () => {
  const production = analyzeText("부작용이 전혀 없습니다.", starterSkills);
  const preview = analyzeText("부작용이 전혀 없습니다.", v03Skills);
  assert.equal(production.status, "no_match");
  assert.equal(preview.status, "high");
  assert.ok(preview.matches.some((match) => match.skill.id === "risk_v03_health_safety_absolute"));
});
