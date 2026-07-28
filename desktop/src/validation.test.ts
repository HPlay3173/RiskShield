import { describe, expect, it } from "vitest";
import { parseAiAnalysis, reconcileSeverity, validateAiAnalysis } from "./validation";
import { analyzeWithReviewedRules } from "./analyzer";

describe("AI output validation", () => {
  it("accepts exact source evidence", () => {
    const analysis = parseAiAnalysis(JSON.stringify({
      summary: "검토",
      model: null,
      findings: [{
        category: "과장",
        severity: "review",
        evidence: "무조건 성공",
        explanation: "결과를 보장합니다.",
        rewrite: "결과는 달라질 수 있습니다.",
        confidence: 0.8,
      }],
    }));
    expect(validateAiAnalysis("무조건 성공", analysis)).toEqual([]);
  });

  it("rejects evidence absent from the source", () => {
    const analysis = parseAiAnalysis(JSON.stringify({
      summary: "검토",
      findings: [{
        category: "과장",
        severity: "high",
        evidence: "100% 보장",
        explanation: "과장",
        rewrite: null,
        confidence: 0.9,
      }],
    }));
    expect(validateAiAnalysis("성공할 수 있습니다", analysis)[0]?.code)
      .toBe("missing_evidence");
  });

  it("rejects invented rewrite numbers", () => {
    const analysis = parseAiAnalysis(JSON.stringify({
      summary: "검토",
      findings: [{
        category: "과장",
        severity: "review",
        evidence: "빠른 결과",
        explanation: "기간 확인 필요",
        rewrite: "3일 내 결과를 안내합니다.",
        confidence: 0.6,
      }],
    }));
    expect(validateAiAnalysis("빠른 결과를 제공합니다", analysis)[0]?.code)
      .toBe("invented_number");
  });

  it("downgrades unsupported AI-only high findings", () => {
    const rules = analyzeWithReviewedRules("오늘 새로운 상품을 소개합니다.");
    const ai = parseAiAnalysis(JSON.stringify({
      summary: "검토",
      findings: [{
        category: "기타",
        severity: "high",
        evidence: "새로운 상품",
        explanation: "AI 단독 판단",
        rewrite: null,
        confidence: 0.7,
      }],
    }));
    expect(reconcileSeverity(rules, ai).findings[0]?.severity).toBe("review");
  });
});
