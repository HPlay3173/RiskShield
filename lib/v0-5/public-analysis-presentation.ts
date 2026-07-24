import type { RiskSkill } from "../riskshield.ts";
import type { InterpreterPayload } from "../v0-4/interpreter.ts";
import type { CategoryFormulaScore } from "./scoring.ts";

type AnalysisStatus = "no_match" | "review" | "attention" | "high";
type AiState = "ready" | "partial" | "fallback";

export type RewriteSuggestion = {
  style: "neutral" | "formal" | "concise";
  label: string;
  text: string;
  rationale: string;
  source: "reviewed_rule" | "family_template";
};

type FamilyCopy = {
  explanation: string;
  impact: string;
  review: string;
  rewrites: Array<Omit<RewriteSuggestion, "source">>;
};

const FAMILY_COPY: Record<string, FamilyCopy> = {
  health_claim: familyCopy(
    "치료 효과나 건강 결과를 확정적으로 받아들이게 할 수 있는 표현입니다.",
    "검증되지 않은 건강 결정을 유도하거나 치료 기대를 과도하게 높일 수 있습니다.",
    "효과의 근거, 적용 조건, 개인차와 한계를 함께 확인하세요.",
    ["개인에 따라 결과가 다를 수 있으며 확인된 범위에서만 도움을 줄 수 있습니다.", "확인된 근거와 적용 조건을 함께 제시하고 결과를 보장하지 않습니다.", "효과와 한계를 함께 밝혀 주세요."],
  ),
  financial_guarantee: familyCopy(
    "수익이나 손실 방지를 확정적으로 약속해 금융 판단을 왜곡할 수 있는 표현입니다.",
    "위험을 과소평가하게 하거나 충분한 검토 없이 금전 결정을 내리게 할 수 있습니다.",
    "손실 가능성, 조건, 수수료와 근거 자료를 함께 확인하세요.",
    ["수익과 손실 가능성이 모두 있으며 결과는 시장 상황에 따라 달라질 수 있습니다.", "예상 수익의 근거와 손실 가능성, 적용 조건을 함께 안내합니다.", "수익을 보장하지 않으며 손실 가능성이 있습니다."],
  ),
  income_claim: familyCopy(
    "소득이나 부업 성과를 누구나 얻을 수 있는 결과처럼 제시할 수 있습니다.",
    "필요한 시간·비용·조건을 가린 채 비현실적인 기대를 만들 수 있습니다.",
    "산정 기준, 실제 범위, 필요한 조건과 예외를 확인하세요.",
    ["소득은 경험, 투입 시간과 조건에 따라 달라질 수 있습니다.", "성과 사례의 산정 기준과 필요한 조건을 함께 제시하며 동일한 결과를 보장하지 않습니다.", "조건에 따라 소득 결과가 달라질 수 있습니다."],
  ),
  education_outcome: familyCopy(
    "합격이나 성적 향상을 확정된 결과처럼 받아들이게 할 수 있습니다.",
    "개인의 준비 정도와 평가 조건을 무시한 기대를 만들 수 있습니다.",
    "대상, 기간, 측정 방법과 결과의 개인차를 확인하세요.",
    ["학습 결과는 준비 과정과 개인의 상황에 따라 달라질 수 있습니다.", "교육 효과의 측정 기준과 적용 조건을 밝히며 합격이나 성적을 보장하지 않습니다.", "결과는 개인별로 달라질 수 있습니다."],
  ),
  legal_outcome: familyCopy(
    "법률 절차나 판정 결과를 미리 확정하는 것으로 오해될 수 있습니다.",
    "사건별 사실관계와 절차 차이를 가려 잘못된 법률 판단을 유도할 수 있습니다.",
    "개별 사안의 조건과 전문가 확인 필요성을 함께 밝혀 주세요.",
    ["결과는 구체적인 사실관계와 절차에 따라 달라질 수 있습니다.", "일반적인 정보이며 개별 사건의 결과를 보장하지 않으므로 전문가 확인이 필요합니다.", "사안별 검토가 필요하며 결과를 단정할 수 없습니다."],
  ),
  privacy_intrusion: familyCopy(
    "동의 없이 개인정보를 수집하거나 추적하는 행동으로 해석될 수 있습니다.",
    "사생활 침해, 정보 오용 또는 당사자의 통제권 상실로 이어질 수 있습니다.",
    "수집 목적, 동의, 보관 기간과 거부 방법을 명확히 확인하세요.",
    ["당사자의 명확한 동의를 받은 정보만 필요한 범위에서 사용합니다.", "수집 목적과 보관 기간을 안내하고 동의와 철회 절차를 제공합니다.", "동의 없이 개인정보를 수집하거나 추적하지 않습니다."],
  ),
  hate_discrimination: familyCopy(
    "특정 집단의 속성을 모든 구성원에게 일반화하거나 낮춰 말하는 표현입니다.",
    "편견을 강화하고 해당 집단에 대한 배제나 차별을 정당화할 수 있습니다.",
    "집단이 아니라 확인 가능한 개별 행동과 상황을 구체적으로 설명하세요.",
    ["집단 전체가 아니라 문제가 된 구체적인 행동이나 상황을 설명해 주세요.", "특정 집단에 대한 일반화를 피하고 확인된 사실과 개별 행동을 중심으로 표현합니다.", "집단이 아닌 행동을 말해 주세요."],
  ),
  abusive_language: familyCopy(
    "개인이나 대상을 모욕하거나 공격하는 의미로 받아들여질 수 있는 표현입니다.",
    "대화를 위축시키고 괴롭힘이나 갈등을 키울 수 있습니다.",
    "사람에 대한 평가 대신 문제가 된 행동과 원하는 변화를 설명하세요.",
    ["상대방을 낮춰 말하지 않고 문제가 된 행동을 구체적으로 설명해 주세요.", "인신공격을 제외하고 사실, 영향과 요청 사항을 중심으로 표현합니다.", "사람이 아닌 행동을 지적해 주세요."],
  ),
  coded_expression: familyCopy(
    "일부 공동체에서 비하나 공격 의미로 쓰이는 은어·코드 표현일 수 있습니다.",
    "겉뜻을 모르는 사람에게도 숨은 혐오나 괴롭힘을 전달할 수 있습니다.",
    "은어를 빼고 실제로 말하려는 사실이나 의견을 직접 표현하세요.",
    ["숨은 비하 표현 대신 구체적인 사실이나 의견을 직접 말해 주세요.", "공동체 은어와 암시를 제외하고 확인 가능한 행동과 상황을 명확하게 표현합니다.", "은어 없이 뜻을 직접 표현해 주세요."],
  ),
  violent_threat: familyCopy(
    "신체적 위해나 폭력을 가하겠다는 위협으로 받아들여질 수 있습니다.",
    "상대방에게 공포를 주고 실제 위험 행동을 촉진할 수 있습니다.",
    "위협을 제거하고 우려되는 상황, 경계와 필요한 도움을 구체적으로 말하세요.",
    ["폭력적 위협 없이 우려되는 상황과 필요한 조치를 구체적으로 말해 주세요.", "위해 의도를 제거하고 안전 문제와 해결 요청을 차분하게 설명합니다.", "위협 대신 필요한 조치를 요청해 주세요."],
  ),
  urgency: familyCopy(
    "충분히 생각할 시간을 주지 않고 즉시 행동하도록 압박할 수 있습니다.",
    "조건을 비교하거나 취소 가능성을 확인하기 전에 결정을 유도할 수 있습니다.",
    "실제 기한과 조건, 취소·변경 가능 여부를 함께 확인하세요.",
    ["실제 적용 기한과 조건을 확인한 뒤 충분히 검토해 결정해 주세요.", "기한과 적용 조건을 명확히 안내하고 사용자가 충분히 비교할 시간을 제공합니다.", "조건을 확인한 뒤 결정해 주세요."],
  ),
  general_substantiation: familyCopy(
    "근거가 필요한 비교·성과·최상급 주장을 사실처럼 단정할 수 있습니다.",
    "독자가 표현의 범위와 조건을 오해하거나 확인되지 않은 기대를 가질 수 있습니다.",
    "주장의 기준, 출처, 적용 범위와 예외를 확인하세요.",
    ["확인된 근거와 적용 범위를 함께 제시하고 결과를 단정하지 않습니다.", "비교 기준과 출처, 적용 조건 및 예외를 구체적으로 안내합니다.", "근거와 조건을 함께 밝혀 주세요."],
  ),
};

