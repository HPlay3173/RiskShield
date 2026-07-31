import { describe, expect, it } from "vitest";
import {
  filterValidAiFindings,
  parseAiAnalysis,
  statusFromAi,
  validateAiAnalysis,
} from "./validation";
import { analyzeWithReviewedRules } from "./analyzer";

function parseTestAi(value: {
  summary: string;
  findings: unknown[];
  riskScore?: number;
  model?: string | null;
  rewrite?: string | null;
}) {
  return parseAiAnalysis(JSON.stringify({
    riskScore: value.riskScore ?? 65,
    contextJudgment: {
      type: "direct_claim",
      explanation: "작성자가 직접 주장하는 문맥입니다.",
    },
    reviewReport: {
      verdict: "추가 검토",
      keyIssues: ["표현을 검토해야 합니다."],
      potentialRisks: ["오해 가능성"],
      recommendation: "표현을 완화하세요.",
      rewrite: value.rewrite ?? null,
    },
    ...value,
  }));
}

describe("AI output validation", () => {
  it("accepts exact source evidence", () => {
    const analysis = parseTestAi({
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
    });
    expect(validateAiAnalysis("무조건 성공", analysis)).toEqual([]);
  });

  it("rejects evidence absent from the source", () => {
    const analysis = parseTestAi({
      summary: "검토",
      findings: [{
        category: "과장",
        severity: "high",
        evidence: "100% 보장",
        explanation: "과장",
        rewrite: null,
        confidence: 0.9,
      }],
    });
    expect(validateAiAnalysis("성공할 수 있습니다", analysis)[0]?.code)
      .toBe("missing_evidence");
  });

  it("rejects invented rewrite numbers", () => {
    const analysis = parseTestAi({
      summary: "검토",
      findings: [{
        category: "과장",
        severity: "review",
        evidence: "빠른 결과",
        explanation: "기간 확인 필요",
        rewrite: "3일 내 결과를 안내합니다.",
        confidence: 0.6,
      }],
    });
    expect(validateAiAnalysis("빠른 결과를 제공합니다", analysis)[0]?.code)
      .toBe("invented_number");
  });

  it("keeps valid findings when another finding fails validation", () => {
    const analysis = parseTestAi({
      summary: "검토",
      findings: [
        {
          category: "역사적 맥락",
          severity: "high",
          evidence: "탱크데이",
          explanation: "5·18과 결합된 판촉 표현입니다.",
          rewrite: null,
          confidence: 0.95,
        },
        {
          category: "과장",
          severity: "review",
          evidence: "원문에 없는 문구",
          explanation: "잘못된 근거입니다.",
          rewrite: null,
          confidence: 0.5,
        },
      ],
    });

    const filtered = filterValidAiFindings("5/18 탱크데이 할인", analysis);
    expect(filtered.analysis.findings).toHaveLength(1);
    expect(filtered.analysis.findings[0]?.evidence).toBe("탱크데이");
    expect(filtered.issues[0]?.code).toBe("missing_evidence");
  });

  it("uses a valid AI-only high finding as the primary result", () => {
    const rules = analyzeWithReviewedRules("오늘 새로운 상품을 소개합니다.");
    const ai = parseTestAi({
      summary: "검토",
      riskScore: 85,
      findings: [{
        category: "기타",
        severity: "high",
        evidence: "새로운 상품",
        explanation: "AI 단독 판단",
        rewrite: null,
        confidence: 0.7,
      }],
    });
    expect(rules.status).toBe("no_match");
    expect(statusFromAi(ai)).toBe("high");
  });

  it("accepts an empty AI result without consulting rules", () => {
    const ai = parseTestAi({
      summary: "직접 위험은 확인되지 않았습니다.",
      riskScore: 0,
      findings: [],
    });
    expect(statusFromAi(ai)).toBe("no_match");
  });

  it("rejects an out-of-range score", () => {
    expect(() => parseTestAi({
      summary: "잘못된 점수",
      riskScore: 101,
      findings: [],
    })).toThrow("분석 스키마");
  });

  it("removes a report rewrite containing an invented number", () => {
    const ai = parseTestAi({
      summary: "검토",
      rewrite: "3일 안에 개선될 수 있습니다.",
      findings: [],
    });
    const filtered = filterValidAiFindings("개선에 도움을 줄 수 있습니다.", ai);
    expect(filtered.analysis.reviewReport.rewrite).toBeNull();
    expect(filtered.issues[0]?.code).toBe("invented_number");
  });
});
