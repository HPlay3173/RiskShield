import assert from "node:assert/strict";
import test from "node:test";

import {
  starterSkills,
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";
import {
  activationCases,
  runSkillActivationRegression,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/skill-activation.ts";

function codedDraft(regressionTests: RiskSkill["regressionTests"]): RiskSkill {
  const source = starterSkills.find((skill) => skill.riskFamily === "coded_expression");
  assert.ok(source);
  return { ...source, id: "risk_activation_test", reviewStatus: "reviewed", regressionTests };
}

test("activation evaluates every candidate-authored positive and negative example", () => {
  const result = runSkillActivationRegression(codedDraft([
    { id: "candidate-positive-1", input: "느개미", expected: "match" },
    { id: "candidate-positive-2", input: "너 느개미", expected: "match" },
    { id: "candidate-negative-1", input: "느개미라는 표현은 사용하지 마세요", expected: "no_match" },
    { id: "candidate-negative-2", input: "오늘 날씨가 맑다", expected: "no_match" },
  ]));
  assert.equal(result.passed, true);
  assert.equal(result.passedCount, result.totalCount);
  assert.ok(result.totalCount >= 4);
  assert.ok(result.checks.every((check) => check.passed));
});

test("activation fails closed and reports the exact failing candidate example", () => {
  const result = runSkillActivationRegression(codedDraft([
    { id: "bad-negative", input: "느개미", expected: "no_match" },
  ]));
  assert.equal(result.passed, false);
  assert.deepEqual(
    result.checks.filter((check) => !check.passed).map((check) => check.id),
    ["bad-negative"],
  );
});

test("activation deduplicates equivalent baseline and candidate cases", () => {
  const cases = activationCases(codedDraft([
    { id: "duplicate-positive", input: "느개미", expected: "match" },
    { id: "separate-expectation", input: "느개미", expected: "no_match" },
  ]));
  assert.equal(cases.filter((item) => item.input === "느개미" && item.expected === "match").length, 1);
  assert.equal(cases.filter((item) => item.input === "느개미" && item.expected === "no_match").length, 1);
});

test("activation positive cases must be matched by the target skill itself", () => {
  const existingCodedSkill = starterSkills.find((skill) => skill.riskFamily === "coded_expression");
  assert.ok(existingCodedSkill);
  const target = {
    ...codedDraft([{ id: "target-positive", input: "느개미", expected: "match" }]),
    triggerPatterns: ["새로운표현"],
  };
  const result = runSkillActivationRegression(target, [existingCodedSkill]);
  const check = result.checks.find((item) => item.id === "target-positive");
  assert.ok(check);
  assert.equal(check.actual, "match");
  assert.equal(check.targetMatched, false);
  assert.equal(check.passed, false);
  assert.ok(check.matchingSkillIds.includes(existingCodedSkill.id));
});

test("activation negative cases fail when any existing active skill matches", () => {
  const existingCodedSkill = starterSkills.find((skill) => skill.riskFamily === "coded_expression");
  assert.ok(existingCodedSkill);
  const target = {
    ...codedDraft([{ id: "cross-skill-negative", input: "느개미", expected: "no_match" }]),
    triggerPatterns: ["새로운표현"],
  };
  const result = runSkillActivationRegression(target, [existingCodedSkill]);
  const check = result.checks.find((item) => item.id === "cross-skill-negative");
  assert.ok(check);
  assert.equal(check.targetMatched, false);
  assert.equal(check.passed, false);
  assert.ok(check.matchingSkillIds.includes(existingCodedSkill.id));
  assert.equal(result.evaluatedSkillCount, 2);
});