function familyCopy(explanation: string, impact: string, review: string, texts: [string, string, string]): FamilyCopy {
  const styles: RewriteSuggestion["style"][] = ["neutral", "formal", "concise"];
  const labels = ["중립적으로 바꾸기", "공식적으로 바꾸기", "짧게 바꾸기"];
  return {
    explanation,
    impact,
    review,
    rewrites: texts.map((text, index) => ({
      style: styles[index],
      label: labels[index],
      text,
      rationale: index === 0
        ? "위험한 단정이나 공격을 줄이고 전달하려는 핵심을 남겼습니다."
        : index === 1
          ? "공식 문구에 맞게 조건과 책임 범위를 분명히 했습니다."
          : "핵심 수정 방향만 짧고 직접적으로 표현했습니다.",
    })),
  };
}

const SPEECH_ACT_LABELS: Record<string, string> = {
  claim: "직접 주장",
  quote: "인용",
  criticism: "비판",
  warning: "경고",
  report: "보도·설명",
  definition: "정의",
  condition: "조건부 표현",
};

const RELATION_LABELS: Record<string, string> = {
  supports: "위험 의미를 지지함",
  negates: "위험 의미를 부정함",
  warns_about: "위험 표현을 경고함",
  reports: "타인의 표현을 전달함",
  defines: "표현의 뜻을 설명함",
  conditions: "조건을 붙여 설명함",
};

