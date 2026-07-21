// @ts-expect-error Node 22 direct TypeScript execution requires the runtime extension.
import { riskFamilyForPatternType, type ScorableRiskFamily } from "../risk-family.ts";
import type { AnalysisResult, PatternHit } from "../riskshield.ts";
import type { EvidenceSpan, InterpreterPayload } from "../v0-4/interpreter.ts";

export const SCORING_POLICY_VERSION = "3.2.0" as const;

export const SCORING_AXES = [
  "relevance", "certainty", "harm", "deception", "vulnerability", "privacy_intrusion", "evidence_strength",
] as const;

export type ScoringAxis = typeof SCORING_AXES[number];
export type AxisLevel = 0 | 1 | 2 | 3 | 4;

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
  sameClaimCorroborated: boolean;
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
  conflict: boolean;
  decisionReasons: readonly string[];
  formula: string;
  experimental: true;
}

type WeightSet = Record<ScoringAxis, number>;

const LABELS: Record<ScorableRiskFamily, string> = {
  health_claim: "건강·치료 효능",
  financial_guarantee: "금융·투자 보장",
  income_claim: "소득·부업 보장",
  education_outcome: "교육·합격 결과",
  legal_outcome: "법률·판정 결과",
  privacy_intrusion: "개인정보·감시",
  hate_discrimination: "혐오·차별",
  abusive_language: "욕설·공격",
  coded_expression: "숨은 은어·코드 표현",
  violent_threat: "폭력·위협",
  urgency: "희소성·구매 압박",
  general_substantiation: "일반 입증 필요 주장",
};

const BASE: WeightSet = {
  relevance: 0.15, certainty: 0.2, harm: 0.2, deception: 0.15,
  vulnerability: 0.1, privacy_intrusion: 0.05, evidence_strength: 0.15,
};

