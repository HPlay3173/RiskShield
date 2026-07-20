import type { AnalysisResult } from "../riskshield.ts";
import type { InterpreterPayload, RiskFamily } from "../v0-4/interpreter.ts";

export const SCORING_POLICY_VERSION = "2.0.0" as const;

export const SCORING_AXES = [
  "relevance",
  "certainty",
  "harm",
  "deception",
  "vulnerability",
  "privacy_intrusion",
  "evidence_strength",
] as const;

export type ScoringAxis = typeof SCORING_AXES[number];
export type AxisLevel = 0 | 1 | 2 | 3 | 4;
export type ScorableRiskFamily = Exclude<RiskFamily, "none">;

export interface CategoryAssessment {
  risk_family: ScorableRiskFamily;
  relevance: AxisLevel;
  certainty: AxisLevel;
  harm: AxisLevel;
  deception: AxisLevel;
  vulnerability: AxisLevel;
  privacy_intrusion: AxisLevel;
  evidence_strength: AxisLevel;
}

export interface CategoryFormulaScore {
  id: ScorableRiskFamily;
  label: string;
  score: number;
  ruleScore: number;
  aiScore: number;
  source: "rule" | "ai" | "hybrid";
  contextMultiplier: number;
  axes: Record<ScoringAxis, AxisLevel> | null;
}

export interface DeterministicScoreResult {
  policyVersion: typeof SCORING_POLICY_VERSION;
  finalScore: number;
  status: "no_match" | "review" | "attention" | "high";
  categoryScores: CategoryFormulaScore[];
  primaryCategory: CategoryFormulaScore | null;
  confidence: number | null;
  highRequiresReview: boolean;
  formula: string;
}

type WeightSet = Record<ScoringAxis, number>;

const LABELS: Record<ScorableRiskFamily, string> = {
  health_claim: "건강·의료 효능",
  financial_guarantee: "금융·투자 보장",
  income_claim: "소득·부업 보장",
  education_outcome: "교육·합격 결과",
  legal_outcome: "법률·행정 결과",
  privacy_intrusion: "개인정보·감시",
  urgency: "희소성·구매 압박",
  general_substantiation: "일반 입증 필요 주장",
};

const BASE: WeightSet = {
  relevance: 0.15,
  certainty: 0.2,
  harm: 0.2,
  deception: 0.15,
  vulnerability: 0.1,
  privacy_intrusion: 0.05,
  evidence_strength: 0.15,
};

