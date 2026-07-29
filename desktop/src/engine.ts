import type {
  AiAnalysis,
  AnalysisEngine,
  RulesAnalysis,
  ValidationIssue,
} from "./types";
import { filterValidAiFindings } from "./validation";

type EngineDependencies = {
  codexEnabled: boolean;
  codex: () => Promise<AiAnalysis>;
  gemma: () => Promise<AiAnalysis>;
  rules: () => RulesAnalysis;
};

export type EngineResult = {
  engine: AnalysisEngine;
  ai: AiAnalysis | null;
  rules: RulesAnalysis | null;
  issues: ValidationIssue[];
};

export class GemmaKeyRequiredError extends Error {
  constructor(message = "Gemma API 키가 필요합니다.") {
    super(message);
    this.name = "GemmaKeyRequiredError";
  }
}

function acceptedAi(source: string, received: AiAnalysis) {
  const filtered = filterValidAiFindings(source, received);
  if (received.findings.length > 0 && filtered.analysis.findings.length === 0) {
    throw new Error("모든 AI 판단의 근거 검증에 실패했습니다.");
  }
  return filtered;
}

export async function analyzeByPriority(
  source: string,
  dependencies: EngineDependencies,
): Promise<EngineResult> {
  if (dependencies.codexEnabled) {
    try {
      const accepted = acceptedAi(source, await dependencies.codex());
      return {
        engine: "codex",
        ai: accepted.analysis,
        rules: null,
        issues: accepted.issues,
      };
    } catch {
      // Gemma is the next engine.
    }
  }

  try {
    const accepted = acceptedAi(source, await dependencies.gemma());
    return {
      engine: "gemma",
      ai: accepted.analysis,
      rules: null,
      issues: accepted.issues,
    };
  } catch (error) {
    if (error instanceof GemmaKeyRequiredError) throw error;
    return {
      engine: "rules",
      ai: null,
      rules: dependencies.rules(),
      issues: [],
    };
  }
}
