import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeText,
  gradeForScore,
  migrateRiskSkill,
  parseCsv,
  previewSkillImport,
  starterSkills,
  validateSkill,
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";

const fixture = readFileSync(
  new URL("./fixtures/analyzer-v0.2-cases.csv", import.meta.url),
  "utf8",
);
const [headers, ...rows] = parseCsv(fixture.replace(/^\uFEFF/u, ""));
const column = Object.fromEntries(headers.map((header, index) => [header, index]));

type FixtureCase = {
  id: string;
  input: string;
  expectation: "detect" | "safe" | "review" | "error";
  min: number;
  max: number;
};

const cases: FixtureCase[] = rows.map((row) => ({
  id: row[column.test_id],
  input: row[column.input],
  expectation: row[column.expectation] as FixtureCase["expectation"],
  min: Number(row[column.min_score]),
  max: Number(row[column.max_score]),
}));

test("all 47 browser cases are fixtures and the 44 clear cases pass", () => {
  const priorCases = cases.filter((candidate) => /^[RSNQVCE]\d{2}$/u.test(candidate.id));
  const reviewCases = priorCases.filter((candidate) => candidate.expectation === "review");
  const clearCases = priorCases.filter((candidate) => candidate.expectation !== "review");

  assert.equal(priorCases.length, 47);
  assert.deepEqual(reviewCases.map((candidate) => candidate.id), ["V01", "V03", "V04"]);
  assert.equal(clearCases.length, 44);

  for (const candidate of clearCases) {
    if (candidate.expectation === "error") {
      assert.equal(candidate.input.trim(), "", `${candidate.id} must be rejected before analysis`);
      continue;
    }
    const result = analyzeText(candidate.input, starterSkills);
    assert.ok(
      result.finalScore >= candidate.min && result.finalScore <= candidate.max,
      `${candidate.id}: expected ${candidate.min}-${candidate.max}, got ${result.finalScore}`,
    );
    if (candidate.expectation === "detect") assert.ok(result.matches.length > 0, candidate.id);
    if (candidate.expectation === "safe") assert.equal(result.matches.length, 0, candidate.id);
  }
});

test("review variants remain reviewable or become detected without silent normalization", () => {
  for (const candidate of cases.filter((item) => item.expectation === "review")) {
    const result = analyzeText(candidate.input, starterSkills);
    assert.ok(result.finalScore === 0 || result.finalScore >= 70, candidate.id);
  }
});

test("24 generalized variants pass the same reusable rules", () => {
  const variants = cases.filter((candidate) => candidate.id.startsWith("G"));
  assert.ok(variants.length >= 20);
  for (const candidate of variants) {
    const result = analyzeText(candidate.input, starterSkills);
    assert.ok(
      result.finalScore >= candidate.min && result.finalScore <= candidate.max,
      `${candidate.id}: expected ${candidate.min}-${candidate.max}, got ${result.finalScore}`,
    );
  }
});

test("unsupported schemas and non-http source URLs are rejected", () => {
  const base = starterSkills[0];
  const exportedLike = {
    ...base,
    schema_version: "99.0.0",
    schemaVersion: undefined,
  };
  const migrated = migrateRiskSkill(exportedLike);
  assert.equal(migrated.skill, undefined);
  assert.match(migrated.issues.join(" "), /지원하지 않는 스키마 버전/u);

  const invalidUrl: RiskSkill = {
    ...base,
    source: { ...base.source, url: "javascript:alert(1)" },
  };
  assert.match(validateSkill(invalidUrl).join(" "), /http 또는 https/u);
});

test("the shared severity boundary labels 79 as caution and 80+ as high", () => {
  assert.equal(gradeForScore(79), "주의");
  assert.equal(gradeForScore(80), "높음");
  assert.equal(gradeForScore(82), "높음");
});

test("merge preview classifies new, update, same, and conflict deterministically", () => {
  const current = starterSkills.slice(0, 3);
  const same = current[0];
  const update = { ...current[1], revision: current[1].revision + 1, notes: "업데이트" };
  const conflict = { ...current[2], notes: "같은 리비전의 충돌" };
  const added = { ...current[0], id: "risk_import_new", revision: 1 };
  const preview = previewSkillImport(current, [same, update, conflict, added], "merge");

  assert.equal(preview.newCount, 1);
  assert.equal(preview.updateCount, 1);
  assert.equal(preview.sameCount, 1);
  assert.equal(preview.conflictCount, 1);
  assert.equal(preview.skippedCount, 1);
  assert.equal(preview.errorCount, 0);
  assert.equal(preview.finalCount, 4);
  assert.ok(preview.finalSkills.some((skill) => skill.id === added.id));
  assert.equal(preview.finalSkills.find((skill) => skill.id === update.id)?.notes, "업데이트");
  assert.equal(preview.finalSkills.find((skill) => skill.id === conflict.id)?.notes, current[2].notes);

  const replacePreview = previewSkillImport(current, [same, update, conflict, added], "replace");
  assert.equal(replacePreview.mode, "replace");
  assert.equal(replacePreview.skippedCount, 0);
  assert.equal(replacePreview.finalCount, 4);
  assert.equal(
    replacePreview.finalSkills.find((skill) => skill.id === conflict.id)?.notes,
    "같은 리비전의 충돌",
  );
});