const WEIGHTS: Record<ScorableRiskFamily, WeightSet> = {
  health_claim: { ...BASE, harm: 0.25, vulnerability: 0.15, deception: 0.1, privacy_intrusion: 0 },
  financial_guarantee: { ...BASE, certainty: 0.25, deception: 0.2, privacy_intrusion: 0, vulnerability: 0.05 },
  income_claim: { ...BASE, certainty: 0.25, deception: 0.2, privacy_intrusion: 0, vulnerability: 0.05 },
  education_outcome: { ...BASE, certainty: 0.25, vulnerability: 0.15, privacy_intrusion: 0, deception: 0.1 },
  legal_outcome: { ...BASE, certainty: 0.25, harm: 0.15, deception: 0.2, privacy_intrusion: 0 },
  privacy_intrusion: { ...BASE, relevance: 0.1, certainty: 0.1, harm: 0.2, deception: 0.1, vulnerability: 0.1, privacy_intrusion: 0.3, evidence_strength: 0.1 },
  urgency: { ...BASE, relevance: 0.2, harm: 0.1, deception: 0.25, vulnerability: 0.1, privacy_intrusion: 0 },
  general_substantiation: { ...BASE, relevance: 0.2, certainty: 0.2, harm: 0.1, deception: 0.2, privacy_intrusion: 0 },
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function normalizedWeights(weights: WeightSet) {
  const total = SCORING_AXES.reduce((sum, axis) => sum + weights[axis], 0) || 1;
  return Object.fromEntries(SCORING_AXES.map((axis) => [axis, weights[axis] / total])) as WeightSet;
}

function contextMultiplier(payload: InterpreterPayload | null) {
  if (!payload) return 1;
  if (payload.risk_intent === "contextual_only") {
    if (["warning", "criticism", "definition"].includes(payload.speech_act)) return 0.05;
    if (["quote", "report"].includes(payload.speech_act)) return 0.2;
    return 0.45;
  }
  if (payload.context_relation === "negates" || payload.policy_relevance === "none") return 0.05;
  if (payload.context_relation === "conditions" || payload.claim_strength === "limited") return 0.65;
  if (payload.risk_intent === "uncertain" || payload.policy_relevance === "uncertain") return 0.55;
  return 1;
}

function scoreAssessment(assessment: CategoryAssessment, multiplier: number) {
  const weights = normalizedWeights(WEIGHTS[assessment.risk_family]);
  const weighted = SCORING_AXES.reduce(
    (sum, axis) => sum + (assessment[axis] / 4) * weights[axis],
    0,
  );
  return clamp(Math.round(weighted * 100 * multiplier));
}

function familyForRuleCategory(category: string): ScorableRiskFamily {
  const value = category.toLocaleLowerCase("ko-KR");
  if (/(건강|의료|치료|완치|효능|감량|health|medical)/u.test(value)) return "health_claim";
  if (/(금융|투자|원금|수익|finance|investment)/u.test(value)) return "financial_guarantee";
  if (/(소득|부업|급여|income|earnings)/u.test(value)) return "income_claim";
  if (/(교육|합격|입시|education)/u.test(value)) return "education_outcome";
  if (/(법률|행정|승소|legal)/u.test(value)) return "legal_outcome";
  if (/(개인정보|위치|감시|추적|privacy)/u.test(value)) return "privacy_intrusion";
  if (/(긴급|희소|마감|urgency)/u.test(value)) return "urgency";
  return "general_substantiation";
}

function fallbackAssessment(payload: InterpreterPayload): CategoryAssessment[] {
  if (!payload.risk_family || payload.risk_family === "none" || payload.evidence_spans.length === 0) return [];
  const certainty: AxisLevel = payload.claim_strength === "absolute" ? 4
    : payload.claim_strength === "strong" ? 3
      : payload.claim_strength === "limited" ? 2 : 1;
  const relevance: AxisLevel = payload.policy_relevance === "potentially_high" ? 4
    : payload.policy_relevance === "substantiation" ? 3 : 1;
  return [{
    risk_family: payload.risk_family,
    relevance,
    certainty,
    harm: payload.policy_relevance === "potentially_high" ? 3 : 2,
    deception: certainty,
    vulnerability: payload.risk_family === "health_claim" || payload.risk_family === "legal_outcome" ? 3 : 1,
    privacy_intrusion: payload.risk_family === "privacy_intrusion" ? 4 : 0,
    evidence_strength: payload.evidence_spans.length > 1 ? 4 : 3,
  }];
}

function assessmentsFrom(payload: InterpreterPayload | null) {
  if (!payload) return [];
  const assessments = payload.category_assessments?.length
    ? payload.category_assessments
    : fallbackAssessment(payload);
  return assessments.filter((assessment) => assessment.relevance > 0 && assessment.evidence_strength > 0);
}

function statusFor(score: number, hasEvidence: boolean, highRequiresReview: boolean): DeterministicScoreResult["status"] {
  if (!hasEvidence) return "no_match";
  if (score >= 80) return highRequiresReview ? "review" : "high";
  if (score >= 70) return "attention";
  return "review";
}

export function calculateDeterministicScore(
  rules: AnalysisResult,
  payload: InterpreterPayload | null,
): DeterministicScoreResult {
  const multiplier = contextMultiplier(payload);
  const byFamily = new Map<ScorableRiskFamily, { ruleScore: number; assessment: CategoryAssessment | null }>();

  for (const category of rules.categoryScores) {
    const family = familyForRuleCategory(category.category);
    const current = byFamily.get(family) ?? { ruleScore: 0, assessment: null };
    current.ruleScore = Math.max(current.ruleScore, category.score);
    byFamily.set(family, current);
  }
  for (const assessment of assessmentsFrom(payload)) {
    const current = byFamily.get(assessment.risk_family) ?? { ruleScore: 0, assessment: null };
    if (!current.assessment || scoreAssessment(assessment, multiplier) > scoreAssessment(current.assessment, multiplier)) {
      current.assessment = assessment;
    }
    byFamily.set(assessment.risk_family, current);
  }

  const categoryScores = [...byFamily.entries()].map(([id, entry]): CategoryFormulaScore => {
    const aiScore = entry.assessment ? scoreAssessment(entry.assessment, multiplier) : 0;
    const score = Math.max(entry.ruleScore, aiScore);
    return {
      id,
      label: LABELS[id],
      score,
      ruleScore: entry.ruleScore,
      aiScore,
      source: entry.ruleScore > 0 && aiScore > 0 ? "hybrid" : entry.ruleScore > 0 ? "rule" : "ai",
      contextMultiplier: multiplier,
      axes: entry.assessment ? Object.fromEntries(SCORING_AXES.map((axis) => [axis, entry.assessment![axis]])) as Record<ScoringAxis, AxisLevel> : null,
    };
  }).filter((category) => category.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  const [top, second, third] = categoryScores;
  const crossCategorySupport = Math.min(10, Math.round((second?.score ?? 0) * 0.1 + (third?.score ?? 0) * 0.05));
  const finalScore = clamp((top?.score ?? 0) + crossCategorySupport);
  const hasRuleEvidence = rules.matches.length > 0;
  const hasAiEvidence = Boolean(payload?.evidence_spans.length && categoryScores.some((category) => category.aiScore > 0));
  const highRequiresReview = finalScore >= 80 && !hasRuleEvidence && hasAiEvidence;

  return {
    policyVersion: SCORING_POLICY_VERSION,
    finalScore,
    status: statusFor(finalScore, hasRuleEvidence || hasAiEvidence, highRequiresReview),
    categoryScores,
    primaryCategory: top ?? null,
    confidence: payload?.confidence ?? null,
    highRequiresReview,
    formula: "highest_category + min(10, second_category × 0.10 + third_category × 0.05)",
  };
}
