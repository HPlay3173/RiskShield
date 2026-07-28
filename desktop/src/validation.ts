import type {
  AiAnalysis,
  AiFinding,
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

export function parseAiAnalysis(raw: string): AiAnalysis {
  const value = JSON.parse(raw) as Partial<AiAnalysis>;
  if (
    typeof value.summary !== "string" ||
    !Array.isArray(value.findings) ||
    !value.findings.every(isFinding)
  ) {
    throw new Error("Codex 응답이 RiskShield 분석 스키마와 맞지 않습니다.");
  }
  return {
    summary: value.summary,
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

export function reconcileSeverity(
  rules: RulesAnalysis,
  ai: AiAnalysis,
): AiAnalysis {
  return {
    ...ai,
    findings: ai.findings.map((finding) => {
      const exactRuleSupport = rules.matches.some((match) =>
        match.hits.some((hit) => normalized(finding.evidence).includes(normalized(hit.text))),
      );
      return finding.severity === "high" && !exactRuleSupport
        ? { ...finding, severity: "review" as const }
        : finding;
    }),
  };
}
