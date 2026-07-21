import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeText,
  starterSkills,
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";
import {
  INTERPRETER_SCHEMA_VERSION,
  type InterpreterPayload,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-4/interpreter.ts";
import {
  calculateDeterministicScore,
  SCORING_POLICY_VERSION,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-5/scoring.ts";

function payloadFor(text: string, confidence: number, overrides: Partial<InterpreterPayload> = {}): InterpreterPayload {
  return {
    schema_version: INTERPRETER_SCHEMA_VERSION,
    risk_intent: "direct_promotional",
    speech_act: "claim",
    claim_target: "education",
    context_relation: "supports",
    actor: "advertiser",
    claim_strength: "absolute",
    policy_relevance: "potentially_high",
    risk_family: "education_outcome",
    confidence,
    evidence_spans: [{ start: 0, end: text.length, text }],
    policy_reason: "DIRECT_ABSOLUTE_CLAIM",
    category_assessments: [{
      risk_family: "education_outcome",
      relevance: 4,
      certainty: 4,
      harm: 4,
      deception: 4,
      vulnerability: 4,
      privacy_intrusion: 4,
      evidence_strength: 4,
    }],
    ...overrides,
  };
}

test("current Scoring Policy applies exact confidence caps at every boundary", () => {
  const text = "합격을 반드시 보장합니다";
  const rules = analyzeText(text, []);
  const cases = [
    [0.64, 0], [0.65, 69], [0.79, 69], [0.8, 79], [0.89, 79], [0.9, 89],
  ] as const;
  for (const [confidence, expected] of cases) {
    const result = calculateDeterministicScore(rules, payloadFor(text, confidence));
    assert.equal(result.policyVersion, SCORING_POLICY_VERSION);
    assert.equal(result.finalScore, expected, `confidence ${confidence}`);
  }
});

test("same-family evidence only corroborates when rule and AI evidence belong to the same claim clause", () => {
  const sameText = "합격을 100% 보장합니다";
  const sameRules = analyzeText(sameText, starterSkills);
  const same = calculateDeterministicScore(sameRules, payloadFor(sameText, 0.9));
  assert.equal(same.primaryCategory?.id, "education_outcome");
  assert.equal(same.primaryCategory?.sameClaimCorroborated, true);

  const splitText = "합격을 100% 보장합니다. 이 과정은 새로운 선택입니다";
  const splitRules = analyzeText(splitText, starterSkills);
  const secondStart = splitText.indexOf("이 과정");
  const split = calculateDeterministicScore(splitRules, payloadFor(splitText, 0.9, {
    evidence_spans: [{ start: secondStart, end: splitText.length, text: splitText.slice(secondStart) }],
  }));
  assert.equal(split.primaryCategory?.id, "education_outcome");
  assert.equal(split.primaryCategory?.sameClaimCorroborated, false);
  assert.equal(split.highRequiresReview, true);
  assert.equal(split.status, "review");
});

test("AI-only high remains review and multiple rule families receive no cross-category bonus", () => {
  const aiText = "새로운 결과를 확실히 만듭니다";
  const aiOnly = calculateDeterministicScore(analyzeText(aiText, []), payloadFor(aiText, 0.9));
  assert.equal(aiOnly.finalScore, 89);
  assert.equal(aiOnly.highRequiresReview, true);
  assert.equal(aiOnly.status, "review");

  const mixed = analyzeText("합격을 보장합니다. 기각되면 100% 환불합니다", starterSkills);
  const scored = calculateDeterministicScore(mixed, null);
  assert.equal(scored.finalScore, scored.primaryCategory?.score);
  assert.equal(scored.finalScore, Math.max(...scored.categoryScores.map((category) => category.score)));
});

test("persisted riskFamily wins over ambiguous category text", () => {
  const base = starterSkills[0];
  const skill: RiskSkill = {
    ...base,
    id: "risk_income_ambiguous",
    category: "부업 수익 광고",
    subcategory: "부업 수익",
    patternType: "generated_candidate_review",
    riskFamily: "income_claim",
    triggerPatterns: ["부업"],
    contextPatterns: ["수익"],
    severityFloor: 75,
  };
  const scored = calculateDeterministicScore(analyzeText("부업 수익을 보장합니다", [skill]), null);
  assert.equal(scored.primaryCategory?.id, "income_claim");
});

test("contextual-only evidence without a rule is suppressed", () => {
  const text = "합격 보장이라는 표현은 사용하지 마세요";
  const result = calculateDeterministicScore(analyzeText(text, []), payloadFor(text, 0.95, {
    risk_intent: "contextual_only",
    speech_act: "warning",
    context_relation: "warns_about",
    policy_relevance: "none",
    policy_reason: "CONTEXT_WARNING",
  }));
  assert.equal(result.finalScore, 0);
  assert.equal(result.status, "no_match");
  assert.ok(result.decisionReasons.includes("contextual_only_suppressed"));
});
