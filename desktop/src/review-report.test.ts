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
  reviewReport: {
    verdict: "주의 필요",
    keyIssues: ["효능을 확정적으로 표현합니다."],
    potentialRisks: ["과장 광고로 오해될 수 있습니다."],
    recommendation: "보장 표현을 완화하세요.",
    rewrite: "개선에 도움을 줄 수 있습니다.",
  },
  findings: [],
  model: "test",
};

describe("common review presentation", () => {
  it("keeps an AI engine's autonomous score and report", () => {
    const result = buildReviewPresentation("codex", ai, null);
    expect(result?.riskScore).toBe(78);
    expect(result?.contextJudgment.type).toBe("direct_claim");
    expect(result?.reviewReport.verdict).toBe("주의 필요");
  });

  it("builds the same presentation shape from local rules", () => {
    const rules = analyzeWithReviewedRules("5/18 탱크데이 할인");
    const result = buildReviewPresentation("rules", null, rules);
    expect(result?.riskScore).toBe(rules.finalScore);
    expect(result?.reviewReport.recommendation).toBe(rules.recommendation);
    expect(result?.reviewReport.keyIssues.length).toBeGreaterThan(0);
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
});
