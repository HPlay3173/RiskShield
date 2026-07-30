import { describe, expect, it } from "vitest";
import { orderAiFindings } from "./analysis-focus";
import type { AiFinding } from "./types";

const findings: AiFinding[] = [
  {
    category: "역사적 민감성",
    severity: "review",
    evidence: "518",
    explanation: "역사 문맥",
    rewrite: null,
    confidence: 0.7,
  },
  {
    category: "금융 과장 광고",
    severity: "high",
    evidence: "수익 보장",
    explanation: "결과 보장",
    rewrite: null,
    confidence: 0.9,
  },
  {
    category: "욕설·공격",
    severity: "high",
    evidence: "공격",
    explanation: "공격 표현",
    rewrite: null,
    confidence: 0.8,
  },
];

describe("analysis focus", () => {
  it("keeps balanced mode severity-first", () => {
    expect(orderAiFindings(findings, "balanced")[0]?.category).toBe("금융 과장 광고");
  });

  it("prioritizes claim categories without changing findings", () => {
    const ordered = orderAiFindings(findings, "claim");
    expect(ordered[0]?.category).toBe("금융 과장 광고");
    expect(new Set(ordered)).toEqual(new Set(findings));
  });

  it("prioritizes contextual categories without changing findings", () => {
    const ordered = orderAiFindings(findings, "context");
    expect(ordered[0]?.category).toBe("욕설·공격");
    expect(new Set(ordered)).toEqual(new Set(findings));
  });
});
