import type { AnalysisResult } from "../riskshield";
import type { InterpreterPayload } from "../v0-4/interpreter";
import {
  calculateDeterministicScore,
  type CategoryFormulaScore,
  type DeterministicScoreResult,
} from "./scoring";

export const DOCUMENT_SCORING_POLICY_VERSION = "4.1.0" as const;
export const MAX_DOCUMENT_CLAIMS = 20;

export type ClaimSegment = {
  id: string;
  text: string;
  start: number;
  end: number;
};

export type ClaimScore = ClaimSegment & {
  scoring: DeterministicScoreResult;
  rules: AnalysisResult;
  payload: InterpreterPayload | null;
};

export type DocumentScore = Omit<DeterministicScoreResult, "policyVersion" | "formula"> & {
  policyVersion: typeof DOCUMENT_SCORING_POLICY_VERSION;
  formula: string;
  claimCount: number;
  riskyClaimCount: number;
  aggregateBonus: number;
};

const TERMINAL = /[^.!?。！？\n]+(?:[.!?。！？]+|\n|$)/gu;
const CLAUSE = /[^,;，；]+(?:[,;，；]+|$)/gu;

function trimmedSegment(input: string, rawStart: number, rawEnd: number): ClaimSegment | null {
  let start = rawStart;
  let end = rawEnd;
  while (start < end && /\s/u.test(input[start])) start += 1;
  while (end > start && /\s/u.test(input[end - 1])) end -= 1;
  if (end <= start) return null;
  return { id: `claim_${start}_${end}`, text: input.slice(start, end), start, end };
}

export function segmentClaims(input: string, limit = MAX_DOCUMENT_CLAIMS): ClaimSegment[] {
  const sentences: ClaimSegment[] = [];
  for (const match of input.matchAll(TERMINAL)) {
    const start = match.index ?? 0;
    const segment = trimmedSegment(input, start, start + match[0].length);
    if (segment) sentences.push(segment);
  }
  const base = sentences.length
    ? sentences
    : [trimmedSegment(input, 0, input.length)].filter(Boolean) as ClaimSegment[];
  const claims: ClaimSegment[] = [];
  for (const sentence of base) {
    if (sentence.text.length <= 280 || claims.length >= limit - 1) {
      claims.push(sentence);
      continue;
    }
    for (const match of sentence.text.matchAll(CLAUSE)) {
      const localStart = match.index ?? 0;
      const segment = trimmedSegment(
        input,
        sentence.start + localStart,
        sentence.start + localStart + match[0].length,
      );
      if (segment) claims.push(segment);
      if (claims.length >= limit) break;
    }
  }
  return claims.slice(0, limit);
}

function aggregateCategories(claims: readonly ClaimScore[]) {
  const byFamily = new Map<string, CategoryFormulaScore>();
  for (const claim of claims) {
    for (const category of claim.scoring.categoryScores) {
      const existing = byFamily.get(category.id);
      if (!existing || category.score > existing.score) byFamily.set(category.id, category);
    }
  }
  return [...byFamily.values()].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function normalizedClaimKey(claim: ClaimScore) {
  return claim.text.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

export function aggregateDocumentScore(claims: readonly ClaimScore[]): DocumentScore {
  const uniqueRisky = new Map<string, ClaimScore>();
  for (const claim of claims) {
    if (claim.scoring.status === "no_match" || claim.scoring.finalScore <= 0) continue;
    const key = normalizedClaimKey(claim);
    const existing = uniqueRisky.get(key);
    if (!existing || claim.scoring.finalScore > existing.scoring.finalScore) uniqueRisky.set(key, claim);
  }
  const risky = [...uniqueRisky.values()]
    .sort((left, right) => right.scoring.finalScore - left.scoring.finalScore || left.start - right.start);
  const top = risky[0]?.scoring ?? null;
  const aggregateBonus = 0;
  const finalScore = top?.finalScore ?? 0;
  const conflict = risky.some((claim) => claim.scoring.conflict);
  const highRequiresReview = Boolean(top?.highRequiresReview);
  const status = !top ? "no_match" as const
    : conflict || highRequiresReview ? "review" as const
      : finalScore >= 80 ? "high" as const
        : finalScore >= 70 ? "attention" as const
          : "review" as const;
  const categoryScores = aggregateCategories(claims);
  return {
    policyVersion: DOCUMENT_SCORING_POLICY_VERSION,
    finalScore,
    status,
    categoryScores,
    primaryCategory: top?.primaryCategory ?? categoryScores[0] ?? null,
    confidence: top?.confidence ?? null,
    highRequiresReview,
    conflict,
    decisionReasons: top?.decisionReasons ?? [],
    formula: "highest independent claim only; other risky claims are reported without score bonuses",
    experimental: true,
    claimCount: claims.length,
    riskyClaimCount: risky.length,
    aggregateBonus,
  };
}

export function scoreClaim(segment: ClaimSegment, rules: AnalysisResult, payload: InterpreterPayload | null): ClaimScore {
  return { ...segment, rules, payload, scoring: calculateDeterministicScore(rules, payload) };
}

export function documentDecisionReason(result: DocumentScore) {
  if (result.status === "no_match") return "입력한 주장별 분석에서 직접 위험 근거를 확인하지 못했습니다.";
  if (result.conflict) return "일부 주장에서 규칙과 AI 문맥 신호가 충돌해 사람 검토로 전환했습니다.";
  if (result.highRequiresReview) return "높은 AI 신호가 있지만 같은 주장에 연결된 규칙 근거가 부족해 사람 확인이 필요합니다.";
  if (result.status === "high") return "가장 위험한 독립 주장에 규칙과 문맥 근거가 높은 위험을 가리킵니다.";
  if (result.status === "attention") return "하나 이상의 독립 주장에서 직접 위험 근거가 확인되어 주의가 필요합니다.";
  return "위험 관련 근거가 있으나 자동 결론보다 사람 검토가 적절합니다.";
}
