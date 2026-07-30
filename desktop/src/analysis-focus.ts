import type {
  AiFinding,
  AnalysisFocus,
  RulesAnalysis,
} from "./types";

const CLAIM_TERMS = [
  "광고", "과장", "기만", "보장", "수익", "금융", "투자", "의료", "교육", "입시", "효능",
];
const CONTEXT_TERMS = [
  "역사", "혐오", "차별", "욕설", "공격", "폭력", "위협", "은어", "커뮤니티", "문화", "정치",
];

function categoryPriority(category: string, focus: AnalysisFocus) {
  if (focus === "balanced") return 0;
  const terms = focus === "claim" ? CLAIM_TERMS : CONTEXT_TERMS;
  return terms.some((term) => category.includes(term)) ? 1 : 0;
}

function severityPriority(severity: AiFinding["severity"]) {
  if (severity === "high") return 3;
  if (severity === "review") return 2;
  return 1;
}

export function orderAiFindings(findings: AiFinding[], focus: AnalysisFocus) {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) =>
      categoryPriority(right.finding.category, focus)
        - categoryPriority(left.finding.category, focus)
      || severityPriority(right.finding.severity) - severityPriority(left.finding.severity)
      || right.finding.confidence - left.finding.confidence
      || left.index - right.index)
    .map(({ finding }) => finding);
}

export function orderRuleMatches(
  matches: RulesAnalysis["matches"],
  focus: AnalysisFocus,
) {
  return matches
    .map((match, index) => ({ match, index }))
    .sort((left, right) =>
      categoryPriority(right.match.skill.category, focus)
        - categoryPriority(left.match.skill.category, focus)
      || right.match.score - left.match.score
      || left.index - right.index)
    .map(({ match }) => match);
}

export const FOCUS_COPY: Record<AnalysisFocus, {
  label: string;
  description: string;
}> = {
  balanced: {
    label: "균형 분석",
    description: "모든 위험 유형을 위험도 순으로 표시",
  },
  claim: {
    label: "광고·주장",
    description: "과장·보장·전문서비스 표현을 먼저 표시",
  },
  context: {
    label: "문맥 우선",
    description: "역사·혐오·은어·공격 문맥을 먼저 표시",
  },
};
