export const RISK_SKILL_SCHEMA_VERSION = "2.0.0" as const;

export type ReviewStatus = "draft" | "reviewed" | "rejected";

export type PatternRole = "trigger" | "context";

export type PatternScope = "sentence" | "paragraph";

export interface SeverityRules {
  schemaVersion: "1.0.0";
  scoringStrategy: "dominant_risk";
  noMatchScore: number;
  categoryCorroborationPerPattern: number;
  maxCategoryCorroboration: number;
  secondaryCategoryWeight: number;
  tertiaryCategoryWeight: number;
  maxCrossCategorySupport: number;
  gradeThresholds: Array<{
    grade: AnalysisResult["grade"];
    min: number;
    max: number;
  }>;
}

export interface RiskSource {
  title: string;
  url: string;
  date: string;
  sourceId?: string;
  provenanceStatus?: "provided" | "verified" | "synthetic_unverified";
}

export interface RiskSkill {
  schemaVersion: typeof RISK_SKILL_SCHEMA_VERSION;
  revision: number;
  id: string;
  category: string;
  subcategory: string;
  patternType: string;
  triggerPatterns: string[];
  contextPatterns: string[];
  anyOfPatterns: string[];
  exclusionPatterns?: string[];
  conditionScope: PatternScope;
  maxDistance: number;
  surfaceMeaning: string;
  riskSummary: string;
  socialContext: string;
  legalOrEthicIssue: string;
  riskReason: string;
  severityFloor: number;
  dominantRisk: boolean;
  confidence: number;
  riskDomain: string;
  recentContextTags: string[];
  safeRewrite: string[];
  falsePositiveNote: string;
  notes: string;
  source: RiskSource;
  createdAt: string;
  updatedAt: string;
  reviewStatus: ReviewStatus;
}

export interface PatternHit {
  pattern: string;
  role: PatternRole;
  start: number;
  end: number;
  text: string;
  sentenceIndex?: number;
}

export interface SkillMatch {
  skill: RiskSkill;
  hits: PatternHit[];
  score: number;
}

export interface CategoryScore {
  category: string;
  score: number;
  skillIds: string[];
}

export interface AnalysisResult {
  input: string;
  finalScore: number;
  grade: "미탐지" | "낮음" | "유의" | "주의" | "높음";
  recommendation: string;
  dominantFloor: number;
  topCategoryScore: number;
  categoryScores: CategoryScore[];
  matches: SkillMatch[];
  primaryMatch: SkillMatch | null;
  generatedAt: string;
}

export interface HighlightSegment {
  text: string;
  role: PatternRole | "plain" | "both";
  start: number;
  end: number;
}

export interface CaseInput {
  text: string;
  description: string;
  domain: string;
  occurredAt: string;
  sourceUrl: string;
  memo: string;
}

export interface SkillInterpreter {
  readonly id: string;
  readonly label: string;
  interpret(input: CaseInput, skills: RiskSkill[], now?: Date): RiskSkill;
}

export interface CsvSummary {
  profile: "controversy" | "false_advertising" | "hate_speech" | "generic";
  headers: string[];
  rowCount: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  uniqueRoots: number;
  categories: Array<{ name: string; count: number }>;
  encoding: "utf-8";
  stagedPreviewCount: number;
}

export interface ExportBundle {
  riskSkillsJsonl: string;
  trendContext: Record<string, unknown>;
  severityRules: Record<string, unknown>;
  rewriteTemplates: Record<string, unknown>;
  sourceIndex: Record<string, unknown>;
}

export interface BundleFiles {
  "risk_skills.jsonl": string;
  "trend_context.json"?: string;
  "severity_rules.json"?: string;
  "rewrite_templates.json"?: string;
  "source_index.json"?: string;
}

export interface ParsedBundle {
  skills: RiskSkill[];
  severityRules: SeverityRules;
  filesLoaded: string[];
  issues: string[];
}

export const DEFAULT_SEVERITY_RULES: SeverityRules = {
  schemaVersion: "1.0.0",
  scoringStrategy: "dominant_risk",
  noMatchScore: 0,
  categoryCorroborationPerPattern: 2,
  maxCategoryCorroboration: 6,
  secondaryCategoryWeight: 0.1,
  tertiaryCategoryWeight: 0.05,
  maxCrossCategorySupport: 10,
  gradeThresholds: [
    { grade: "미탐지", min: 0, max: 0 },
    { grade: "낮음", min: 1, max: 44 },
    { grade: "유의", min: 45, max: 69 },
    { grade: "주의", min: 70, max: 84 },
    { grade: "높음", min: 85, max: 100 },
  ],
};

const HANDOFF_SOURCE: RiskSource = {
  title: "RiskShield AI Programmer Handoff · expected behavior",
  url: "",
  date: "2026-07-17",
  sourceId: "handoff_expected_behavior",
  provenanceStatus: "provided",
};

const SEED_DATE = "2026-07-17T00:00:00.000Z";

function seedSkill(
  skill: Omit<
    RiskSkill,
    | "schemaVersion"
    | "revision"
    | "anyOfPatterns"
    | "conditionScope"
    | "maxDistance"
    | "notes"
    | "createdAt"
    | "updatedAt"
    | "source"
    | "reviewStatus"
  > & {
    reviewStatus?: ReviewStatus;
    source?: RiskSource;
    schemaVersion?: typeof RISK_SKILL_SCHEMA_VERSION;
    revision?: number;
    anyOfPatterns?: string[];
    conditionScope?: PatternScope;
    maxDistance?: number;
    notes?: string;
  },
): RiskSkill {
  return {
    ...skill,
    schemaVersion: skill.schemaVersion ?? RISK_SKILL_SCHEMA_VERSION,
    revision: skill.revision ?? 1,
    anyOfPatterns: skill.anyOfPatterns ?? [],
    conditionScope: skill.conditionScope ?? "sentence",
    maxDistance: skill.maxDistance ?? 48,
    notes: skill.notes ?? "",
    source: skill.source ?? HANDOFF_SOURCE,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
    reviewStatus: skill.reviewStatus ?? "reviewed",
  };
}

