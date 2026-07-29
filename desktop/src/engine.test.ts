import { describe, expect, it, vi } from "vitest";
import { analyzeWithReviewedRules } from "./analyzer";
import { analyzeByPriority, GemmaKeyRequiredError } from "./engine";
import type { AiAnalysis } from "./types";

const safeAi: AiAnalysis = {
  summary: "직접 위험 없음",
  findings: [],
  model: "test",
};

describe("analysis engine failover", () => {
  it("stops after a successful Codex result", async () => {
    const gemma = vi.fn(async () => safeAi);
    const rules = vi.fn(() => analyzeWithReviewedRules("안전 문구"));
    const result = await analyzeByPriority("안전 문구", {
      codexEnabled: true,
      codex: async () => safeAi,
      gemma,
      rules,
    });
    expect(result.engine).toBe("codex");
    expect(gemma).not.toHaveBeenCalled();
    expect(rules).not.toHaveBeenCalled();
  });

  it("uses Gemma when Codex is unavailable without running rules", async () => {
    const rules = vi.fn(() => analyzeWithReviewedRules("안전 문구"));
    const result = await analyzeByPriority("안전 문구", {
      codexEnabled: true,
      codex: async () => { throw new Error("unavailable"); },
      gemma: async () => safeAi,
      rules,
    });
    expect(result.engine).toBe("gemma");
    expect(rules).not.toHaveBeenCalled();
  });

  it("runs rules only when both AI engines fail", async () => {
    const rules = vi.fn(() => analyzeWithReviewedRules("5/18 탱크데이 할인"));
    const result = await analyzeByPriority("5/18 탱크데이 할인", {
      codexEnabled: false,
      codex: async () => safeAi,
      gemma: async () => { throw new Error("unavailable"); },
      rules,
    });
    expect(result.engine).toBe("rules");
    expect(result.ai).toBeNull();
    expect(rules).toHaveBeenCalledOnce();
  });

  it("pauses instead of running rules when a Gemma key is first required", async () => {
    const rules = vi.fn(() => analyzeWithReviewedRules("안전 문구"));
    await expect(analyzeByPriority("안전 문구", {
      codexEnabled: true,
      codex: async () => { throw new Error("unavailable"); },
      gemma: async () => { throw new GemmaKeyRequiredError(); },
      rules,
    })).rejects.toBeInstanceOf(GemmaKeyRequiredError);
    expect(rules).not.toHaveBeenCalled();
  });
});