const WEIGHTS: Record<ScorableRiskFamily, WeightSet> = {
  health_claim: { ...BASE, harm: 0.25, vulnerability: 0.15, deception: 0.1, privacy_intrusion: 0 },
  financial_guarantee: { ...BASE, certainty: 0.25, deception: 0.2, privacy_intrusion: 0, vulnerability: 0.05 },
  income_claim: { ...BASE, certainty: 0.25, deception: 0.2, privacy_intrusion: 0, vulnerability: 0.05 },
  education_outcome: { ...BASE, certainty: 0.25, vulnerability: 0.15, privacy_intrusion: 0, deception: 0.1 },
  legal_outcome: { ...BASE, certainty: 0.25, harm: 0.15, deception: 0.2, privacy_intrusion: 0 },
  privacy_intrusion: { ...BASE, relevance: 0.1, certainty: 0.1, harm: 0.2, deception: 0.1, vulnerability: 0.1, privacy_intrusion: 0.3, evidence_strength: 0.1 },
  hate_discrimination: { ...BASE, relevance: 0.18, certainty: 0.12, harm: 0.26, deception: 0.04, vulnerability: 0.2, privacy_intrusion: 0, evidence_strength: 0.2 },
  abusive_language: { ...BASE, relevance: 0.2, certainty: 0.16, harm: 0.24, deception: 0.02, vulnerability: 0.14, privacy_intrusion: 0, evidence_strength: 0.24 },
  coded_expression: { ...BASE, relevance: 0.2, certainty: 0.14, harm: 0.2, deception: 0.08, vulnerability: 0.12, privacy_intrusion: 0, evidence_strength: 0.26 },
  violent_threat: { ...BASE, relevance: 0.16, certainty: 0.2, harm: 0.3, deception: 0, vulnerability: 0.14, privacy_intrusion: 0, evidence_strength: 0.2 },
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

function clauseBounds(input: string, offset: number) {
  const safeOffset = Math.max(0, Math.min(input.length, offset));
  const separators = [".", ",", "!", "?", ";", ":", "\n"];
  const start = Math.max(
    ...separators.map((separator) => input.lastIndexOf(separator, Math.max(0, safeOffset - 1))),
  ) + 1;
  const candidates = separators
    .map((separator) => input.indexOf(separator, safeOffset))
    .filter((value) => value >= 0);
  return { start, end: candidates.length ? Math.min(...candidates) + 1 : input.length };
}

function overlaps(left: { start: number; end: number }, right: { start: number; end: number }) {
  return left.start < right.end && right.start < left.end;
}

function sameClaimEvidence(input: string, ruleHits: readonly PatternHit[], aiSpans: readonly EvidenceSpan[]) {
  return ruleHits.some((hit) => aiSpans.some((span) =>
    overlaps(hit, span) || overlaps(clauseBounds(input, hit.start), clauseBounds(input, span.start))
  ));
}

function serverEvidenceStrength(payload: InterpreterPayload, sameClaimCorroborated: boolean): AxisLevel {
  const distinctQuotes = new Set(payload.evidence_spans.map((span) => span.text.trim()).filter(Boolean));
  if (sameClaimCorroborated && distinctQuotes.size > 1) return 4;
  if (sameClaimCorroborated || distinctQuotes.size > 1) return 3;
  return distinctQuotes.size === 1 ? 2 : 0;
}

function confidenceCap(confidence: number) {
  if (confidence >= 0.9) return 89;
  if (confidence >= 0.8) return 79;
  if (confidence >= 0.65) return 69;
  return 0;
}

function scoreAssessment(assessment: CategoryAssessment, multiplier: number, evidenceStrength: AxisLevel, confidence: number) {
  const weights = normalizedWeights(WEIGHTS[assessment.risk_family]);
  const weighted = SCORING_AXES.reduce(
    (sum, axis) => sum + ((axis === "evidence_strength" ? evidenceStrength : assessment[axis]) / 4) * weights[axis], 0,
  );
  return Math.min(confidenceCap(confidence), clamp(Math.round(weighted * 100 * multiplier)));
}

function fallbackAssessment(payload: InterpreterPayload): CategoryAssessment[] {
  if (!payload.risk_family || payload.risk_family === "none" || payload.evidence_spans.length === 0) return [];
  const certainty: AxisLevel = payload.claim_strength === "absolute" ? 4
    : payload.claim_strength === "strong" ? 3 : payload.claim_strength === "limited" ? 2 : 1;
  const relevance: AxisLevel = payload.policy_relevance === "potentially_high" ? 4
    : payload.policy_relevance === "substantiation" ? 3 : 1;
  return [{
    risk_family: payload.risk_family,
    relevance,
    certainty,
    harm: payload.policy_relevance === "potentially_high" ? 3 : 2,
    deception: certainty,
    vulnerability: ["health_claim", "legal_outcome", "hate_discrimination", "violent_threat"].includes(payload.risk_family) ? 3 : 1,
    privacy_intrusion: payload.risk_family === "privacy_intrusion" ? 4 : 0,
    evidence_strength: payload.evidence_spans.length > 1 ? 4 : 3,
  }];
}

function assessmentsFrom(payload: InterpreterPayload | null) {
  if (!payload) return [];
  const assessments = payload.category_assessments?.length ? payload.category_assessments : fallbackAssessment(payload);
  return assessments.filter((assessment) =>
    assessment.relevance > 0 && payload.evidence_spans.length > 0
    && payload.risk_family !== "none" && assessment.risk_family === payload.risk_family
  );
}

function statusFor(score: number, hasEvidence: boolean, highRequiresReview: boolean): DeterministicScoreResult["status"] {
  if (!hasEvidence) return "no_match";
  if (score >= 80) return highRequiresReview ? "review" : "high";
  if (score >= 70) return "attention";
  return "review";
}

export function calculateDeterministicScore(rules: AnalysisResult, payload: InterpreterPayload | null): DeterministicScoreResult {
  const multiplier = contextMultiplier(payload);
  const byFamily = new Map<ScorableRiskFamily, { ruleScore: number; ruleHits: PatternHit[]; assessment: CategoryAssessment | null }>();

  for (const category of rules.categoryScores) {
    const supportingMatches = rules.matches.filter((match) => match.skill.category === category.category);
    const supportingMatch = supportingMatches[0];
    const family = supportingMatch?.skill.riskFamily ?? riskFamilyForPatternType(supportingMatch?.skill.patternType ?? "");
    const current = byFamily.get(family) ?? { ruleScore: 0, ruleHits: [], assessment: null };
    current.ruleScore = Math.max(current.ruleScore, category.score);
    current.ruleHits.push(...supportingMatches.flatMap((match) => match.hits));
    byFamily.set(family, current);
  }

  for (const assessment of assessmentsFrom(payload)) {
    const current = byFamily.get(assessment.risk_family) ?? { ruleScore: 0, ruleHits: [], assessment: null };
    const corroborated = payload ? sameClaimEvidence(rules.input, current.ruleHits, payload.evidence_spans) : false;
    const evidenceStrength = payload ? serverEvidenceStrength(payload, corroborated) : 0;
    const confidence = payload?.confidence ?? 0;
    if (!current.assessment || scoreAssessment(assessment, multiplier, evidenceStrength, confidence)
      > scoreAssessment(current.assessment, multiplier, evidenceStrength, confidence)) {
      current.assessment = assessment;
    }
    byFamily.set(assessment.risk_family, current);
  }

  const categoryScores = [...byFamily.entries()].map(([id, entry]): CategoryFormulaScore => {
    const corroborated = payload ? sameClaimEvidence(rules.input, entry.ruleHits, payload.evidence_spans) : false;
    const evidenceStrength = payload ? serverEvidenceStrength(payload, corroborated) : 0;
    const aiScore = entry.assessment && payload
      ? scoreAssessment(entry.assessment, multiplier, evidenceStrength, payload.confidence) : 0;
    const score = Math.max(entry.ruleScore, aiScore);
    return {
      id, label: LABELS[id], score, ruleScore: entry.ruleScore, aiScore,
      source: entry.ruleScore > 0 && aiScore > 0 ? "hybrid" : entry.ruleScore > 0 ? "rule" : "ai",
      contextMultiplier: multiplier,
      sameClaimCorroborated: corroborated,
      axes: entry.assessment
        ? Object.fromEntries(SCORING_AXES.map((axis) => [axis, axis === "evidence_strength" ? evidenceStrength : entry.assessment![axis]])) as Record<ScoringAxis, AxisLevel>
        : null,
    };
  }).filter((category) => category.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  const ruleFamilies = new Set(categoryScores.filter((category) => category.ruleScore > 0).map((category) => category.id));
  const aiFamily = payload?.risk_family && payload.risk_family !== "none" ? payload.risk_family : null;
  const contextualOnly = Boolean(payload && payload.risk_intent === "contextual_only" && payload.policy_relevance === "none");
  const contextConflict = contextualOnly && ruleFamilies.size > 0;
  const familyConflict = Boolean(aiFamily && ruleFamilies.size > 0 && !ruleFamilies.has(aiFamily));
  const conflict = contextConflict || familyConflict;
  const suppressed = contextualOnly && ruleFamilies.size === 0;
  const top = suppressed ? null : categoryScores[0] ?? null;
  const finalScore = suppressed ? 0 : top?.score ?? 0;
  const hasRuleEvidence = !suppressed && rules.matches.length > 0;
  const hasAiEvidence = !suppressed && Boolean(payload?.evidence_spans.length && categoryScores.some((category) => category.aiScore > 0));
  const aiDrivesPrimary = Boolean(top && top.aiScore > 0 && top.aiScore >= top.ruleScore);
  const highRequiresReview = finalScore >= 80 && aiDrivesPrimary && !top?.sameClaimCorroborated;
  const status = suppressed ? "no_match" as const
    : conflict && (hasRuleEvidence || hasAiEvidence) ? "review" as const
      : statusFor(finalScore, hasRuleEvidence || hasAiEvidence, highRequiresReview);
  const decisionReasons = [
    ...(contextConflict ? ["context_policy_conflict"] : []),
    ...(familyConflict ? ["risk_family_conflict"] : []),
    ...(highRequiresReview ? ["ai_only_high_requires_review"] : []),
    ...(suppressed ? ["contextual_only_suppressed"] : []),
  ];

  return {
    policyVersion: SCORING_POLICY_VERSION,
    finalScore, status, categoryScores: suppressed ? [] : categoryScores,
    primaryCategory: suppressed ? null : top,
    confidence: payload?.confidence ?? null,
    highRequiresReview, conflict, decisionReasons,
    formula: "max(rule floor, confidence-capped AI assessment); same-claim evidence corroboration; one primary risk family; no cross-category bonus",
    experimental: true,
  };
}

export function decisionReasonForScore(result: DeterministicScoreResult) {
  if (result.status === "no_match") return "직접 위험 주장으로 연결되는 규칙 또는 문맥 근거를 확인하지 못했습니다.";
  if (result.decisionReasons.includes("context_policy_conflict")) return "규칙 근거와 AI 문맥 해석이 충돌해 자동 결론 대신 사람 검토로 전환했습니다.";
  if (result.decisionReasons.includes("risk_family_conflict")) return "규칙과 AI가 서로 다른 위험 분야를 가리켜 사람 검토가 필요합니다.";
  if (result.highRequiresReview) return "AI가 높은 위험 신호를 찾았지만 같은 주장에 연결된 규칙 근거가 없어 사람 확인이 필요합니다.";
  if (result.status === "high") return "같은 주장에 연결된 규칙과 문맥 근거가 높은 위험을 가리킵니다.";
  if (result.status === "attention") return "직접 위험 근거가 확인되어 주의가 필요합니다.";
  return "위험 관련 근거가 있으나 자동 결론보다 사람 검토가 적절합니다.";
}
