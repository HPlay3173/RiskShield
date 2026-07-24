import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPublicAnalysisPresentation,
  buildRewriteSuggestions,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-5/public-analysis-presentation.ts";
import type { RiskSkill } from "../lib/riskshield.ts";
import type { CategoryFormulaScore } from "../lib/v0-5/scoring.ts";

const abusiveCategory: CategoryFormulaScore = {
  id: "abusive_language",
  label: "욕설·공격",
  score: 78,
  ruleScore: 78,
  aiScore: 0,
  source: "rule",
  contextMultiplier: 1,
  sameClaimCorroborated: false,
  axes: null,
};

test("no_match does not manufacture rewrite suggestions", () => {
  assert.deepEqual(buildRewriteSuggestions("no_match", "abusive_language", null), []);
});

test("reviewed safeRewrite is first, family templates fill to three, and duplicates are removed", () => {
  const skill = {
    safeRewrite: [
      "문제가 된 행동을 구체적으로 설명해 주세요.",
      "문제가   된 행동을 구체적으로 설명해 주세요.",
    ],
  } as RiskSkill;
  const suggestions = buildRewriteSuggestions("attention", "abusive_language", skill);

  assert.equal(suggestions.length, 3);
  assert.equal(suggestions[0]?.source, "reviewed_rule");
  assert.equal(suggestions[0]?.text, "문제가 된 행동을 구체적으로 설명해 주세요.");
  assert.equal(suggestions.filter((item) => item.source === "reviewed_rule").length, 1);
  assert.ok(suggestions.some((item) => item.source === "family_template"));
});

test("fallback presentation explains rule-only context without inventing AI intent", () => {
  const presentation = buildPublicAnalysisPresentation({
    status: "attention",
    primaryCategory: abusiveCategory,
    primarySkill: null,
    ruleReason: "검토된 공격 표현이 직접 사용되었습니다.",
    payload: null,
    aiState: "fallback",
    uncertainty: { level: "high", reason: "AI 문맥 분석을 사용할 수 없습니다." },
  });

  assert.equal(presentation.primaryRisk?.explanation, "검토된 공격 표현이 직접 사용되었습니다.");
  assert.equal(presentation.contextInterpretation.intent, "AI 문맥 미사용");
  assert.match(presentation.contextInterpretation.summary, /검토된 규칙/u);
  assert.equal(presentation.rewriteSuggestions.length, 3);
});

test("public Analyzer removes examples and renders the requested result hierarchy", async () => {
  const source = await readFile(new URL("../app/PublicAnalyzer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /예시로 확인하기|const EXAMPLES|publicAnalyzerExamples/u);

  const sections = [
    ">주요 위험<",
    ">위험 근거 구간<",
    ">문맥 해석<",
    ">더 안전한 대체 표현<",
    ">다른 위험 주장과 범주 보기<",
    ">불확실성<",
    ">결과 개선 참여<",
  ];
  let previous = -1;
  for (const section of sections) {
    const index = source.indexOf(section);
    assert.ok(index > previous, `${section} should appear after the previous result section`);
    previous = index;
  }
});
