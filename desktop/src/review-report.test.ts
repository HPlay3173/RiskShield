import { describe, expect, it } from "vitest";
import { analyzeWithReviewedRules } from "./analyzer";
import { buildReviewPresentation } from "./review-report";
import type { AiAnalysis } from "./types";

const ai: AiAnalysis = {
  summary: "직접적인 효능 보장 표현입니다.",
  riskScore: 78,
  contextJudgment: {
    type: "direct_claim",
    explanation: "작성자가 효능을 직접 주장합니다.",
  },
  suggestedRewrite: "개선에 도움을 줄 수 있습니다.",
  findings: [],
  model: "test",
};

describe("review additions", () => {
  it("keeps an AI engine's score, context, and rewrite", () => {
    const result = buildReviewPresentation("codex", ai, null);
    expect(result?.riskScore).toBe(78);
    expect(result?.contextJudgment.type).toBe("direct_claim");
    expect(result?.suggestedRewrite).toBe("개선에 도움을 줄 수 있습니다.");
  });

  it("uses the existing local-rule additions", () => {
    const rules = analyzeWithReviewedRules("5/18 탱크데이 할인");
    const result = buildReviewPresentation("rules", null, rules);
    expect(result?.riskScore).toBe(rules.finalScore);
    expect(result?.suggestedRewrite).toBe(rules.suggestedRewrite);
  });

  it("recovers a score for an older saved AI result", () => {
    const legacy = {
      summary: "이전 분석",
      findings: [{
        category: "과장",
        severity: "high",
        evidence: "보장",
        explanation: "보장 표현",
        rewrite: null,
        confidence: 0.8,
      }],
      model: "legacy",
    } as AiAnalysis;
    expect(buildReviewPresentation("gemma", legacy, null)?.riskScore).toBe(85);
  });

  it("recovers the rewrite from a v0.8.0 saved report", () => {
    const legacy = {
      ...ai,
      suggestedRewrite: undefined,
      reviewReport: {
        verdict: "주의 필요",
        keyIssues: [],
        potentialRisks: [],
        recommendation: "완화하세요.",
        rewrite: "이전 기록의 대체 문구",
      },
    } as AiAnalysis;
    delete legacy.suggestedRewrite;
    expect(buildReviewPresentation("codex", legacy, null)?.suggestedRewrite)
      .toBe("이전 기록의 대체 문구");
  });
});