export const starterSkills: RiskSkill[] = [
  seedSkill({
    id: "risk_legal_000001",
    category: "고위험 전문서비스 광고",
    subcategory: "법률 판단 자동화·시간 단축 과장",
    patternType: "short_time_claim + legal_judgment",
    triggerPatterns: [
      "re:(?:\\d{1,3}\\s*(?:초|분)\\s*(?:만에|이내|내)|즉시|바로)",
    ],
    contextPatterns: [
      "re:(?:형량|승소\\s*가능성|무죄\\s*가능성|사건\\s*결과)(?:을|를|은|는)?\\s*(?:분석|예측|판단|진단)",
      "법률 판단",
    ],
    surfaceMeaning: "매우 짧은 시간 안에 법률상 결과를 분석할 수 있다고 주장합니다.",
    riskSummary: "복잡한 법률 판단이 즉시 정확하게 가능한 것처럼 보일 수 있습니다.",
    socialContext: "자동화된 전문 판단의 정확성 과장에 대한 경계가 커지고 있습니다.",
    legalOrEthicIssue: "전문서비스의 한계를 감춰 소비자의 판단을 오도할 수 있습니다.",
    riskReason: "사실관계와 법리 검토가 필요한 법률 판단을 극단적으로 짧은 시간과 결합한 표현입니다.",
    severityFloor: 78,
    dominantRisk: true,
    confidence: 0.9,
    riskDomain: "법률 광고",
    recentContextTags: ["AI 법률 서비스", "전문직 광고", "자동화 판단"],
    safeRewrite: [
      "간단한 정보를 입력하면 주요 쟁점을 빠르게 정리해 드립니다.",
      "입력 내용을 바탕으로 참고용 법률 쟁점을 안내합니다.",
    ],
    falsePositiveNote: "예약·접수·화면 처리 시간만 안내하고 법률 결과를 판단하지 않는 경우는 제외합니다.",
  }),
  seedSkill({
    id: "risk_legal_000002",
    category: "고위험 전문서비스 광고",
    subcategory: "법률 결과·환불 보장",
    patternType: "legal_outcome + refund_guarantee",
    triggerPatterns: ["기각", "각하", "승소", "무죄", "불기소", "감형", "집행유예"],
    contextPatterns: [
      "re:(?:100\\s*%|전액)?\\s*환불",
      "환불 보장",
      "결과 보장",
      "승소 보장",
    ],
    surfaceMeaning: "특정 법률 결과와 환불 또는 보장을 직접 연결합니다.",
    riskSummary: "환불 조건이 법률 결과 보장처럼 인식될 수 있습니다.",
    socialContext: "전문서비스에서 성과 보장 문구는 소비자 오인 위험이 큽니다.",
    legalOrEthicIssue: "사건 결과와 서비스 조건을 직접 결부하면 과장 또는 기만으로 해석될 수 있습니다.",
    riskReason: "통제할 수 없는 법률 결과와 환불·보장을 결합해 결과를 사실상 보장하는 인상을 줍니다.",
    severityFloor: 85,
    dominantRisk: true,
    confidence: 0.94,
    riskDomain: "법률 광고",
    recentContextTags: ["전문직 광고", "성과 보장", "환불 조건"],
    safeRewrite: ["사건 진행 조건과 서비스 범위에 따른 환불 기준을 명확히 안내합니다."],
    falsePositiveNote: "법률 결과와 무관한 배송·시스템 장애 환불은 별도로 검토합니다.",
  }),
  seedSkill({
    id: "risk_history_000001",
    category: "역사·기념일 민감성",
    subcategory: "역사 기억의 상업적 이용",
    patternType: "historical_memory + discount_rate",
    triggerPatterns: ["잊지말자", "기억하자", "6·25", "6.25 전쟁", "3·1절", "삼일절", "광복절", "세월호 참사"],
    contextPatterns: [
      "re:(?:3\\s*1|4\\s*19|5\\s*18|6\\s*25|8\\s*15)\\s*%",
      "할인",
      "특가",
      "세일",
      "프로모션",
      "쿠폰",
    ],
    surfaceMeaning: "역사적 기억을 할인율이나 판매 혜택과 연결합니다.",
    riskSummary: "역사적 사건과 희생의 기억을 상업적으로 소비한다는 비판을 받을 수 있습니다.",
    socialContext: "기념일 숫자를 할인율로 치환하는 마케팅은 반복적으로 논란이 됩니다.",
    legalOrEthicIssue: "직접적인 법 위반과 별개로 추모와 존중의 맥락을 훼손할 윤리적 위험이 있습니다.",
    riskReason: "역사 기억 표현과 사건 날짜를 변형한 할인율 또는 판매 표현이 함께 등장합니다.",
    severityFloor: 86,
    dominantRisk: true,
    confidence: 0.93,
    riskDomain: "역사·기념일 광고",
    recentContextTags: ["전쟁 기억", "기념일 마케팅", "역사 상업화"],
    safeRewrite: ["호국의 의미를 기억하며 고객 감사 혜택을 준비했습니다."],
    falsePositiveNote: "판매 요소가 없는 역사 교육·추모 표현은 해당하지 않습니다.",
  }),
  seedSkill({
    id: "risk_brand_000001",
    category: "브랜드 평판 위험",
    subcategory: "공격적·성적 중의성",
    patternType: "aggressive_or_sexual_double_meaning + campaign_copy",
    triggerPatterns: ["침투하자", "파고들자", "쳐들어가자", "점령하자", "공략하자"],
    contextPatterns: ["더 깊게", "안으로 더", "끝까지 들어가", "더 세게", "몸속까지"],
    exclusionPatterns: ["침투 테스트", "모의 해킹", "취약점 진단", "보안 교육"],
    surfaceMeaning: "공격적 동작과 깊이를 강조하는 문구를 결합합니다.",
    riskSummary: "공격적 또는 성적 중의성으로 재해석되어 확산될 수 있습니다.",
    socialContext: "짧은 캠페인 문구는 의도보다 밈과 중의적 해석을 통해 빠르게 확산됩니다.",
    legalOrEthicIssue: "명백한 위법보다 브랜드 안전성과 수용자 존중의 문제가 큽니다.",
    riskReason: "공격적 명령형 표현과 성적 중의성을 만들 수 있는 깊이 표현이 결합됩니다.",
    severityFloor: 72,
    dominantRisk: true,
    confidence: 0.82,
    riskDomain: "브랜드 캠페인",
    recentContextTags: ["SNS 확산", "중의적 카피", "브랜드 세이프티"],
    safeRewrite: ["고객의 필요를 더 깊이 이해하는 캠페인을 시작합니다."],
    falsePositiveNote: "명확한 보안 교육·침투 테스트 설명은 제외합니다.",
  }),
  seedSkill({
    id: "risk_education_000001",
    category: "교육·입시 광고",
    subcategory: "교육 결과 보장",
    patternType: "education_outcome + guarantee",
    triggerPatterns: ["합격", "전교 1등", "성적 향상", "등급 상승", "명문대 진학"],
    contextPatterns: ["보장", "확정", "무조건", "반드시", "re:100\\s*%"],
    exclusionPatterns: ["합격자 발표", "최종 합격 통지"],
    surfaceMeaning: "합격이나 성적과 같은 교육 결과를 보장합니다.",
    riskSummary: "통제할 수 없는 입시 결과를 확정적으로 약속해 학부모와 학생을 오인시킬 수 있습니다.",
    socialContext: "입시 불안을 자극하는 성과 보장형 마케팅은 취약한 소비자에게 큰 영향을 줍니다.",
    legalOrEthicIssue: "객관적 근거 없이 교육 결과를 보장하면 과장 광고 위험이 있습니다.",
    riskReason: "교육 결과와 절대적 보장 표현이 결합합니다.",
    severityFloor: 80,
    dominantRisk: true,
    confidence: 0.91,
    riskDomain: "교육·입시 광고",
    recentContextTags: ["입시 불안", "교육 성과", "결과 보장"],
    safeRewrite: ["학습 목표 달성을 위한 맞춤형 관리 프로그램을 제공합니다."],
    falsePositiveNote: "학습 목표 또는 실제 합격자 발표는 결과 보장과 구분합니다.",
  }),
  seedSkill({
    id: "risk_medical_000001",
    category: "의료 광고",
    subcategory: "의료 효과 절대 보장",
    patternType: "medical_effect + absolute_guarantee",
    triggerPatterns: ["완치", "치료 효과", "질환 개선", "통증 제거", "재발 방지"],
    contextPatterns: ["re:100\\s*%", "완벽하게", "반드시", "영구적으로", "무조건"],
    surfaceMeaning: "의료적 효과를 절대적으로 보장합니다.",
    riskSummary: "개인차와 의학적 불확실성을 숨긴 고위험 효능 표현입니다.",
    socialContext: "건강 관련 의사결정에 직접 영향을 주므로 일반 상품 광고보다 높은 주의가 필요합니다.",
    legalOrEthicIssue: "검증되지 않은 치료 효과나 완치를 확정적으로 표현하면 의료 광고 위험이 있습니다.",
    riskReason: "의료 효과와 100% 같은 절대 표현이 결합합니다.",
    severityFloor: 88,
    dominantRisk: true,
    confidence: 0.96,
    riskDomain: "의료 광고",
    recentContextTags: ["의료 효능", "절대 표현", "소비자 건강"],
    safeRewrite: ["개인 상태에 따라 적절한 상담과 치료 방향을 안내합니다."],
    falsePositiveNote: "치료비 지원률이나 재료 함량처럼 의료 효과가 아닌 100% 수치는 구분합니다.",
  }),
  seedSkill({
    id: "risk_finance_000001",
    category: "금융·투자 광고",
    subcategory: "투자 수익 보장",
    patternType: "financial_profit + guarantee",
    triggerPatterns: ["월 수익", "연 수익", "투자 수익", "수익률", "배당 수익", "원금"],
    contextPatterns: ["보장", "확정", "무조건", "원금 보전", "손실 없음"],
    surfaceMeaning: "투자 수익이나 원금을 확정적으로 보장합니다.",
    riskSummary: "손실 가능성을 숨기고 투자 결과를 확정적으로 인식시킬 수 있습니다.",
    socialContext: "불확실성이 본질인 금융상품에서 수익 보장 표현은 소비자 피해로 이어질 가능성이 큽니다.",
    legalOrEthicIssue: "투자 위험 고지 없이 수익을 보장하면 금융소비자 오인 위험이 있습니다.",
    riskReason: "수익·원금 표현과 보장·확정 표현이 결합합니다.",
    severityFloor: 85,
    dominantRisk: true,
    confidence: 0.95,
    riskDomain: "금융·투자 광고",
    recentContextTags: ["투자자 보호", "수익 보장", "위험 고지"],
    safeRewrite: ["수익 가능성과 위험 요인을 함께 안내합니다."],
    falsePositiveNote: "과거 실적 공개 또는 수익 비보장 고지는 보장 주장과 구분합니다.",
  }),
  seedSkill({
    id: "risk_privacy_000001",
    category: "개인정보·사생활 침해 위험",
    subcategory: "동의 없는 위치정보 추적",
    patternType: "privacy_tracking + lack_of_consent",
    triggerPatterns: ["몰래", "동의 없이", "무단으로", "사용자 모르게", "비밀리에"],
    contextPatterns: [
      "re:(?:위치\\s*정보|위치|동선|gps)(?:을|를)?\\s*(?:분석|추적|수집)",
    ],
    surfaceMeaning: "당사자의 동의 없이 위치나 동선을 분석한다고 표현합니다.",
    riskSummary: "수집 목적과 동의가 불명확해 사생활 침해를 조장할 수 있습니다.",
    socialContext: "위치정보는 행동 데이터 활용에서 투명한 동의와 목적 제한이 중요한 정보입니다.",
    legalOrEthicIssue: "동의 없는 개인정보·위치정보 처리는 개인정보 보호 원칙과 충돌할 수 있습니다.",
    riskReason: "비동의 표현과 위치·동선 분석 또는 추적이 결합합니다.",
    severityFloor: 82,
    dominantRisk: true,
    confidence: 0.95,
    riskDomain: "개인정보·위치정보",
    recentContextTags: ["위치정보", "정보주체 동의", "사생활"],
    safeRewrite: ["동의받은 위치 정보를 바탕으로 맞춤 정보를 제공합니다."],
    falsePositiveNote: "몰래카메라라는 합성어 또는 비동의 수집을 하지 않는다는 고지는 제외합니다.",
  }),
  seedSkill({
    id: "risk_disaster_000001",
    category: "재난·사고 상업화",
    subcategory: "참사·희생의 판매 이용",
    patternType: "disaster_memory + sales_promotion",
    triggerPatterns: ["참사", "재난", "희생", "추모"],
    contextPatterns: ["할인", "특가", "이벤트", "프로모션"],
    exclusionPatterns: ["구호 기금", "기부 안내", "피해 복구 지원"],
    surfaceMeaning: "재난·참사 또는 희생의 기억을 판매 촉진과 연결합니다.",
    riskSummary: "고통과 추모의 맥락을 상업적으로 이용한다는 비판을 받을 수 있습니다.",
    socialContext: "재난 직후의 홍보는 추모 기간과 피해자 존중에 높은 민감성을 가집니다.",
    legalOrEthicIssue: "명백한 위법 이전에 피해자 존중과 브랜드 윤리 문제가 발생합니다.",
    riskReason: "재난·희생 표현과 판매 혜택이 결합합니다.",
    severityFloor: 84,
    dominantRisk: true,
    confidence: 0.88,
    riskDomain: "재난·사고 상업화",
    recentContextTags: ["재난 보도", "추모", "피해자 존중"],
    safeRewrite: ["피해 복구를 위한 지원 활동과 참여 방법을 투명하게 안내합니다."],
    falsePositiveNote: "기부·지원 목적이 명확하고 판매 촉진과 분리된 공익 안내는 별도로 검토합니다.",
    reviewStatus: "draft",
  }),
  seedSkill({
    id: "risk_hate_000001",
    category: "혐오·차별 표현",
    subcategory: "집단 열등성 일반화",
    patternType: "protected_group + degrading_generalization",
    triggerPatterns: ["여성은", "남성은", "외국인은", "장애인은"],
    contextPatterns: ["원래 못", "열등", "문제다", "다 똑같다"],
    exclusionPatterns: ["차별 사례", "혐오 표현 교육", "사용하지 마세요"],
    surfaceMeaning: "특정 집단 전체를 부정적 속성으로 일반화합니다.",
    riskSummary: "집단 구성원을 열등하거나 문제적인 존재로 규정할 수 있습니다.",
    socialContext: "정체성 집단에 대한 일반화는 차별과 배제를 강화할 수 있습니다.",
    legalOrEthicIssue: "평등권 침해와 차별 조장의 윤리적 위험이 있습니다.",
    riskReason: "집단 지칭과 비하 일반화가 결합합니다.",
    severityFloor: 84,
    dominantRisk: true,
    confidence: 0.86,
    riskDomain: "혐오·차별·커뮤니티 밈",
    recentContextTags: ["집단 일반화", "차별", "수용자 존중"],
    safeRewrite: ["개인의 상황과 필요를 구체적으로 설명하고 집단 일반화를 피합니다."],
    falsePositiveNote: "차별 표현을 비판·교육하기 위한 인용은 별도로 검토합니다.",
    reviewStatus: "draft",
  }),
  seedSkill({
    id: "risk_diet_000001",
    category: "허위·과장 광고",
    subcategory: "단기간 체중 감량 보장",
    patternType: "short_period + extreme_weight_loss",
    triggerPatterns: ["일주일", "7일", "하루"],
    contextPatterns: ["re:-?\\s*\\d{1,2}\\s*kg", "감량 보장", "무조건 감량"],
    surfaceMeaning: "짧은 기간에 정량의 체중 감량을 약속합니다.",
    riskSummary: "개인차와 건강 위험을 숨긴 비현실적 결과 주장일 수 있습니다.",
    socialContext: "외모 불안과 건강 취약성을 이용하는 과장 광고 위험이 있습니다.",
    legalOrEthicIssue: "객관적 근거 없는 정량적 효능 보장은 소비자를 오인시킬 수 있습니다.",
    riskReason: "짧은 기간과 극단적인 감량 수치가 결합합니다.",
    severityFloor: 80,
    dominantRisk: true,
    confidence: 0.82,
    riskDomain: "다이어트·뷰티 광고",
    recentContextTags: ["체중 감량", "건강 불안", "정량 효능"],
    safeRewrite: ["생활 습관 개선을 돕는 프로그램이며 결과는 개인에 따라 달라질 수 있습니다."],
    falsePositiveNote: "의학적 감독 아래의 과거 경과를 정보로 설명하는 문맥은 별도로 검토합니다.",
    reviewStatus: "draft",
  }),
  seedSkill({
    id: "risk_youth_000001",
    category: "교육·입시 광고",
    subcategory: "불안·혐오 공포 마케팅",
    patternType: "education_anxiety + urgency_pressure",
    triggerPatterns: ["아이 망칩니다", "인생 실패", "낙오", "뒤처진다"],
    contextPatterns: ["지금 등록", "마감", "이번이 마지막", "늦기 전에"],
    surfaceMeaning: "교육 불안을 자극해 즉시 등록을 압박합니다.",
    riskSummary: "학생과 보호자의 불안을 과도하게 이용할 수 있습니다.",
    socialContext: "입시 경쟁과 부모 불안을 자극하는 공포형 광고에 대한 민감도가 높습니다.",
    legalOrEthicIssue: "취약한 소비자의 불안을 이용하는 기만적 설득 위험이 있습니다.",
    riskReason: "교육 실패 공포와 긴급 구매 압박이 결합합니다.",
    severityFloor: 76,
    dominantRisk: true,
    confidence: 0.78,
    riskDomain: "교육·입시 광고",
    recentContextTags: ["입시 불안", "공포 마케팅", "청소년"],
    safeRewrite: ["학생의 현재 수준과 목표에 맞춘 상담을 제공합니다."],
    falsePositiveNote: "교육 격차를 설명하는 공익·정책적 문맥은 별도로 검토합니다.",
    reviewStatus: "draft",
  }),
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu;

export function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(ZERO_WIDTH, "")
    .replace(/\s+/gu, " ")
    .trim();
}

