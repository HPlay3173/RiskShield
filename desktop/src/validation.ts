import type {
  AiAnalysis,
  AiFinding,
  ContextJudgment,
  RulesAnalysis,
  ValidationIssue,
} from "./types";

const NUMBER = /(?<![\p{L}\p{N}])[-+]?\d+(?:[.,]\d+)?\s*%?/gu;

function normalized(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function numbers(value: string): Set<string> {
  return new Set(Array.from(normalized(value).matchAll(NUMBER), (match) =>
    match[0].replace(/\s+/gu, "").replace(",", "."),
  ));
}

function isFinding(value: unknown): value is AiFinding {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AiFinding>;
  return (
    typeof item.category === "string" &&
    ["low", "review", "high"].includes(item.severity ?? "") &&
    typeof item.evidence === "string" &&
    typeof item.explanation === "string" &&
    (item.rewrite === null || typeof item.rewrite === "string") &&
    typeof item.confidence === "number"
  );
}

function isContextJudgment(value: unknown): value is ContextJudgment {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ContextJudgment>;
  return (
    [
      "direct_claim",
      "quotation",
      "criticism",
      "warning",
      "reporting",
      "educational",
      "conditional",
      "unclear",
    ].includes(item.type ?? "")
    && typeof item.explanation === "string"
  );
}

export function parseAiAnalysis(raw: string): AiAnalysis {
  const value = JSON.parse(raw) as Partial<AiAnalysis>;
  if (
    typeof value.summary !== "string" ||
    typeof value.riskScore !== "number" ||
    !Number.isFinite(value.riskScore) ||
    value.riskScore < 0 ||
    value.riskScore > 100 ||
    !isContextJudgment(value.contextJudgment) ||
    !(value.suggestedRewrite === null || typeof value.suggestedRewrite === "string") ||
    !Array.isArray(value.findings) ||
    !value.findings.every(isFinding)
  ) {
    throw new Error("AI 응답이 RiskShield 분석 스키마와 맞지 않습니다.");
  }
  return {
    summary: value.summary,
    riskScore: Math.round(value.riskScore),
    contextJudgment: value.contextJudgment,
    suggestedRewrite: value.suggestedRewrite,
    findings: value.findings,
    model: typeof value.model === "string" ? value.model : null,
  };
}

export function validateAiAnalysis(
  source: string,
  analysis: AiAnalysis,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sourceNormalized = normalized(source);
  const sourceNumbers = numbers(source);

  if (analysis.suggestedRewrite) {
    for (const token of numbers(analysis.suggestedRewrite)) {
      if (!sourceNumbers.has(token)) {
        issues.push({
          code: "invented_number",
          message: `수정 문구 제안에 원문에 없던 수치(${token})가 추가됐습니다.`,
        });
      }
    }
  }

  analysis.findings.forEach((finding, index) => {
    const evidence = normalized(finding.evidence);
    if (!evidence || !sourceNormalized.includes(evidence)) {
      issues.push({
        code: "missing_evidence",
        message: `${index + 1}번 판단의 근거 문구가 원문에 없습니다.`,
      });
    }
    if (finding.rewrite) {
      for (const token of numbers(finding.rewrite)) {
        if (!sourceNumbers.has(token)) {
          issues.push({
            code: "invented_number",
            message: `${index + 1}번 대체 문구에 원문에 없던 수치(${token})가 추가됐습니다.`,
          });
        }
      }
    }
  });

  return issues;
}

export function filterValidAiFindings(
  source: string,
  analysis: AiAnalysis,
): { analysis: AiAnalysis; issues: ValidationIssue[] } {
  const findings: AiFinding[] = [];
  const reportIssues = validateAiAnalysis(source, {
    ...analysis,
    findings: [],
  });
  const issues: ValidationIssue[] = [...reportIssues];

  analysis.findings.forEach((finding, index) => {
    const findingIssues = validateAiAnalysis(source, {
      summary: analysis.summary,
      riskScore: analysis.riskScore,
      contextJudgment: analysis.contextJudgment,
      suggestedRewrite: null,
      findings: [finding],
      model: analysis.model,
    }).map((issue) => ({
      ...issue,
      message: issue.message.replace(/^1번/u, `${index + 1}번`),
    }));

    if (findingIssues.length === 0) {
      findings.push(finding);
    } else {
      issues.push(...findingIssues);
    }
  });

  return {
    analysis: {
      ...analysis,
      findings,
      suggestedRewrite: reportIssues.length ? null : analysis.suggestedRewrite,
    },
    issues,
  };
}

export function statusFromAi(ai: AiAnalysis): RulesAnalysis["status"] {
  if (ai.findings.some((finding) => finding.severity === "high")) return "high";
  if (ai.findings.some((finding) => finding.severity === "review")) return "review";
  return "no_match";
}
