import {
  DEFAULT_SEVERITY_RULES,
  analyzeText,
  starterSkills,
} from "../../lib/riskshield";
import type { RulesAnalysis } from "./types";
import type { FallbackRule } from "./types";
import type { RiskSkill } from "../../lib/riskshield";

function scoreForSeverity(severity: FallbackRule["severity"]) {
  if (severity === "high") return 85;
  if (severity === "review") return 65;
  return 35;
}

export function fallbackRuleToSkill(rule: FallbackRule): RiskSkill {
  const severityFloor = scoreForSeverity(rule.severity);
  return {
    schemaVersion: "2.0.0",
    revision: 1,
    id: rule.id,
    category: rule.category,
    subcategory: "관리자 추가 규칙",
    patternType: "admin_fallback_expression",
    matchMode: "atomic_lexeme",
    triggerPatterns: [rule.expression],
    contextPatterns: [],
    anyOfPatterns: [],
    exclusionPatterns: [],
    conditionScope: "sentence",
    maxDistance: 0,
    surfaceMeaning: rule.expression,
    riskSummary: rule.reason,
    socialContext: rule.reason,
    legalOrEthicIssue: rule.reason,
    riskReason: rule.reason,
    severityFloor,
    dominantRisk: rule.severity === "high",
    confidence: rule.severity === "high" ? 0.9 : rule.severity === "review" ? 0.7 : 0.5,
    riskDomain: "관리자 추가 규칙",
    recentContextTags: [],
    safeRewrite: [],
    falsePositiveNote: "AI 엔진을 모두 사용할 수 없을 때만 적용되는 로컬 보완 규칙입니다.",
    notes: `source:${rule.source}`,
    source: {
      title: rule.source === "csv" ? "관리자 CSV 가져오기" : "Analyzer 미탐 보완",
      url: "",
      date: rule.updatedAt.slice(0, 10),
      sourceId: rule.id,
      provenanceStatus: "provided",
    },
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    reviewStatus: "reviewed",
  };
}

export function analyzeWithReviewedRules(
  input: string,
  fallbackRules: FallbackRule[] = [],
): RulesAnalysis {
  const reviewed = [
    ...starterSkills.filter((skill) => skill.reviewStatus === "reviewed"),
    ...fallbackRules.filter((rule) => rule.enabled).map(fallbackRuleToSkill),
  ];
  return analyzeText(input, reviewed, { severityRules: DEFAULT_SEVERITY_RULES });
}