interface IndexMapEntry {
  start: number;
  end: number;
}

interface NormalizedWithMap {
  text: string;
  map: IndexMapEntry[];
}

function appendMapped(
  target: NormalizedWithMap,
  value: string,
  start: number,
  end: number,
) {
  target.text += value;
  for (let index = 0; index < value.length; index += 1) {
    target.map.push({ start, end });
  }
}

function normalizeWithMap(value: string): NormalizedWithMap {
  const result: NormalizedWithMap = { text: "", map: [] };

  for (let index = 0; index < value.length; ) {
    if (value[index] === "\r" && value[index + 1] === "\n") {
      appendMapped(result, "\n", index, index + 2);
      index += 2;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const original = String.fromCodePoint(codePoint);
    const originalEnd = index + original.length;
    const normalized = original.normalize("NFKC").toLocaleLowerCase("ko-KR");

    for (const character of normalized) {
      if (ZERO_WIDTH.test(character)) {
        ZERO_WIDTH.lastIndex = 0;
        continue;
      }
      ZERO_WIDTH.lastIndex = 0;
      const mapped = character === "\r" || character === "\n"
        ? "\n"
        : /\s/u.test(character)
          ? " "
          : character;
      appendMapped(result, mapped, index, originalEnd);
    }

    index = originalEnd;
  }

  return result;
}

interface SentenceRange {
  index: number;
  start: number;
  end: number;
}

function sentenceRanges(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = [];
  let start = 0;

  const push = (end: number) => {
    if (text.slice(start, end).trim()) {
      ranges.push({ index: ranges.length, start, end });
    }
    start = end;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const previous = text[index - 1] ?? "";
    const next = text[index + 1] ?? "";
    const decimalPoint = character === "." && /\d/u.test(previous) && /\d/u.test(next);

    if (!decimalPoint && /[.!?。！？]/u.test(character)) {
      push(index + 1);
      continue;
    }

    if (character === "\n") {
      let cursor = index + 1;
      while (text[cursor] === " ") cursor += 1;
      if (text[cursor] === "\n") {
        push(index);
        while (text[cursor] === "\n" || text[cursor] === " ") cursor += 1;
        start = cursor;
        index = cursor - 1;
      }
    }
  }

  push(text.length);
  return ranges;
}

function paragraphRanges(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = [];
  const separator = /\n\s*\n/gu;
  let start = 0;

  for (let match = separator.exec(text); match; match = separator.exec(text)) {
    if (text.slice(start, match.index).trim()) {
      ranges.push({ index: ranges.length, start, end: match.index });
    }
    start = match.index + match[0].length;
  }

  if (text.slice(start).trim()) {
    ranges.push({ index: ranges.length, start, end: text.length });
  }
  return ranges;
}

interface InternalHit extends PatternHit {
  normalizedStart: number;
  normalizedEnd: number;
  sentenceIndex: number;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function literalRegExp(pattern: string) {
  const normalized = normalizeText(pattern);
  if (normalized.length < 2) return null;
  const source = normalized.split(/\s+/u).map(escapeRegExp).join("\\s*");
  return new RegExp(source, "giu");
}

function isWordCharacter(character: string) {
  return character.length > 0 && /[\p{L}\p{N}_]/u.test(character);
}

const KOREAN_SUFFIXES = [
  "으로", "에서", "에게", "까지", "부터", "처럼", "보다",
  "합니다", "하며", "하고", "하지", "하다", "할", "됩니다", "되는", "된다",
  "을", "를", "은", "는", "이", "가", "도", "만", "의", "에", "와", "과", "로",
].sort((left, right) => right.length - left.length);

function hasLiteralBoundary(text: string, start: number, end: number) {
  const before = start > 0 ? text[start - 1] : "";
  if (isWordCharacter(before)) return false;

  const after = text[end] ?? "";
  if (!isWordCharacter(after)) return true;

  const tail = text.slice(end);
  return KOREAN_SUFFIXES.some((suffix) => {
    if (!tail.startsWith(suffix)) return false;
    return !isWordCharacter(text[end + suffix.length] ?? "");
  });
}

function originalRange(
  normalized: NormalizedWithMap,
  start: number,
  end: number,
) {
  const first = normalized.map[start];
  const last = normalized.map[end - 1];
  if (!first || !last) return null;
  return { start: first.start, end: last.end };
}

function compilePattern(pattern: string) {
  if (!pattern.startsWith("re:")) return literalRegExp(pattern);
  try {
    return new RegExp(pattern.slice(3), "giu");
  } catch {
    return null;
  }
}

function findPatternHits(
  input: string,
  normalized: NormalizedWithMap,
  sentence: SentenceRange,
  patterns: readonly string[],
  role: PatternRole,
) {
  const sentenceText = normalized.text.slice(sentence.start, sentence.end);
  const hits: InternalHit[] = [];

  for (const pattern of patterns) {
    const expression = compilePattern(pattern);
    if (!expression) continue;
    expression.lastIndex = 0;

    for (let match = expression.exec(sentenceText); match; match = expression.exec(sentenceText)) {
      if (!match[0]) {
        expression.lastIndex += 1;
        continue;
      }

      const normalizedStart = sentence.start + match.index;
      const normalizedEnd = normalizedStart + match[0].length;
      if (!pattern.startsWith("re:") && !hasLiteralBoundary(normalized.text, normalizedStart, normalizedEnd)) {
        continue;
      }
      const range = originalRange(normalized, normalizedStart, normalizedEnd);
      if (!range) continue;

      hits.push({
        pattern,
        role,
        start: range.start,
        end: range.end,
        text: input.slice(range.start, range.end),
        sentenceIndex: sentence.index,
        normalizedStart,
        normalizedEnd,
      });
    }
  }

  const deduplicated = new Map<string, InternalHit>();
  for (const hit of hits) {
    const key = `${hit.pattern}\u241f${hit.normalizedStart}\u241f${hit.normalizedEnd}`;
    if (!deduplicated.has(key)) deduplicated.set(key, hit);
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.normalizedStart - right.normalizedStart
      || right.normalizedEnd - left.normalizedEnd
      || compareText(left.pattern, right.pattern));
}

function spansOverlap(left: InternalHit, right: InternalHit) {
  return left.normalizedStart < right.normalizedEnd && right.normalizedStart < left.normalizedEnd;
}

function gapBetween(left: InternalHit, right: InternalHit) {
  if (left.normalizedEnd <= right.normalizedStart) return right.normalizedStart - left.normalizedEnd;
  if (right.normalizedEnd <= left.normalizedStart) return left.normalizedStart - right.normalizedEnd;
  return 0;
}

function isExplicitlyDenied(sentence: string) {
  const denialPatterns = [
    /(?:보장|확정|완치|분석|예측|추적|수집|환불)(?:을|를|은|는|이|가)?\s*(?:하지\s*않|할\s*수\s*없|되지\s*않|아니(?:다|며|고|므로|습니다)|불가)/u,
    /(?:100\s*%|전액)(?:가|은|는)?\s*아니/u,
    /(?:표현|문구|주장|사례)(?:은|는|을|를|이|가)?[^.!?\n]{0,24}(?:금지|사용하지|피해야|과장)/u,
  ];
  return denialPatterns.some((pattern) => pattern.test(sentence));
}

function bestSkillMatch(input: string, skill: RiskSkill): SkillMatch | null {
  if (!skill.triggerPatterns.length || !skill.contextPatterns.length) return null;
  const normalized = normalizeWithMap(input);
  const ranges = skill.conditionScope === "paragraph"
    ? paragraphRanges(normalized.text)
    : sentenceRanges(normalized.text);
  const maxDistance = clamp(Math.round(skill.maxDistance), 0, 2_000);

  type Candidate = {
    trigger: InternalHit;
    context: InternalHit;
    support?: InternalHit;
    gap: number;
    envelope: number;
    start: number;
  };
  const candidates: Candidate[] = [];

  for (const range of ranges) {
    const triggerHits = findPatternHits(input, normalized, range, skill.triggerPatterns, "trigger");
    const contextHits = findPatternHits(input, normalized, range, skill.contextPatterns, "context");
    if (!triggerHits.length || !contextHits.length) continue;
    const supportHits = findPatternHits(
      input,
      normalized,
      range,
      skill.anyOfPatterns,
      "context",
    );
    if (skill.anyOfPatterns.length && !supportHits.length) continue;

    const exclusionHits = findPatternHits(
      input,
      normalized,
      range,
      skill.exclusionPatterns ?? [],
      "context",
    );
    const scopedText = normalized.text.slice(range.start, range.end);
    if (exclusionHits.length || isExplicitlyDenied(scopedText)) continue;

    for (const trigger of triggerHits) {
      for (const context of contextHits) {
        if (spansOverlap(trigger, context)) continue;
        const supports = skill.anyOfPatterns.length ? supportHits : [undefined];
        for (const support of supports) {
          if (support && (spansOverlap(trigger, support) || spansOverlap(context, support))) continue;
          const selectedHits = support ? [trigger, context, support] : [trigger, context];
          const gap = Math.max(
            ...selectedHits.flatMap((left, index) =>
              selectedHits.slice(index + 1).map((right) => gapBetween(left, right))),
          );
          if (gap > maxDistance) continue;
          const start = Math.min(...selectedHits.map((hit) => hit.normalizedStart));
          const end = Math.max(...selectedHits.map((hit) => hit.normalizedEnd));
          candidates.push({ trigger, context, support, gap, envelope: end - start, start });
        }
      }
    }
  }

  candidates.sort((left, right) =>
    left.gap - right.gap
      || left.envelope - right.envelope
      || left.start - right.start
      || compareText(left.trigger.pattern, right.trigger.pattern)
      || compareText(left.context.pattern, right.context.pattern));

  const selected = candidates[0];
  if (!selected) return null;
  const hits = [selected.trigger, selected.context, selected.support]
    .filter((hit): hit is InternalHit => Boolean(hit))
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .map((hit): PatternHit => ({
      pattern: hit.pattern,
      role: hit.role,
      start: hit.start,
      end: hit.end,
      text: hit.text,
      sentenceIndex: hit.sentenceIndex,
    }));

  return {
    skill,
    hits,
    score: clamp(Math.round(skill.severityFloor), 0, 100),
  };
}

export function gradeForScore(
  score: number,
  rules: SeverityRules = DEFAULT_SEVERITY_RULES,
): AnalysisResult["grade"] {
  const threshold = [...rules.gradeThresholds]
    .sort((left, right) => right.min - left.min)
    .find((candidate) => score >= candidate.min && score <= candidate.max);
  return threshold?.grade ?? (score <= 0 ? "미탐지" : "높음");
}

export function analyzeText(
  input: string,
  skills: RiskSkill[],
  options: { includeDrafts?: boolean; severityRules?: SeverityRules } = {},
): AnalysisResult {
  const severityRules = options.severityRules ?? DEFAULT_SEVERITY_RULES;
  const usableSkills = skills
    .filter((skill) => options.includeDrafts
      ? skill.reviewStatus !== "rejected"
      : skill.reviewStatus === "reviewed")
    .sort((left, right) => compareText(left.id, right.id));
  const matches = usableSkills.flatMap((skill) => {
    const match = bestSkillMatch(input, skill);
    return match ? [match] : [];
  });

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.skill.dominantRisk !== left.skill.dominantRisk) {
      return Number(right.skill.dominantRisk) - Number(left.skill.dominantRisk);
    }
    if (right.skill.confidence !== left.skill.confidence) {
      return right.skill.confidence - left.skill.confidence;
    }
    return compareText(left.skill.id, right.skill.id);
  });

  const matchesByCategory = new Map<string, SkillMatch[]>();
  for (const match of matches) {
    const categoryMatches = matchesByCategory.get(match.skill.category) ?? [];
    categoryMatches.push(match);
    matchesByCategory.set(match.skill.category, categoryMatches);
  }

  const categoryScores: CategoryScore[] = [...matchesByCategory.entries()].map(
    ([category, categoryMatches]) => {
      const highest = Math.max(...categoryMatches.map((match) => match.score));
      const distinctPatternTypes = new Set(categoryMatches.map((match) => match.skill.patternType)).size;
      const corroboration = Math.min(
        severityRules.maxCategoryCorroboration,
        Math.max(0, distinctPatternTypes - 1) * severityRules.categoryCorroborationPerPattern,
      );
      return {
        category,
        score: clamp(highest + corroboration, 0, 100),
        skillIds: categoryMatches.map((match) => match.skill.id).sort(compareText),
      };
    },
  );

  categoryScores.sort((left, right) => right.score - left.score || compareText(left.category, right.category));
  const topCategoryScore = categoryScores[0]?.score ?? 0;
  const secondCategoryScore = categoryScores[1]?.score ?? 0;
  const thirdCategoryScore = categoryScores[2]?.score ?? 0;
  const dominantFloor = matches.reduce(
    (floor, match) => match.skill.dominantRisk
      ? Math.max(floor, match.skill.severityFloor)
      : floor,
    0,
  );
  const crossCategoryBonus = Math.min(
    severityRules.maxCrossCategorySupport,
    Math.round(
      secondCategoryScore * severityRules.secondaryCategoryWeight
      + thirdCategoryScore * severityRules.tertiaryCategoryWeight,
    ),
  );
  const finalScore = matches.length
    ? clamp(Math.max(topCategoryScore, dominantFloor) + crossCategoryBonus, 0, 100)
    : clamp(Math.round(severityRules.noMatchScore), 0, 100);

  return {
    input,
    finalScore,
    grade: gradeForScore(finalScore, severityRules),
    recommendation: matches.length
      ? finalScore >= 70
        ? "배포 전 담당자의 검토와 표현 수정을 권장합니다. 이 결과는 자동 금지 판단이 아닙니다."
        : "탐지된 조합의 맥락과 근거를 담당자가 확인해 주세요."
      : "현재 검토된 조합 규칙에서는 위험 패턴이 탐지되지 않았습니다. 이는 자동 승인이나 안전 보장을 의미하지 않습니다.",
    dominantFloor,
    topCategoryScore,
    categoryScores,
    matches,
    primaryMatch: matches[0] ?? null,
    generatedAt: new Date().toISOString(),
  };
}

