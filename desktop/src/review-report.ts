import type {
  AiAnalysis,
  AiFinding,
  AnalysisEngine,
  ContextJudgment,
  ContextJudgmentType,
  RulesAnalysis,
} from "./types";

export type ReviewPresentation = {
  riskScore: number;
  contextJudgment: ContextJudgment;
  suggestedRewrite: string | null;
};

const CONTEXT_LABELS: Record<ContextJudgmentType, string> = {
  direct_claim: "직접 주장",
  quotation: "인용",
  criticism: "비판",
  warning: "경고",
  reporting: "보도",
  educational: "교육·설명",
  conditional: "조건부 안내",
  unclear: "불명확",
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function inferredAiScore(findings: AiFinding[]) {
  if (findings.some((finding) => finding.severity === "high")) return 85;
  if (findings.some((finding) => finding.severity === "review")) return 65;
  if (findings.some((finding) => finding.severity === "low")) return 35;
  return 0;
}

function speechActContext(rules: RulesAnalysis): ContextJudgment {
  const mapping: Record<RulesAnalysis["speechAct"], ContextJudgmentType> = {
    promotion: "direct_claim",
    statement: "direct_claim",
    criticism: "criticism",
    warning: "warning",
    quotation: "quotation",
    condition: "conditional",
  };
  const type = mapping[rules.speechAct] ?? "unclear";
  const suffix = rules.matches.length
    ? "로컬 규칙이 일치한 표현과 주변 문구를 기준으로 분류했습니다."
    : "로컬 규칙에서 위험 조합은 찾지 못했으며, AI 수준의 세밀한 문맥 해석은 제한됩니다.";
  return {
    type,
    explanation: `${CONTEXT_LABELS[type]} 문맥으로 감지했습니다. ${suffix}`,
  };
}

function aiContext(ai: AiAnalysis): ContextJudgment {
  if (ai.contextJudgment?.type && ai.contextJudgment.explanation) {
    return ai.contextJudgment;
  }
  return {
    type: "unclear",
    explanation: ai.summary || "저장된 이전 분석에는 별도의 문맥 판단이 없습니다.",
  };
}

function aiSuggestedRewrite(ai: AiAnalysis): string | null {
  if (Object.prototype.hasOwnProperty.call(ai, "suggestedRewrite")) {
    return typeof ai.suggestedRewrite === "string" ? ai.suggestedRewrite : null;
  }
  if (typeof ai.reviewReport?.rewrite === "string") return ai.reviewReport.rewrite;
  return ai.findings.find((finding) => finding.rewrite)?.rewrite ?? null;
}

export function buildReviewPresentation(
  engine: AnalysisEngine | null,
  ai: AiAnalysis | null,
  rules: RulesAnalysis | null,
): ReviewPresentation | null {
  if ((engine === "codex" || engine === "gemma") && ai) {
    const provided = ai.riskScore;
    return {
      riskScore: typeof provided === "number" && Number.isFinite(provided)
        ? clampScore(provided)
        : inferredAiScore(ai.findings),
      contextJudgment: aiContext(ai),
      suggestedRewrite: aiSuggestedRewrite(ai),
    };
  }
  if (rules) {
    return {
      riskScore: clampScore(rules.finalScore),
      contextJudgment: speechActContext(rules),
      suggestedRewrite: rules.suggestedRewrite,
    };
  }
  return null;
}

export function contextJudgmentLabel(type: ContextJudgmentType) {
  return CONTEXT_LABELS[type];
}