const INTENT_LABELS: Record<string, string> = {
  direct_harmful: "직접적인 유해 표현",
  direct_promotional: "직접적인 홍보·권유",
  contextual_only: "인용·설명 중심",
  uncertain: "의도 확인 필요",
};

const TARGET_LABELS: Record<string, string> = {
  individual: "특정 개인",
  protected_group: "보호 대상 집단",
  regional_group: "지역 집단",
  community: "공동체",
  health: "건강·치료",
  finance: "금융·투자",
  education: "교육·합격",
  legal: "법률 결과",
  privacy: "개인정보",
  general: "일반 독자",
  none: "특정 대상 없음",
};

function contextSummary(payload: InterpreterPayload | null, aiState: AiState) {
  if (!payload || aiState === "fallback") {
    return "AI 문맥 해석을 사용하지 못해 검토된 규칙의 표현과 주변 문맥만 확인했습니다.";
  }
  const relation = payload.context_relation;
  if (relation === "negates") return "위험한 의미를 직접 주장하기보다 부정하는 문맥으로 해석했습니다.";
  if (relation === "warns_about") return "문제가 될 수 있는 표현을 사용하지 말라고 경고하는 문맥으로 해석했습니다.";
  if (relation === "reports") return "화자의 직접 주장보다 다른 사람의 말이나 사건을 전달하는 문맥으로 해석했습니다.";
  if (relation === "defines") return "표현을 공격에 사용하기보다 그 뜻을 설명하는 문맥으로 해석했습니다.";
  if (relation === "conditions") return "결과를 단정하기보다 조건을 붙여 설명하는 문맥으로 해석했습니다.";
  return "화자가 해당 의미를 직접 지지하거나 주장하는 문맥으로 해석했습니다.";
}

function uniqueText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

export function buildRewriteSuggestions(
  status: AnalysisStatus,
  family: string | null,
  skill: RiskSkill | null,
): RewriteSuggestion[] {
  if (status === "no_match" || !family) return [];
  const templates = FAMILY_COPY[family]?.rewrites ?? FAMILY_COPY.general_substantiation.rewrites;
  const candidates: RewriteSuggestion[] = [
    ...(skill?.safeRewrite ?? []).map((text, index) => ({
      style: (["neutral", "formal", "concise"] as const)[Math.min(index, 2)],
      label: (["검토된 대체 표현", "검토된 공식 표현", "검토된 짧은 표현"] as const)[Math.min(index, 2)],
      text: text.trim(),
      rationale: "검토된 위험 규칙에 함께 등록된 대체 표현입니다.",
      source: "reviewed_rule" as const,
    })),
    ...templates.map((item) => ({ ...item, source: "family_template" as const })),
  ];
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = uniqueText(item.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

export function buildPublicAnalysisPresentation(input: {
  status: AnalysisStatus;
  primaryCategory: CategoryFormulaScore | null;
  primarySkill: RiskSkill | null;
  ruleReason: string | null;
  payload: InterpreterPayload | null;
  aiState: AiState;
  uncertainty: { level: "low" | "medium" | "high"; reason: string };
}) {
  const family = input.primaryCategory?.id ?? null;
  const copy = family ? FAMILY_COPY[family] ?? FAMILY_COPY.general_substantiation : null;
  const source = input.primaryCategory?.source ?? null;
  return {
    primaryRisk: input.primaryCategory && copy ? {
      family,
      label: input.primaryCategory.label,
      score: input.primaryCategory.score,
      source,
      sourceLabel: source === "hybrid" ? "검토된 규칙 + AI 문맥" : source === "rule" ? "검토된 규칙" : "AI 문맥 해석",
      explanation: source !== "ai" && input.ruleReason ? input.ruleReason : copy.explanation,
      potentialImpact: copy.impact,
      reviewGuidance: copy.review,
    } : null,
    contextInterpretation: {
      speechAct: input.payload ? SPEECH_ACT_LABELS[input.payload.speech_act] ?? "확인 필요" : "확인 필요",
      relation: input.payload ? RELATION_LABELS[input.payload.context_relation] ?? "관계 확인 필요" : "AI 문맥 미사용",
      intent: input.payload ? INTENT_LABELS[input.payload.risk_intent] ?? "의도 확인 필요" : "AI 문맥 미사용",
      target: input.payload ? TARGET_LABELS[input.payload.claim_target] ?? "대상 확인 필요" : "대상 확인 필요",
      summary: contextSummary(input.payload, input.aiState),
      aiState: input.aiState,
      uncertaintyLevel: input.uncertainty.level,
      uncertaintyReason: input.uncertainty.reason,
    },
    rewriteSuggestions: buildRewriteSuggestions(input.status, family, input.primarySkill),
  };
}
