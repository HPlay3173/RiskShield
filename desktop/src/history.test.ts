import { describe, expect, it } from "vitest";
import { effectiveHistoryEngine } from "./history";
import type { AnalysisRecord } from "./types";

function record(overrides: Partial<AnalysisRecord>): AnalysisRecord {
  return {
    id: 1,
    createdAt: "2026-08-23T00:00:00Z",
    input: "테스트",
    rules: null,
    ai: null,
    mode: "rules-only",
    focus: "balanced",
    engine: "rules",
    validationIssues: [],
    ...overrides,
  };
}

describe("history engine compatibility", () => {
  it("recovers legacy Codex rows defaulted to rules", () => {
    const legacy = record({
      mode: "hybrid",
      ai: { summary: "Codex 결과", findings: [], model: "legacy" },
    });
    expect(effectiveHistoryEngine(legacy)).toBe("codex");
  });

  it("keeps genuine rules-only rows as rules", () => {
    expect(effectiveHistoryEngine(record({}))).toBe("rules");
  });

  it("recovers legacy Gemma rows from their model name", () => {
    const legacy = record({
      mode: "hybrid",
      ai: { summary: "Gemma 결과", findings: [], model: "gemma-4-26b-a4b-it" },
    });
    expect(effectiveHistoryEngine(legacy)).toBe("gemma");
  });
});