export function buildHighlightSegments(
  input: string,
  hits: PatternHit[],
): HighlightSegment[] {
  const safeHits = hits
    .map((hit) => ({
      ...hit,
      start: clamp(hit.start, 0, input.length),
      end: clamp(hit.end, 0, input.length),
    }))
    .filter((hit) => hit.end > hit.start);
  const boundaries = new Set<number>([0, input.length]);
  safeHits.forEach((hit) => {
    boundaries.add(hit.start);
    boundaries.add(hit.end);
  });
  const points = [...boundaries].sort((left, right) => left - right);
  const segments: HighlightSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) continue;
    const covering = safeHits.filter((hit) => hit.start < end && hit.end > start);
    const roles = new Set(covering.map((hit) => hit.role));
    const role: HighlightSegment["role"] = roles.size === 0
      ? "plain"
      : roles.size === 2
        ? "both"
        : [...roles][0];
    const previous = segments[segments.length - 1];
    if (previous && previous.role === role && previous.end === start) {
      previous.end = end;
      previous.text += input.slice(start, end);
    } else {
      segments.push({ text: input.slice(start, end), role, start, end });
    }
  }

  return segments;
}

export function validateSkill(skill: RiskSkill) {
  const errors: string[] = [];
  if (skill.schemaVersion !== RISK_SKILL_SCHEMA_VERSION) {
    errors.push(`스키마 버전은 ${RISK_SKILL_SCHEMA_VERSION}이어야 합니다.`);
  }
  if (!Number.isInteger(skill.revision) || skill.revision < 1) {
    errors.push("리비전은 1 이상의 정수여야 합니다.");
  }
  if (!skill.id.trim()) errors.push("스킬 ID가 필요합니다.");
  if (!skill.category.trim()) errors.push("카테고리가 필요합니다.");
  if (!skill.subcategory.trim()) errors.push("세부 유형이 필요합니다.");
  if (!skill.patternType.trim()) errors.push("조합 패턴 유형이 필요합니다.");
  if (!skill.triggerPatterns.length || skill.triggerPatterns.some((pattern) => !pattern.trim())) {
    errors.push("유효한 트리거 패턴이 한 개 이상 필요합니다.");
  }
  if (!skill.contextPatterns.length || skill.contextPatterns.some((pattern) => !pattern.trim())) {
    errors.push("유효한 맥락 패턴이 한 개 이상 필요합니다.");
  }
  if (skill.exclusionPatterns?.some((pattern) => !pattern.trim())) {
    errors.push("제외 패턴은 빈 문자열일 수 없습니다.");
  }
  if (skill.anyOfPatterns.some((pattern) => !pattern.trim())) {
    errors.push("any_of 패턴은 빈 문자열일 수 없습니다.");
  }
  if (skill.conditionScope !== "sentence" && skill.conditionScope !== "paragraph") {
    errors.push("적용 범위는 sentence 또는 paragraph여야 합니다.");
  }
  if (!Number.isInteger(skill.maxDistance) || skill.maxDistance < 0 || skill.maxDistance > 2_000) {
    errors.push("최대 거리는 0에서 2000 사이의 정수여야 합니다.");
  }
  if (!Number.isFinite(skill.severityFloor) || skill.severityFloor < 0 || skill.severityFloor > 100) {
    errors.push("최소 위험 점수는 0에서 100 사이여야 합니다.");
  }
  if (!Number.isFinite(skill.confidence) || skill.confidence < 0 || skill.confidence > 1) {
    errors.push("신뢰도는 0에서 1 사이여야 합니다.");
  }

  if (skill.reviewStatus === "reviewed") {
    if (!skill.riskReason.trim()) errors.push("검토 완료 스킬에는 판단 근거가 필요합니다.");
    if (!skill.safeRewrite.length || skill.safeRewrite.some((rewrite) => !rewrite.trim())) {
      errors.push("검토 완료 스킬에는 유효한 대체 문구가 한 개 이상 필요합니다.");
    }
    if (!skill.source.title.trim()) errors.push("검토 완료 스킬에는 출처 제목이 필요합니다.");
    if (!skill.source.sourceId?.trim()) errors.push("검토 완료 스킬에는 sourceId가 필요합니다.");
    if (!skill.source.provenanceStatus) {
      errors.push("검토 완료 스킬에는 출처 검증 상태가 필요합니다.");
    }
    if (skill.source.provenanceStatus === "synthetic_unverified") {
      errors.push("검증되지 않은 합성 출처는 검토 완료 상태로 내보낼 수 없습니다.");
    }
  }
  return errors;
}

