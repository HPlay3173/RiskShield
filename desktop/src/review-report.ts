import type {
  AiAnalysis,
  AiFinding,
  AnalysisEngine,
  ContextJudgment,
  ContextJudgmentType,
  ReviewReport,
  RulesAnalysis,
} from "./types";

export type ReviewPresentation = {
  riskScore: number;
  contextJudgment: ContextJudgment;
  reviewReport: ReviewReport;
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

function rulesReport(rules: RulesAnalysis): ReviewReport {
  const keyIssues = Array.from(new Set(
    rules.matches.map((match) => match.skill.riskReason).filter(Boolean),
  )).slice(0, 5);
  const potentialRisks = Array.from(new Set(
    rules.matches
      .map((match) => match.skill.riskDomain || match.skill.category)
      .filter(Boolean),
  )).slice(0, 5);

  return {
    verdict: rules.statusLabel,
    keyIssues: keyIssues.length
      ? keyIssues
      : ["현재 활성화된 로컬 규칙과 일치하는 위험 표현이 없습니다."],
    potentialRisks: potentialRisks.length
      ? potentialRisks
      : ["규칙 미일치는 안전 보장이나 자동 승인을 의미하지 않습니다."],
    recommendation: rules.recommendation,
    rewrite: rules.suggestedRewrite,
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

function aiReport(ai: AiAnalysis): ReviewReport {
  if (
    ai.reviewReport
    && typeof ai.reviewReport.verdict === "string"
    && Array.isArray(ai.reviewReport.keyIssues)
    && Array.isArray(ai.reviewReport.potentialRisks)
  ) {
    return ai.reviewReport;
  }
  return {
    verdict: ai.summary || "검토 결과",
    keyIssues: ai.findings.length
      ? ai.findings.map((finding) => finding.explanation).slice(0, 5)
      : ["직접적인 위험 표현이 확인되지 않았습니다."],
    potentialRisks: ai.findings.length
      ? Array.from(new Set(ai.findings.map((finding) => finding.category))).slice(0, 5)
      : ["자동 분석 결과이므로 중요한 배포 전 검토는 별도로 권장합니다."],
    recommendation: ai.findings.some((finding) => finding.rewrite)
      ? "아래 대체 문구를 참고해 문제 표현을 완화하세요."
      : "현재 문맥과 배포 대상을 사람이 한 번 더 확인하세요.",
    rewrite: ai.findings.find((finding) => finding.rewrite)?.rewrite ?? null,
  };
}

export function buildReviewPresentation(
  engine: AnalysisEngine | null,
  ai: AiAnalysis | null,
  rules: RulesAnalysis | null,
): ReviewPresentation | null {
  if ((engine === "codex" || engine === "gemma") && ai) {
    const provided = Number(ai.riskScore);
    return {
      riskScore: Number.isFinite(provided)
        ? clampScore(provided)
        : inferredAiScore(ai.findings),
      contextJudgment: aiContext(ai),
      reviewReport: aiReport(ai),
    };
  }
  if (rules) {
    return {
      riskScore: clampScore(rules.finalScore),
      contextJudgment: speechActContext(rules),
      reviewReport: rulesReport(rules),
    };
  }
  return null;
}

export function contextJudgmentLabel(type: ContextJudgmentType) {
  return CONTEXT_LABELS[type];
}