function inferDraftCategory(text: string) {
  const normalized = normalizeText(text);
  if (/(형량|승소|기각|소송|법률)/u.test(normalized)) return ["고위험 전문서비스 광고", "법률 광고"] as const;
  if (/(위치|추적|개인정보|감시)/u.test(normalized)) return ["개인정보·사생활 침해 위험", "개인정보·위치정보"] as const;
  if (/(완치|치료|의료|질환)/u.test(normalized)) return ["의료 광고", "의료 광고"] as const;
  if (/(수익|투자|원금)/u.test(normalized)) return ["금융·투자 광고", "금융·투자 광고"] as const;
  if (/(합격|성적|입시)/u.test(normalized)) return ["교육·입시 광고", "교육·입시 광고"] as const;
  return ["브랜드 평판 위험", "브랜드 캠페인"] as const;
}

export function createMockSkillDraft(
  input: CaseInput,
  skills: RiskSkill[],
  now = new Date(),
): RiskSkill {
  const analysis = analyzeText(input.text, skills, { includeDrafts: true });
  const matched = analysis.primaryMatch?.skill;
  const [fallbackCategory, fallbackDomain] = inferDraftCategory(`${input.text} ${input.description}`);
  const candidateTokens = normalizeText(input.text)
    .split(/[^\p{L}\p{N}%·.]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const compactId = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const source: RiskSource = {
    title: input.description || "관리자 수동 입력",
    url: input.sourceUrl,
    date: input.occurredAt,
    sourceId: `manual_${compactId}`,
    provenanceStatus: input.sourceUrl ? "provided" : "synthetic_unverified",
  };

  if (matched) {
    return {
      ...matched,
      id: `risk_draft_${compactId}`,
      revision: 1,
      surfaceMeaning: input.text,
      notes: input.memo,
      source,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      reviewStatus: "draft",
    };
  }

  return {
    schemaVersion: RISK_SKILL_SCHEMA_VERSION,
    revision: 1,
    id: `risk_draft_${compactId}`,
    category: fallbackCategory,
    subcategory: "맥락 검토 필요",
    patternType: "candidate_expression + contextual_review",
    triggerPatterns: candidateTokens.length >= 2
      ? [candidateTokens[0]]
      : [input.text.trim()].filter(Boolean),
    contextPatterns: candidateTokens.length >= 2
      ? [candidateTokens[candidateTokens.length - 1]]
      : [input.domain || fallbackDomain],
    anyOfPatterns: [],
    conditionScope: "sentence",
    maxDistance: 48,
    surfaceMeaning: input.text,
    riskSummary: "입력 표현의 사용 맥락과 결합 조건을 사람이 검토해야 합니다.",
    socialContext: input.description || "추가 사회적 맥락이 필요합니다.",
    legalOrEthicIssue: "Mock 해석은 법률 판단이 아니며 출처와 적용 범위를 확인해야 합니다.",
    riskReason: "단일 표현만으로 확정하지 않고 함께 등장해야 할 맥락 패턴을 정의해야 합니다.",
    severityFloor: 55,
    dominantRisk: false,
    confidence: 0.45,
    riskDomain: input.domain || fallbackDomain,
    recentContextTags: ["검토 필요"],
    safeRewrite: ["구체적인 근거와 적용 조건을 함께 안내합니다."],
    falsePositiveNote: "인용·교육·비판·중립적 정보 제공 문맥을 확인하세요.",
    notes: input.memo,
    source,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    reviewStatus: "draft",
  };
}

export const MockInterpreter: SkillInterpreter = {
  id: "riskshield.mock-interpreter.v1",
  label: "규칙 기반 MockInterpreter",
  interpret: createMockSkillDraft,
};

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted && character === '"' && next === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += character;
  }

  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function summarizeCsv(text: string): CsvSummary {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const dataRows = rows.slice(1);
  const headerKey = headers.join("|").toLocaleLowerCase("ko-KR");
  const profile: CsvSummary["profile"] = headerKey.includes("matching_type")
    ? "hate_speech"
    : headerKey.includes("어원/원단어")
      ? "controversy"
      : headerKey.includes("root_word") || headerKey.includes("원단어")
        ? "false_advertising"
        : "generic";
  const categoryIndex = headers.findIndex((header) => /category|분류/i.test(header));
  const rootIndex = headers.findIndex((header) => /root_word|어원\/원단어|원단어/i.test(header));
  const categoryCounts = new Map<string, number>();
  const roots = new Set<string>();
  const seen = new Set<string>();
  let duplicateRows = 0;
  let validRows = 0;

  for (const row of dataRows) {
    if (row.length !== headers.length || row.every((cell) => !cell.trim())) continue;
    validRows += 1;
    const rowKey = row.map((cell) => normalizeText(cell)).join("\u241f");
    if (seen.has(rowKey)) duplicateRows += 1;
    seen.add(rowKey);
    if (rootIndex >= 0 && row[rootIndex]?.trim()) roots.add(normalizeText(row[rootIndex]));
    if (categoryIndex >= 0 && row[categoryIndex]?.trim()) {
      const category = row[categoryIndex].trim();
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  return {
    profile,
    headers,
    rowCount: dataRows.length,
    validRows,
    invalidRows: dataRows.length - validRows,
    duplicateRows,
    uniqueRoots: roots.size,
    categories: [...categoryCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || compareText(left.name, right.name)),
    encoding: "utf-8",
    stagedPreviewCount: Math.min(validRows, 50),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstDefined(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function readString(record: Record<string, unknown>, keys: string[], fallback = "") {
  const value = firstDefined(record, ...keys);
  return typeof value === "string" ? value : fallback;
}

function readNumber(record: Record<string, unknown>, keys: string[], fallback: number) {
  const value = firstDefined(record, ...keys);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(record: Record<string, unknown>, keys: string[], fallback: boolean) {
  const value = firstDefined(record, ...keys);
  return typeof value === "boolean" ? value : fallback;
}

function readStrings(record: Record<string, unknown>, keys: string[]) {
  const value = firstDefined(record, ...keys);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readConditionGroup(
  groups: unknown[],
  groupId: "trigger" | "context",
  fallbackIndex: number,
) {
  const records = groups.filter(isRecord);
  const group = records.find((candidate) => candidate.group_id === groupId)
    ?? records[fallbackIndex];
  return group ? readStrings(group, ["any_of", "anyOf", "patterns"]) : [];
}

export function migrateRiskSkill(
  value: unknown,
  fallbackTime = SEED_DATE,
): { skill?: RiskSkill; issues: string[] } {
  if (!isRecord(value)) return { issues: ["스킬 레코드는 객체여야 합니다."] };

  const id = readString(value, ["id"]);
  const conditions = isRecord(value.conditions) ? value.conditions : {};
  const allOf = Array.isArray(conditions.all_of)
    ? conditions.all_of
    : Array.isArray(conditions.allOf)
      ? conditions.allOf
      : [];
  const conditionTrigger = readConditionGroup(allOf, "trigger", 0);
  const conditionContext = readConditionGroup(allOf, "context", 1);
  const sourceValue = isRecord(value.source) ? value.source : {};
  const statusValue = readString(value, ["review_status", "reviewStatus"], "draft");
  const reviewStatus: ReviewStatus = statusValue === "reviewed" || statusValue === "rejected"
    ? statusValue
    : "draft";
  const scopeValue = readString(conditions, ["scope"], readString(value, ["conditionScope"], "sentence"));
  const conditionScope: PatternScope = scopeValue === "paragraph" ? "paragraph" : "sentence";
  const provenanceValue = readString(
    sourceValue,
    ["provenance_status", "provenanceStatus"],
    "provided",
  );
  const provenanceStatus: NonNullable<RiskSource["provenanceStatus"]> =
    provenanceValue === "verified" || provenanceValue === "synthetic_unverified"
      ? provenanceValue
      : "provided";

  const skill: RiskSkill = {
    schemaVersion: RISK_SKILL_SCHEMA_VERSION,
    revision: Math.max(1, Math.round(readNumber(value, ["revision"], 1))),
    id,
    category: readString(value, ["category"]),
    subcategory: readString(value, ["subcategory"]),
    patternType: readString(value, ["pattern_type", "patternType"]),
    triggerPatterns: conditionTrigger.length
      ? conditionTrigger
      : readStrings(value, ["trigger_patterns", "triggerPatterns"]),
    contextPatterns: conditionContext.length
      ? conditionContext
      : readStrings(value, ["context_patterns", "contextPatterns"]),
    anyOfPatterns: readStrings(conditions, ["any_of", "anyOf"]).length
      ? readStrings(conditions, ["any_of", "anyOf"])
      : readStrings(value, ["anyOfPatterns"]),
    exclusionPatterns: readStrings(conditions, ["none_of", "noneOf"]).length
      ? readStrings(conditions, ["none_of", "noneOf"])
      : readStrings(value, ["exclusion_patterns", "exclusionPatterns"]),
    conditionScope,
    maxDistance: Math.max(
      0,
      Math.round(readNumber(conditions, ["max_distance", "maxDistance"], readNumber(value, ["maxDistance"], 48))),
    ),
    surfaceMeaning: readString(value, ["surface_meaning", "surfaceMeaning"]),
    riskSummary: readString(value, ["risk_summary", "riskSummary"]),
    socialContext: readString(value, ["social_context", "socialContext"]),
    legalOrEthicIssue: readString(value, ["legal_or_ethic_issue", "legalOrEthicIssue"]),
    riskReason: readString(value, ["risk_reason", "riskReason"]),
    severityFloor: readNumber(value, ["severity_floor", "severityFloor"], 0),
    dominantRisk: readBoolean(value, ["dominant_risk", "dominantRisk"], false),
    confidence: readNumber(value, ["confidence"], 0),
    riskDomain: readString(value, ["risk_domain", "riskDomain"]),
    recentContextTags: readStrings(value, ["recent_context_tags", "recentContextTags"]),
    safeRewrite: readStrings(value, ["safe_rewrite", "safeRewrite"]),
    falsePositiveNote: readString(value, ["false_positive_note", "falsePositiveNote"]),
    notes: readString(value, ["memo", "notes"]),
    source: {
      title: readString(sourceValue, ["title"]),
      url: readString(sourceValue, ["url"]),
      date: readString(sourceValue, ["date"]),
      sourceId: readString(sourceValue, ["source_id", "sourceId"], id ? `legacy_${id}` : ""),
      provenanceStatus,
    },
    createdAt: readString(value, ["created_at", "createdAt"], fallbackTime),
    updatedAt: readString(value, ["updated_at", "updatedAt"], fallbackTime),
    reviewStatus,
  };

  const issues = validateSkill(skill);
  return issues.length ? { issues } : { skill, issues: [] };
}

export function parseRiskSkillsJsonl(text: string) {
  const skills: RiskSkill[] = [];
  const issues: string[] = [];
  const ids = new Set<string>();
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const migrated = migrateRiskSkill(JSON.parse(line) as unknown);
      if (!migrated.skill) {
        issues.push(`risk_skills.jsonl ${index + 1}행: ${migrated.issues.join(" ")}`);
        return;
      }
      if (ids.has(migrated.skill.id)) {
        issues.push(`risk_skills.jsonl ${index + 1}행: 중복 ID ${migrated.skill.id}`);
        return;
      }
      ids.add(migrated.skill.id);
      skills.push(migrated.skill);
    } catch {
      issues.push(`risk_skills.jsonl ${index + 1}행: 올바른 JSON 객체가 아닙니다.`);
    }
  });

  return { skills, issues };
}

export function parseSeverityRules(value: unknown): { rules: SeverityRules; issues: string[] } {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return { rules: DEFAULT_SEVERITY_RULES, issues: ["severity_rules.json이 올바른 JSON이 아닙니다."] };
    }
  }
  if (!isRecord(parsed)) {
    return { rules: DEFAULT_SEVERITY_RULES, issues: ["severity_rules.json은 객체여야 합니다."] };
  }

  const rawThresholds = firstDefined(parsed, "grade_thresholds", "gradeThresholds");
  const gradeThresholds = Array.isArray(rawThresholds)
    ? rawThresholds.flatMap((item) => {
      if (!isRecord(item)) return [];
      const grade = readString(item, ["grade"]) as AnalysisResult["grade"];
      const min = readNumber(item, ["min"], Number.NaN);
      const max = readNumber(item, ["max"], Number.NaN);
      return ["미탐지", "낮음", "유의", "주의", "높음"].includes(grade)
        && Number.isFinite(min)
        && Number.isFinite(max)
        ? [{ grade, min, max }]
        : [];
    })
    : [];

  const rules: SeverityRules = {
    schemaVersion: "1.0.0",
    scoringStrategy: "dominant_risk",
    noMatchScore: readNumber(
      parsed,
      ["no_match_score", "noMatchScore"],
      DEFAULT_SEVERITY_RULES.noMatchScore,
    ),
    categoryCorroborationPerPattern: readNumber(
      parsed,
      ["category_corroboration_per_pattern", "categoryCorroborationPerPattern"],
      DEFAULT_SEVERITY_RULES.categoryCorroborationPerPattern,
    ),
    maxCategoryCorroboration: readNumber(
      parsed,
      ["max_category_corroboration", "maxCategoryCorroboration"],
      DEFAULT_SEVERITY_RULES.maxCategoryCorroboration,
    ),
    secondaryCategoryWeight: readNumber(
      parsed,
      ["secondary_category_weight", "secondaryCategoryWeight"],
      DEFAULT_SEVERITY_RULES.secondaryCategoryWeight,
    ),
    tertiaryCategoryWeight: readNumber(
      parsed,
      ["tertiary_category_weight", "tertiaryCategoryWeight"],
      DEFAULT_SEVERITY_RULES.tertiaryCategoryWeight,
    ),
    maxCrossCategorySupport: readNumber(
      parsed,
      ["max_cross_category_support", "maxCrossCategorySupport"],
      DEFAULT_SEVERITY_RULES.maxCrossCategorySupport,
    ),
    gradeThresholds: gradeThresholds.length
      ? gradeThresholds
      : DEFAULT_SEVERITY_RULES.gradeThresholds.map((threshold) => ({ ...threshold })),
  };
  const issues: string[] = [];
  if (rules.gradeThresholds.length !== 5) issues.push("점수 등급 5개가 모두 필요합니다.");
  if (rules.secondaryCategoryWeight < 0 || rules.tertiaryCategoryWeight < 0) {
    issues.push("카테고리 지원 가중치는 0 이상이어야 합니다.");
  }
  if (rules.maxCrossCategorySupport < 0 || rules.maxCategoryCorroboration < 0) {
    issues.push("점수 보정 상한은 0 이상이어야 합니다.");
  }
  if (rules.noMatchScore < 0 || rules.noMatchScore > 100) {
    issues.push("미탐지 점수는 0에서 100 사이여야 합니다.");
  }
  return issues.length ? { rules: DEFAULT_SEVERITY_RULES, issues } : { rules, issues: [] };
}

export function parseBundleFiles(files: Partial<BundleFiles>): ParsedBundle {
  const issues: string[] = [];
  const riskSkills = files["risk_skills.jsonl"]
    ? parseRiskSkillsJsonl(files["risk_skills.jsonl"])
    : { skills: [], issues: ["risk_skills.jsonl 파일이 필요합니다."] };
  issues.push(...riskSkills.issues);
  const severity = files["severity_rules.json"]
    ? parseSeverityRules(files["severity_rules.json"])
    : { rules: DEFAULT_SEVERITY_RULES, issues: [] };
  issues.push(...severity.issues);

  for (const name of ["trend_context.json", "rewrite_templates.json", "source_index.json"] as const) {
    const content = files[name];
    if (!content) continue;
    try {
      const parsed = JSON.parse(content) as unknown;
      if (!isRecord(parsed)) issues.push(`${name}은 JSON 객체여야 합니다.`);
    } catch {
      issues.push(`${name}이 올바른 JSON이 아닙니다.`);
    }
  }

  return {
    skills: riskSkills.skills,
    severityRules: severity.rules,
    filesLoaded: Object.keys(files).filter((name) => Boolean(files[name as keyof BundleFiles])).sort(compareText),
    issues,
  };
}

export function buildExportBundle(
  skills: RiskSkill[],
  now: Date = new Date(),
  policy: SeverityRules = DEFAULT_SEVERITY_RULES,
): ExportBundle {
  const reviewed = skills
    .filter((skill) => skill.reviewStatus === "reviewed" && validateSkill(skill).length === 0)
    .sort((left, right) => compareText(left.id, right.id));
  const generatedAt = now.toISOString();
  const categories = [...new Set(reviewed.map((skill) => skill.category))].sort(compareText);

  const riskSkillLines = reviewed.map((skill) => JSON.stringify({
    schema_version: skill.schemaVersion,
    revision: skill.revision,
    id: skill.id,
    category: skill.category,
    subcategory: skill.subcategory,
    pattern_type: skill.patternType,
    trigger_patterns: skill.triggerPatterns,
    context_patterns: skill.contextPatterns,
    exclusion_patterns: skill.exclusionPatterns ?? [],
    conditions: {
      all_of: [
        { group_id: "trigger", any_of: skill.triggerPatterns },
        { group_id: "context", any_of: skill.contextPatterns },
      ],
      any_of: skill.anyOfPatterns,
      none_of: skill.exclusionPatterns ?? [],
      scope: skill.conditionScope,
      max_distance: skill.maxDistance,
    },
    surface_meaning: skill.surfaceMeaning,
    risk_summary: skill.riskSummary,
    social_context: skill.socialContext,
    legal_or_ethic_issue: skill.legalOrEthicIssue,
    risk_reason: skill.riskReason,
    severity_floor: skill.severityFloor,
    dominant_risk: skill.dominantRisk,
    confidence: skill.confidence,
    risk_domain: skill.riskDomain,
    recent_context_tags: [...skill.recentContextTags].sort(compareText),
    safe_rewrite: skill.safeRewrite,
    false_positive_note: skill.falsePositiveNote,
    memo: skill.notes,
    source: {
      title: skill.source.title,
      url: skill.source.url,
      date: skill.source.date,
      source_id: skill.source.sourceId,
      provenance_status: skill.source.provenanceStatus,
    },
    created_at: skill.createdAt,
    updated_at: skill.updatedAt,
    review_status: skill.reviewStatus,
  }));
  const riskSkillsJsonl = riskSkillLines.length ? `${riskSkillLines.join("\n")}\n` : "";

  const trendEntries = new Map<string, { tag: string; skill_ids: string[]; categories: string[] }>();
  for (const skill of reviewed) {
    for (const tag of [...skill.recentContextTags].sort(compareText)) {
      const existing = trendEntries.get(tag) ?? { tag, skill_ids: [], categories: [] };
      if (!existing.skill_ids.includes(skill.id)) existing.skill_ids.push(skill.id);
      if (!existing.categories.includes(skill.category)) existing.categories.push(skill.category);
      trendEntries.set(tag, existing);
    }
  }
  const contexts = [...trendEntries.values()]
    .map((entry) => ({
      ...entry,
      skill_ids: entry.skill_ids.sort(compareText),
      categories: entry.categories.sort(compareText),
    }))
    .sort((left, right) => compareText(left.tag, right.tag));

  const severityRules = {
    schema_version: policy.schemaVersion,
    generated_at: generatedAt,
    scoring_strategy: policy.scoringStrategy,
    formula: "max(top_category_score, dominant_severity_floor) + capped_secondary_and_tertiary_support",
    no_match_score: policy.noMatchScore,
    no_match_meaning: "검토된 조합 규칙에서 미탐지됨; 자동 승인 또는 안전 보장이 아님",
    category_corroboration_per_pattern: policy.categoryCorroborationPerPattern,
    max_category_corroboration: policy.maxCategoryCorroboration,
    secondary_category_weight: policy.secondaryCategoryWeight,
    tertiary_category_weight: policy.tertiaryCategoryWeight,
    max_cross_category_support: policy.maxCrossCategorySupport,
    grade_thresholds: policy.gradeThresholds,
    categories: categories.map((category) => ({
      category,
      highest_reviewed_floor: Math.max(
        ...reviewed
          .filter((skill) => skill.category === category)
          .map((skill) => skill.severityFloor),
      ),
      dominant_skill_ids: reviewed
        .filter((skill) => skill.category === category && skill.dominantRisk)
        .map((skill) => skill.id)
        .sort(compareText),
    })),
  };

  const rewriteTemplates = {
    schema_version: "1.0.0",
    generated_at: generatedAt,
    templates: reviewed.map((skill) => ({
      skill_id: skill.id,
      category: skill.category,
      pattern_type: skill.patternType,
      rewrites: skill.safeRewrite,
      guidance: skill.falsePositiveNote,
    })),
  };

  const sourceIndex = {
    schema_version: "1.0.0",
    generated_at: generatedAt,
    sources: reviewed.map((skill) => ({
      skill_id: skill.id,
      source_id: skill.source.sourceId ?? skill.id,
      title: skill.source.title,
      url: skill.source.url,
      date: skill.source.date,
      provenance_status: skill.source.provenanceStatus ?? "provided",
    })),
  };

  return {
    riskSkillsJsonl,
    trendContext: {
      schema_version: "1.0.0",
      generated_at: generatedAt,
      update_policy: "human_review_required",
      contexts,
    },
    severityRules,
    rewriteTemplates,
    sourceIndex,
  };
}
