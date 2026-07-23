// @ts-expect-error Node 22 direct TypeScript execution requires the runtime extension.
import { RISK_FAMILIES, riskFamilyForPatternType, type ScorableRiskFamily } from "./risk-family.ts";

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

export interface RiskSkillRegressionCase {
  id: string;
  input: string;
  expected: "match" | "no_match";
  contextSlice?: string;
}

export interface RiskSkill {
  schemaVersion: typeof RISK_SKILL_SCHEMA_VERSION;
  revision: number;
  id: string;
  category: string;
  subcategory: string;
  patternType: string;
  /** Atomic lexemes may match on one reviewed expression; composite rules require trigger + context. */
  matchMode?: "atomic_lexeme" | "trigger_and_context";
  triggerPatterns: string[];
  contextPatterns: string[];
  anyOfPatterns: string[];
  exclusionPatterns?: string[];
  /** Candidate-authored examples that must pass before a draft can become active. */
  regressionTests?: RiskSkillRegressionCase[];
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
  /** Stable scoring identifier. Required for managed skills; inferred only for legacy fixtures. */
  riskFamily?: ScorableRiskFamily;
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
  status: "no_match" | "review" | "attention" | "high";
  statusLabel: "규칙 미일치" | "추가 검토" | "주의 필요" | "높은 위험";
  speechAct: "promotion" | "statement" | "criticism" | "warning" | "quotation" | "condition";
  recommendation: string;
  reason: string | null;
  suggestedRewrite: string | null;
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

export type SkillImportMode = "merge" | "replace";

export interface SkillImportPreview {
  mode: SkillImportMode;
  newCount: number;
  updateCount: number;
  sameCount: number;
  conflictCount: number;
  skippedCount: number;
  errorCount: number;
  finalCount: number;
  newIds: string[];
  updateIds: string[];
  sameIds: string[];
  conflictIds: string[];
  finalSkills: RiskSkill[];
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
    { grade: "주의", min: 70, max: 79 },
    { grade: "높음", min: 80, max: 100 },
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
    riskFamily: skill.riskFamily ?? riskFamilyForPatternType(skill.patternType),
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
    revision: 2,
    category: "고위험 전문서비스 광고",
    subcategory: "법률 결과·환불 보장",
    patternType: "legal_outcome + refund_guarantee",
    triggerPatterns: [
      "기각", "각하", "승소", "무죄", "불기소", "감형", "집행유예",
      "re:실패(?:하|했|할|면|시)?", "re:결과(?:가|는)?\\s*(?:안\\s*나오|없)", "re:효과(?:가|는)?\\s*(?:없|미흡)",
    ],
    contextPatterns: [
      "re:(?:100\\s*%|전액|전부)?\\s*(?:환불|돌려\\s*드(?:림|립니다|려요))",
      "환불 보장",
      "결과 보장",
      "승소 보장",
    ],
    exclusionPatterns: ["배송", "배달", "시스템 장애", "결제 오류", "품절"],
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
    conditionScope: "paragraph",
    maxDistance: 120,
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
    revision: 2,
    category: "교육·입시 광고",
    subcategory: "교육 결과 보장",
    patternType: "education_outcome + guarantee",
    triggerPatterns: [
      "re:합\\s*격", "전교 1등", "성적 향상", "등급 상승", "명문대 진학",
    ],
    contextPatterns: [
      "re:보\\s*장", "확정", "무조건", "반드시", "누구나",
      "re:(?:결과|합격)(?:는|을|를)?[^.!?\\n]{0,18}(?:책임|약속)",
      "re:1\\s*0\\s*0\\s*%",
    ],
    exclusionPatterns: ["합격자 발표", "최종 합격 통지", "지원할 수", "심사로 결정", "선발 절차"],
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
    conditionScope: "paragraph",
    maxDistance: 140,
  }),
  seedSkill({
    id: "risk_medical_000001",
    revision: 2,
    category: "의료 광고",
    subcategory: "의료 효과 절대 보장",
    patternType: "medical_effect + absolute_guarantee",
    triggerPatterns: [
      "완치", "치료 효과", "질환 개선", "통증 제거", "재발 방지",
      "re:(?:치료|시술|제품|서비스)?\\s*효과",
    ],
    contextPatterns: [
      "re:1\\s*0\\s*0\\s*%", "백퍼", "완벽하게", "반드시", "영구적으로", "무조건",
      "re:성공률(?:은|이)?\\s*1\\s*0\\s*0\\s*%",
    ],
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
    conditionScope: "paragraph",
    maxDistance: 140,
  }),
  seedSkill({
    id: "risk_finance_000001",
    revision: 2,
    category: "금융·투자 광고",
    subcategory: "투자 수익 보장",
    patternType: "financial_profit + guarantee",
    triggerPatterns: [
      "월 수익", "연 수익", "투자 수익", "수익률", "배당 수익", "원금",
      "수익", "re:돈", "이익", "손실 가능성", "손실", "손해",
      "re:월\\s*\\d{1,5}\\s*(?:만\\s*)?원",
    ],
    contextPatterns: [
      "보장", "확정", "무조건", "반드시", "누구나", "원금 보전", "손실 없음",
      "re:(?:벌|얻|남길)\\s*수\\s*(?:있|있습니다)",
      "re:(?:전혀|절[.\\s]*대(?:로)?[.\\s]*|조금도)[^.!?\\n]{0,22}(?:없|않)",
      "re:(?:손실|손해)[^.!?\\n]{0,16}(?:없|제로)",
    ],
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
    conditionScope: "sentence",
    maxDistance: 100,
  }),
  seedSkill({
    id: "risk_privacy_000001",
    revision: 2,
    category: "개인정보·사생활 침해 위험",
    subcategory: "동의 없는 위치정보 추적",
    patternType: "privacy_tracking + lack_of_consent",
    triggerPatterns: [
      "몰래", "동의 없이", "무단으로", "사용자 모르게", "비밀리에",
      "re:(?:상대방|이용자|사용자|본인)(?:에게|한테)?[^.!?\\n]{0,18}알릴\\s*필요(?:는|가)?\\s*없",
    ],
    contextPatterns: [
      "re:(?:위치\\s*정보|위치|동선|gps)(?:을|를)?\\s*(?:분석|추적|수집)",
      "개인정보",
      "re:(?:개인\\s*정보|행동\\s*정보|접속\\s*기록)(?:를|을|은|는)?\\s*(?:분석|추적|수집|활용)",
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
    conditionScope: "paragraph",
    maxDistance: 160,
  }),
  seedSkill({
    id: "risk_finance_000002",
    category: "금융·투자 광고",
    subcategory: "투자 손실 가능성 부정",
    patternType: "financial_risk + loss_absence",
    triggerPatterns: ["수익", "투자", "손실", "손해", "원금"],
    contextPatterns: [
      "re:(?:전혀|절[.\\s]*대(?:로)?[.\\s]*|조금도)[^.!?\\n]{0,26}(?:없|않)",
      "손실 없음",
      "손해 없음",
      "원금 보전",
    ],
    surfaceMeaning: "투자 또는 수익 설명과 함께 손실 가능성이 없다고 주장합니다.",
    riskSummary: "투자 손실 가능성을 숨겨 결과를 확정적으로 인식시킬 수 있습니다.",
    socialContext: "금융상품은 원금 손실 가능성을 포함하므로 위험을 배제하는 광고에 높은 주의가 필요합니다.",
    legalOrEthicIssue: "손실 위험을 부정하면 금융소비자의 합리적 판단을 오도할 수 있습니다.",
    riskReason: "투자·수익 맥락과 손실 가능성의 절대적 부정이 같은 문단에 결합합니다.",
    severityFloor: 85,
    dominantRisk: true,
    confidence: 0.94,
    riskDomain: "금융·투자 광고",
    recentContextTags: ["투자자 보호", "손실 위험", "위험 고지"],
    safeRewrite: ["예상 수익과 함께 원금 손실 가능성 및 주요 위험을 안내합니다."],
    falsePositiveNote: "손실 가능성이 있다고 알리는 위험 고지나 보장 주장을 비판하는 문맥은 제외합니다.",
    conditionScope: "paragraph",
    maxDistance: 160,
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
  seedSkill({
    id: "risk_hate_000002",
    category: "혐오·차별 표현",
    subcategory: "집단 비하와 배제",
    patternType: "protected_group + degrading_generalization",
    riskFamily: "hate_discrimination",
    triggerPatterns: ["여자는", "남자는", "외국인은", "장애인은", "전라도 사람은", "경상도 사람은"],
    contextPatterns: ["원래 다", "열등", "믿으면 안", "사라져야", "문제다", "답이 없다"],
    exclusionPatterns: ["차별 표현", "사용하지 마세요", "혐오를 비판", "잘못된 일반화"],
    surfaceMeaning: "특정 집단 전체를 부정적으로 일반화하거나 배제합니다.",
    riskSummary: "개인의 행동을 집단의 속성으로 확대해 차별과 혐오를 강화할 수 있습니다.",
    socialContext: "지역·성별·국적·장애 등 정체성 집단에 대한 일반화는 실제 배제와 괴롭힘으로 이어질 수 있습니다.",
    legalOrEthicIssue: "차별 조장과 인격권 침해 위험이 있습니다.",
    riskReason: "집단 지칭 표현과 비하·배제 문맥이 같은 주장에 결합합니다.",
    severityFloor: 84,
    dominantRisk: true,
    confidence: 0.88,
    riskDomain: "혐오·차별",
    recentContextTags: ["집단 일반화", "지역 비하", "정체성 공격"],
    safeRewrite: ["집단 전체가 아니라 문제가 된 구체적인 행동과 상황을 설명해 주세요."],
    falsePositiveNote: "혐오 표현을 인용해 비판하거나 교육하는 문맥은 낮춰서 검토합니다.",
  }),
  seedSkill({
    id: "risk_abuse_000001",
    category: "욕설·공격 표현",
    subcategory: "직접 모욕과 괴롭힘",
    patternType: "profanity + personal_attack",
    riskFamily: "abusive_language",
    triggerPatterns: ["개새끼", "병신", "씨발", "쓰레기", "멍청이"],
    contextPatterns: ["너", "네가", "저 인간", "저 새끼", "꺼져", "닥쳐"],
    exclusionPatterns: ["욕설 표현", "사용하지 마세요", "비속어를 설명", "모욕으로 신고"],
    surfaceMeaning: "상대방을 직접 겨냥한 욕설이나 모욕을 사용합니다.",
    riskSummary: "직접적인 인신공격과 괴롭힘으로 받아들여질 수 있습니다.",
    socialContext: "반복되는 공격 표현은 온라인 괴롭힘과 갈등 확산 위험을 높입니다.",
    legalOrEthicIssue: "모욕과 인격권 침해 위험이 있습니다.",
    riskReason: "강한 비속어와 특정 상대를 지목하는 표현이 결합합니다.",
    severityFloor: 76,
    dominantRisk: true,
    confidence: 0.9,
    riskDomain: "욕설·괴롭힘",
    recentContextTags: ["직접 모욕", "인신공격", "괴롭힘"],
    safeRewrite: ["사람을 모욕하지 말고 문제가 된 행동과 그 영향만 구체적으로 설명해 주세요."],
    falsePositiveNote: "언어 연구·교육·신고를 위한 인용은 별도로 검토합니다.",
  }),
  seedSkill({
    id: "risk_coded_000001",
    category: "숨은 은어·코드 표현",
    subcategory: "커뮤니티 기반 혐오 은어",
    patternType: "ilbe + community_slang",
    matchMode: "atomic_lexeme",
    riskFamily: "coded_expression",
    triggerPatterns: ["운지", "노알라", "일베충", "홍어", "느개미", "느금마", "느금", "피싸개", "보릉내", "보댕이"],
    contextPatterns: [],
    exclusionPatterns: ["용어의 뜻", "혐오 표현", "사용하지 마세요", "문제되는 은어", "사전적 의미"],
    surfaceMeaning: "특정 커뮤니티에서 조롱이나 혐오 의미로 쓰이는 코드 표현을 사용합니다.",
    riskSummary: "겉으로 의미가 드러나지 않아도 특정 인물·지역·집단을 비하하는 신호가 될 수 있습니다.",
    socialContext: "은어는 철자와 형태가 빠르게 바뀌므로 출처와 실제 사용 맥락을 함께 확인해야 합니다.",
    legalOrEthicIssue: "우회적인 혐오·모욕과 오해 확산 위험이 있습니다.",
    riskReason: "검토된 커뮤니티 은어가 직접 사용된 구간을 확인했습니다.",
    severityFloor: 78,
    dominantRisk: true,
    confidence: 0.82,
    riskDomain: "커뮤니티 은어·코드 표현",
    recentContextTags: ["일베 은어", "우회 표현", "정치적 조롱"],
    safeRewrite: ["특정 커뮤니티 은어 대신 의도와 사실을 일반적인 말로 분명하게 표현해 주세요."],
    falsePositiveNote: "용어의 의미를 설명하거나 비판하는 문맥은 별도로 검토합니다.",
  }),
  seedSkill({
    id: "risk_violent_000001",
    category: "폭력·위협 표현",
    subcategory: "직접적인 신체 위해 위협",
    patternType: "violent_threat + target",
    riskFamily: "violent_threat",
    triggerPatterns: ["죽여 버린다", "때려 죽인다", "칼로 찌른다", "패버린다", "가만 안 둔다"],
    contextPatterns: ["너", "네가", "찾아가서", "당장", "진짜로", "두고 봐"],
    exclusionPatterns: ["위협 표현", "사용하지 마세요", "범죄 예방", "신고하세요", "영화 대사"],
    surfaceMeaning: "특정 상대에게 신체 위해를 가하겠다는 직접적인 위협입니다.",
    riskSummary: "현실적인 폭력 가능성과 공포를 유발할 수 있어 즉각적인 검토가 필요합니다.",
    socialContext: "구체적인 대상·행동·시간이 포함될수록 위협의 긴급성이 높아집니다.",
    legalOrEthicIssue: "협박과 안전 침해 위험이 있습니다.",
    riskReason: "폭력 행동과 대상 지칭이 같은 문맥에 결합합니다.",
    severityFloor: 92,
    dominantRisk: true,
    confidence: 0.94,
    riskDomain: "폭력·위협",
    recentContextTags: ["신체 위해", "직접 위협", "긴급 안전"],
    safeRewrite: ["위협을 중단하고 갈등 상황과 필요한 도움을 사실 중심으로 설명해 주세요."],
    falsePositiveNote: "창작물 인용·위협 예방 교육·신고 문맥은 별도로 검토합니다.",
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
    const intraTokenPoint = character === "."
      && isWordCharacter(previous)
      && isWordCharacter(next);

    if (!intraTokenPoint && /[.!?。！？]/u.test(character)) {
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

function adjacentSentenceRanges(text: string): SentenceRange[] {
  const sentences = sentenceRanges(text);
  const ranges: SentenceRange[] = [];

  for (let index = 0; index < sentences.length; index += 1) {
    const current = sentences[index];
    ranges.push({ index: ranges.length, start: current.start, end: current.end });

    const next = sentences[index + 1];
    if (!next) continue;
    const separator = text.slice(current.end, next.start);
    if (/\n\s*\n/u.test(separator)) continue;
    ranges.push({ index: ranges.length, start: current.start, end: next.end });
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

const MAX_PATTERNS_PER_SKILL = 64;
const MAX_PATTERN_LENGTH = 320;

function rawRegexIssue(pattern: string) {
  const source = pattern.slice(3);
  if (source.length > MAX_PATTERN_LENGTH) return "정규식 패턴은 320자 이하여야 합니다.";
  if (/\\[1-9]|\\k</u.test(source)) return "역참조 정규식은 사용할 수 없습니다.";
  if (/\((?:\?:)?[^()]*(?:[+*]|\{\d*,?\d*\})[^()]*\)(?:[+*]|\{\d*,?\d*\})/u.test(source)) {
    return "중첩 반복 정규식은 사용할 수 없습니다.";
  }
  try {
    const compiled = new RegExp(source, "giu");
    compiled.test("RiskShield 안전성 검증용 입력 0000000000000000");
  } catch {
    return "컴파일할 수 없는 정규식입니다.";
  }
  return null;
}

function patternIssue(pattern: string) {
  if (!pattern.trim()) return "빈 패턴은 사용할 수 없습니다.";
  if (pattern.length > MAX_PATTERN_LENGTH + (pattern.startsWith("re:") ? 3 : 0)) {
    return "패턴은 320자 이하여야 합니다.";
  }
  if (pattern.startsWith("re:")) return rawRegexIssue(pattern);
  return null;
}

function literalRegExp(pattern: string) {
  const normalized = normalizeText(pattern);
  if (!normalized.length) return null;
  const source = normalized.split(/\s+/u).map(escapeRegExp).join("\\s*");
  return new RegExp(source, "giu");
}

function isWordCharacter(character: string) {
  return character.length > 0 && /[\p{L}\p{N}_]/u.test(character);
}

const KOREAN_SUFFIXES = [
  "으로", "에서", "에게", "까지", "부터", "처럼", "보다",
  "이라고", "입니다", "이었다", "합니다", "하며", "하고", "하지", "하다", "할", "하세요",
  "됩니다", "되는", "된다", "이다",
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

export const COMPATIBILITY_MATCHER_POLICY_VERSION = "1.0.0" as const;

export const COMPATIBILITY_MATCHER_REGISTRY: Readonly<Record<string, {
  trigger?: readonly string[];
  context?: readonly string[];
}>> = {
  "health_safety + absolute_absence": {
    trigger: ["re:안전(?:성|한|하다|합니다|하다고)?"],
    context: [
        "re:(?:하나도|전혀|절대|조금도)?\\s*없(?:습니다|어요|다|음|고|는|다고)",
        "re:(?:완전(?:히)?|100\\s*%)",
        "re:보장(?:합니다|한다|해|됨|된다)?",
    ],
  },
  "body_or_weight_result + certainty_or_period": {
    trigger: ["re:(?:키|신장|성장|체형|몸매)"],
    context: [
        "re:\\d+(?:[.]\\d+)?\\s*cm\\s*(?:까지|씩|이상|더)?[^.!?\\n]{0,16}(?:자라|자랍|커지|커집|큽|큰다|늘|성장)",
        "re:\\d+(?:[.]\\d+)?\\s*(?:~|-|∼)\\s*\\d+(?:[.]\\d+)?\\s*cm[^.!?\\n]{0,16}(?:키|신장|자라|커지|늘|성장)",
        "re:(?:자라|커지|큰다|늘|성장)[^.!?\\n]{0,16}\\d+(?:[.]\\d+)?\\s*cm",
    ],
  },
  "education_outcome + universal_promise": {
    trigger: ["re:(?:특채|채용|입사)"],
    context: [
        "re:시켜\\s*(?:드립|드립니다|드려|드리|줍|준다|드립니다)",
        "re:(?:전원|모두|누구나)",
        "re:확정(?:됩니다|된다|함|이다|입니다)?",
    ],
  },
  "education_outcome + guarantee": {
    trigger: ["re:(?:특채|채용|입사)"],
    context: ["re:시켜\\s*(?:드립|드립니다|드려|드리|줍|준다|드립니다)", "re:(?:전원|모두|누구나)", "re:확정(?:됩니다|된다|함|이다|입니다)?"],
  },
  "education_superlative_or_metric + service_subject": {
    trigger: ["re:(?:합격률|진학률|취업률)"],
    context: ["re:(?:재원생|수강생|대학|진학|합격자)"],
  },
  "legal_outcome + certainty_or_promise": {
    trigger: ["re:승소"],
    context: [
      "re:(?:결과(?:를|은|까지)?[^.!?\\n]{0,18})?(?:책임지|책임집|책임질|약속하)",
    ],
  },
  "financial_return_or_loss + guarantee_or_recovery": {
    context: ["re:전액[^.!?\\n]{0,12}돌려\\s*드(?:립|립니다|려요|림)"],
  },
  "legal_superlative_or_authority + substantiation_signal": {
    trigger: ["re:(?:승소|전관예우|전관)"],
    context: [
      "re:(?:승소\\s*)?(?:가능성|예상|확률)",
      "re:(?:판사|검사|전관)[^.!?\\n]{0,18}(?:출신|경력|인맥|영향력|직접|해결)",
      "re:(?:인맥|영향력|출신|변호사|법무법인|로펌)",
    ],
  },
  "app_installation + concealment_signal": {
    trigger: ["re:(?:앱|애플리케이션|프로그램|설치)"],
    context: [
      "re:(?:숨겨진|은밀한|비밀)\\s*모드",
      "re:아이콘(?:을|이|은|는)?[^.!?\\n]{0,18}(?:숨기|숨겨|숨김|표시되지|보이지)",
      "re:(?:실행\\s*중인\\s*)?앱\\s*목록(?:에|에서)?[^.!?\\n]{0,24}(?:표시되지|보이지|나타나지)",
    ],
  },
  "personal_data_asset + covert_surveillance": {
    trigger: ["re:(?:메신저|채팅|채팅방|알림|추적|감시)"],
    context: [
      "re:(?:상대방|당사자|본인)(?:이|은|는|에게)?[^.!?\\n]{0,24}(?:모르게|알지\\s*못하게|눈치채지\\s*못하게)",
      "re:(?:상대방|당사자|본인)(?:이|은|는|에게)?[^.!?\\n]{0,24}(?:절대\\s*)?알\\s*수\\s*없",
      "re:(?:들키지|발각되지|눈치채지)\\s*않게",
      "re:몰래[^.!?\\n]{0,24}(?:보는|읽는|확인하는)\\s*방법",
      "re:(?:알림|통보|표시)[^.!?\\n]{0,20}(?:삭제|숨기|남지|표시되지)",
    ],
  },
  "privacy_tracking + lack_of_consent": {
    trigger: [
      "re:(?:상대방|당사자|본인)(?:이|은|는|에게)?[^.!?\\n]{0,24}(?:모르게|알지\\s*못하게)",
      "re:(?:들키지|발각되지)\\s*않게",
    ],
  },
  "data_asset + access_or_export": {
    trigger: ["re:(?:대화|채팅|채팅방|메신저)"],
    context: ["re:(?:보는|읽는|열어보는)\\s*방법"],
  },
};

function normalizedPatternVariants(skill: RiskSkill, role: "trigger" | "context") {
  const base = role === "trigger" ? skill.triggerPatterns : skill.contextPatterns;
  const additions = COMPATIBILITY_MATCHER_REGISTRY[skill.patternType]?.[role] ?? [];
  return [...new Set([...base, ...additions])];
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

const CONTRAST_MARKERS = [
  "그럼에도", "그런데도", "일 수 있지만", "하지만", "그러나", "그런데", "다만",
  "반면", "그래도", "인데도", "이지만", "지만", "인데",
];

function candidateClauseRange(
  scopeText: string,
  evidenceStart: number,
  evidenceEnd: number,
) {
  let clauseStart = 0;
  let clauseEnd = scopeText.length;

  for (const marker of CONTRAST_MARKERS) {
    let cursor = scopeText.indexOf(marker);
    while (cursor >= 0) {
      const after = cursor + marker.length;
      if (after <= evidenceStart && after > clauseStart) clauseStart = after;
      if (cursor >= evidenceEnd && cursor < clauseEnd) clauseEnd = cursor;
      cursor = scopeText.indexOf(marker, cursor + marker.length);
    }
  }

  return {
    start: clauseStart,
    end: clauseEnd,
    text: scopeText.slice(clauseStart, clauseEnd).trim(),
  };
}

function isExplicitlyDenied(sentence: string) {
  const denialPatterns = [
    /(?:보장|확정|완치|분석|예측|추적|수집|환불)(?:을|를|은|는|이|가)?\s*(?:하지\s*않|할\s*수\s*없|되지\s*않|아니(?:다|며|고|므로|습니다)|불가)/u,
    /(?:보장|확정|완치|분석|예측|추적|수집|환불)하지(?:는|도|를)?\s*않/u,
    /(?:100\s*%|전액)(?:가|은|는)?\s*아니/u,
    /(?:표현|문구|주장|사례|광고)(?:은|는|을|를|이|가)?[^.!?\n]{0,32}(?:금지|사용하지|피해야|주의해야|과장|비판)/u,
    /(?:없(?:다|습니다)?|보장(?:한다|합니다)?)(?:고|라고)[^.!?\n]{0,30}(?:말|주장|표현)(?:할|해서는)?\s*수?\s*없/u,
    /부작용(?:이|은|는)?[^.!?\n]{0,20}(?:전혀|절대)?\s*없(?:다|습니다)?(?:고|다고)[^.!?\n]{0,24}(?:말|단정)(?:할|해서는)?\s*수\s*없/u,
    /(?:동의\s*필수|동의를\s*받(?:은|고|아야)|동의한\s*경우에만)/u,
    /(?:금지(?:된|된다|됩니다)?|불법(?:이|입니다|이다)|위반|사용하면\s*안\s*(?:된다|됩니다)|사용해서는\s*안|하지\s*마세요|해서는\s*안\s*됩니다)/u,
    /과도한\s*(?:장담|보장)[^.!?\n]{0,48}(?:신뢰할\s*수\s*없|믿기\s*어렵|위험|문제)/u,
    /(?:보장|확정|약속)(?:할\s*수\s*있는|하는)?[^.!?\n]{0,36}(?:투자|상품|수익|결과)(?:은|는|이|가)?[^.!?\n]{0,18}없(?:습니다|어요|다|음)/u,
    /(?:보장|확정|약속)(?:은|는|이|가)?\s*없(?:습니다|어요|다|음|다고)/u,
    /(?:사기|피해|과장\s*광고|허위\s*광고|불법\s*행위)[^.!?\n]{0,64}(?:주의|의심|피해야|피하|예방|방지|경고|비판)/u,
    /(?:주의|의심|피해야|피하|예방|방지|경고|비판)[^.!?\n]{0,64}(?:사기|피해|과장\s*광고|허위\s*광고|불법\s*행위)/u,
    /(?:보장|수익|고수익|원금|부업\s*소득|몰래|추적)[^.!?\n]{0,56}(?:광고|앱|사기|피해)[^.!?\n]{0,32}(?:주의|피해야|피하기|피하|예방|의심)/u,
    /(?:없(?:습니다|어요|다|음|다고))[^.!?\n]{0,36}(?:말|단정|주장|표현)[^.!?\n]{0,18}(?:안\s*됩|해서는\s*안|할\s*수\s*없)/u,
    /(?:과장|허위|부당)\s*광고(?:입니다|이다|라고|에\s*해당)/u,
    /(?:사생활\s*)?침해[^.!?\n]{0,36}(?:피해야|피하기|주의|예방|금지|불법)/u,
  ];
  return denialPatterns.some((pattern) => pattern.test(sentence));
}

function isMetalinguisticContext(scopeText: string) {
  const hasQuotation = /["'“”‘’「」『』]/u.test(scopeText);
  const hasQuotedRiskDiscussion = hasQuotation && /(?:문구|표현|주장|기사|보도|제목|사례|인용|문제|위험|비판|분석|검토|교육)/u.test(scopeText);
  const hasExplicitDiscussionFrame = /(?:문구|표현|주장|사례|광고|기사|제목)(?:의|에서|에는|은|는|을|를|이|가)?[^.!?\n]{0,40}(?:문제점|위험|비판|분석|검토|금지|사용되|인용|교육)/u.test(scopeText);
  return hasQuotedRiskDiscussion || hasExplicitDiscussionFrame;
}

function guardScopesForHits(input: string, hits: readonly PatternHit[]) {
  if (!hits.length) return [];
  const ranges = sentenceRanges(input);
  const evidenceStart = Math.min(...hits.map((hit) => hit.start));
  const evidenceEnd = Math.max(...hits.map((hit) => hit.end));
  const evidenceIndexes = ranges
    .map((range, index) => ({ range, index }))
    .filter(({ range }) => range.start < evidenceEnd && evidenceStart < range.end)
    .map(({ index }) => index);
  if (!evidenceIndexes.length) return [{ start: 0, end: input.length }];

  const first = evidenceIndexes[0];
  const last = evidenceIndexes[evidenceIndexes.length - 1];
  const candidates: Array<{ start: number; end: number }> = [
    { start: ranges[first].start, end: ranges[last].end },
  ];

  if (first === last) {
    const previous = ranges[first - 1];
    const current = ranges[first];
    const next = ranges[first + 1];
    if (previous && !/\n\s*\n/u.test(input.slice(previous.end, current.start))) {
      candidates.push({ start: previous.start, end: current.end });
    }
    if (next && !/\n\s*\n/u.test(input.slice(current.end, next.start))) {
      candidates.push({ start: current.start, end: next.end });
    }
  }

  return candidates;
}

function isPostMatchContextGuarded(
  input: string,
  skill: RiskSkill,
  hits: readonly PatternHit[],
) {
  const evidenceStart = Math.min(...hits.map((hit) => hit.start));
  const evidenceEnd = Math.max(...hits.map((hit) => hit.end));

  for (const scope of guardScopesForHits(input, hits)) {
    const scopeText = input.slice(scope.start, scope.end);
    const normalizedScope = normalizeText(scopeText);
    const normalizedEvidenceStart = normalizeText(input.slice(scope.start, evidenceStart)).length;
    const normalizedEvidenceEnd = normalizeText(input.slice(scope.start, evidenceEnd)).length;
    const clause = candidateClauseRange(
      normalizedScope,
      normalizedEvidenceStart,
      normalizedEvidenceEnd,
    ).text;
    if (isExplicitlyDenied(clause) || isMetalinguisticContext(clause)) return true;
  }

  const normalizedInput = normalizeText(input);
  const insuranceCoverageBoundary = skill.patternType === "legal_outcome + certainty_or_promise"
    && /(?:보험|특약|담보|보험금|보장\s*항목|보장\s*범위|벌금\s*비용|벌금비용)/u.test(normalizedInput)
    && !/(?:승소|무죄|불기소|감형|집행유예|사건\s*결과|변호|법률\s*서비스)/u.test(normalizedInput);
  const installationArtBoundary = skill.patternType === "app_installation + concealment_signal"
    && /(?:설치\s*미술|미술\s*작품|전시\s*작품)/u.test(normalizedInput);
  return insuranceCoverageBoundary || installationArtBoundary;
}

function supportsAdjacentSentenceMatching(skill: RiskSkill) {
  if (skill.conditionScope === "paragraph") return true;
  return [
    "urgency_signal + purchase_or_application",
    "legal_outcome + certainty_or_promise",
    "personal_data_asset + covert_surveillance",
    "app_installation + concealment_signal",
    "education_outcome + universal_promise",
  ].includes(skill.patternType);
}

function bestSkillMatch(input: string, skill: RiskSkill): SkillMatch | null {
  if (!skill.triggerPatterns.length) return null;
  const normalized = normalizeWithMap(input);
  const ranges = supportsAdjacentSentenceMatching(skill)
    ? adjacentSentenceRanges(normalized.text)
    : sentenceRanges(normalized.text);
  const maxDistance = clamp(Math.round(skill.maxDistance), 0, 2_000);
  const triggerPatterns = normalizedPatternVariants(skill, "trigger");
  const contextPatterns = normalizedPatternVariants(skill, "context");

  if (skill.matchMode === "atomic_lexeme") {
    for (const range of ranges) {
      const triggerHits = findPatternHits(input, normalized, range, triggerPatterns, "trigger");
      const exclusionHits = findPatternHits(input, normalized, range, skill.exclusionPatterns ?? [], "context");
      const scopedText = normalized.text.slice(range.start, range.end);
      for (const trigger of triggerHits) {
        const clause = candidateClauseRange(
          scopedText,
          trigger.normalizedStart - range.start,
          trigger.normalizedEnd - range.start,
        );
        const clauseStart = range.start + clause.start;
        const clauseEnd = range.start + clause.end;
        if (exclusionHits.some((hit) => hit.normalizedStart >= clauseStart && hit.normalizedEnd <= clauseEnd)) continue;
        const hit: PatternHit = {
          pattern: trigger.pattern,
          role: trigger.role,
          start: trigger.start,
          end: trigger.end,
          text: trigger.text,
          sentenceIndex: trigger.sentenceIndex,
        };
        if (isPostMatchContextGuarded(input, skill, [hit])) continue;
        return { skill, hits: [hit], score: clamp(Math.round(skill.severityFloor), 0, 100) };
      }
    }
    return null;
  }

  if (!skill.contextPatterns.length) return null;

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
    const triggerHits = findPatternHits(input, normalized, range, triggerPatterns, "trigger");
    const contextHits = findPatternHits(input, normalized, range, contextPatterns, "context");
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
          const clause = candidateClauseRange(scopedText, start - range.start, end - range.start);
          const clauseStart = range.start + clause.start;
          const clauseEnd = range.start + clause.end;
          const outcomeResponsibility = skill.patternType === "legal_outcome + certainty_or_promise"
            && /(?:책임|약속)/u.test(context.text);
          if (exclusionHits.some((hit) =>
            hit.normalizedStart >= clauseStart
            && hit.normalizedEnd <= clauseEnd
            && !(outcomeResponsibility && /가능성/u.test(hit.text)))) continue;
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

  const normalizedInput = normalizeText(input);
  const looksLikeBareGuaranteedMonthlyAmount = /월\s*\d{1,5}\s*(?:만\s*)?원[^.!?\n]{0,18}보장/u.test(normalizedInput)
    && !/(?:투자|수익|원금|손실|손해|이익|배당|주식|펀드)/u.test(normalizedInput)
    && !/(?:누구나|벌\s*수|소득|수입|부업|재택)/u.test(normalizedInput);
  if (skill.riskDomain.includes("금융") && looksLikeBareGuaranteedMonthlyAmount) return null;

  for (const selected of candidates) {
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
    if (isPostMatchContextGuarded(input, skill, hits)) continue;
    return {
      skill,
      hits,
      score: clamp(Math.round(skill.severityFloor), 0, 100),
    };
  }

  return null;
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

function statusForScore(score: number): Pick<AnalysisResult, "status" | "statusLabel"> {
  if (score >= 80) return { status: "high", statusLabel: "높은 위험" };
  if (score >= 70) return { status: "attention", statusLabel: "주의 필요" };
  if (score > 0) return { status: "review", statusLabel: "추가 검토" };
  return { status: "no_match", statusLabel: "규칙 미일치" };
}

export function detectSpeechAct(input: string): AnalysisResult["speechAct"] {
  const text = normalizeText(input);
  const hasQuotation = /["'“”‘’「」『』]/u.test(input);
  if (/(?:하지만|지만|그러나|그럼에도|그래도|인데(?:도)?)[^.!?\n]{0,80}(?:지금|신청|구매|가입|등록|보장|추적|감청|녹음|해\s*드립니다|가능)/u.test(text)) return "promotion";
  if (hasQuotation && /(?:문구|표현|주장|기사|제목|사례|인용|분석|검토)/u.test(text)) return "quotation";
  if (/(?:문제점|문제\s*광고|비판|허위·?과장|위험을\s*검토)/u.test(text)) return "criticism";
  if (/(?:금지|불법|위반|사용하면\s*안|해서는\s*안|하지\s*마세요|주의해야|동의\s*필수)/u.test(text)) return "warning";
  if (/(?:경우|조건|약관|기준|따라|한해|기간|수수료|제외한\s*후)/u.test(text)) return "condition";
  if (/(?:지금|신청|구매|가입|등록|드리|제공|보장|약속|추천)/u.test(text)) return "promotion";
  return "statement";
}

function outputCopy(
  primary: SkillMatch | null,
  speechAct: AnalysisResult["speechAct"],
) {
  if (!primary) return { reason: null, suggestedRewrite: null };
  if (speechAct === "warning" || speechAct === "criticism" || speechAct === "quotation") {
    return { reason: null, suggestedRewrite: null };
  }
  const reasonPrefix = speechAct === "condition"
    ? "조건 안내에 포함된 주장으로, 적용 근거를 함께 확인해야 합니다. "
    : speechAct === "statement"
      ? "사실 설명 형식이므로 객관적 근거와 적용 범위를 확인해야 합니다. "
      : "";
  return {
    reason: `${reasonPrefix}${primary.skill.riskReason}`.trim(),
    suggestedRewrite: primary.skill.safeRewrite[0] ?? null,
  };
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
  const rawMatches = usableSkills.flatMap((skill) => {
    const match = bestSkillMatch(input, skill);
    return match ? [match] : [];
  }).filter((match) => !isPostMatchContextGuarded(input, match.skill, match.hits));
  const normalizedInput = normalizeText(input);
  const hasIncomeSpecificMatch = rawMatches.some((match) => match.skill.riskDomain.includes("구인·부업"));
  const hasPayrollContext = /(?:정규직|근로계약|기본급|연봉|세전|급여\s*조건)/u.test(normalizedInput);
  const hasInvestmentContext = /(?:투자|수익|원금|손실|손해|이익|배당|주식|펀드)/u.test(normalizedInput);
  const matches = !hasInvestmentContext && (hasIncomeSpecificMatch || hasPayrollContext)
    ? rawMatches.filter((match) => !match.skill.riskDomain.includes("금융"))
    : rawMatches;

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
  const speechAct = detectSpeechAct(input);
  const status = statusForScore(finalScore);
  const copy = outputCopy(matches[0] ?? null, speechAct);

  return {
    input,
    finalScore,
    grade: gradeForScore(finalScore, severityRules),
    ...status,
    speechAct,
    recommendation: matches.length
      ? finalScore >= 70
        ? "배포 전 담당자의 검토와 표현 수정을 권장합니다. 이 결과는 자동 금지 판단이 아닙니다."
        : "탐지된 조합의 맥락과 근거를 담당자가 확인해 주세요."
      : "현재 검토된 조합 규칙에서는 위험 패턴이 탐지되지 않았습니다. 이는 자동 승인이나 안전 보장을 의미하지 않습니다.",
    reason: copy.reason,
    suggestedRewrite: copy.suggestedRewrite,
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
  const allPatterns = [
    ...skill.triggerPatterns,
    ...skill.contextPatterns,
    ...skill.anyOfPatterns,
    ...(skill.exclusionPatterns ?? []),
  ];
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
  if (skill.matchMode && !["atomic_lexeme", "trigger_and_context"].includes(skill.matchMode)) {
    errors.push("matchMode는 atomic_lexeme 또는 trigger_and_context여야 합니다.");
  }
  if (!skill.triggerPatterns.length || skill.triggerPatterns.some((pattern) => !pattern.trim())) {
    errors.push("유효한 트리거 패턴이 한 개 이상 필요합니다.");
  }
  if ((skill.matchMode !== "atomic_lexeme" && !skill.contextPatterns.length) || skill.contextPatterns.some((pattern) => !pattern.trim())) {
    errors.push("유효한 맥락 패턴이 한 개 이상 필요합니다.");
  }
  if (skill.exclusionPatterns?.some((pattern) => !pattern.trim())) {
    errors.push("제외 패턴은 빈 문자열일 수 없습니다.");
  }
  if (skill.anyOfPatterns.some((pattern) => !pattern.trim())) {
    errors.push("any_of 패턴은 빈 문자열일 수 없습니다.");
  }
  if (allPatterns.length > MAX_PATTERNS_PER_SKILL) {
    errors.push(`스킬 하나에는 최대 ${MAX_PATTERNS_PER_SKILL}개 패턴만 사용할 수 있습니다.`);
  }
  for (const pattern of allPatterns) {
    const issue = patternIssue(pattern);
    if (issue) errors.push(`${pattern.slice(0, 48)}: ${issue}`);
  }
  const regressionTests = skill.regressionTests ?? [];
  if (regressionTests.length > 40) {
    errors.push("회귀 테스트는 스킬당 최대 40개까지 등록할 수 있습니다.");
  }
  const regressionIds = new Set<string>();
  regressionTests.forEach((regressionCase, index) => {
    if (!regressionCase.id.trim() || regressionCase.id.length > 200) {
      errors.push(`회귀 테스트 ${index + 1}의 ID가 유효하지 않습니다.`);
    } else if (regressionIds.has(regressionCase.id)) {
      errors.push(`중복된 회귀 테스트 ID입니다: ${regressionCase.id}`);
    } else {
      regressionIds.add(regressionCase.id);
    }
    if (!regressionCase.input.trim() || regressionCase.input.length > 2_000) {
      errors.push(`회귀 테스트 ${index + 1}의 입력은 1~2,000자여야 합니다.`);
    }
    if (regressionCase.expected !== "match" && regressionCase.expected !== "no_match") {
      errors.push(`회귀 테스트 ${index + 1}의 expected 값이 유효하지 않습니다.`);
    }
    if ((regressionCase.contextSlice?.length ?? 0) > 240) {
      errors.push(`회귀 테스트 ${index + 1}의 문맥 설명은 240자 이하여야 합니다.`);
    }
  });
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
  if (skill.source.url.trim()) {
    try {
      const sourceUrl = new URL(skill.source.url);
      if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
        errors.push("출처 URL은 http 또는 https 주소여야 합니다.");
      }
    } catch {
      errors.push("출처 URL은 올바른 http 또는 https 주소여야 합니다.");
    }
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

/**
 * Managed and model-generated skills use the portable matcher DSL only.
 * Raw JavaScript regular expressions remain confined to the versioned,
 * code-reviewed compatibility kernel so a D1 write cannot introduce ReDoS.
 */
export function validateManagedSkill(skill: RiskSkill) {
  const errors = [...validateSkill(skill)];
  if (!skill.riskFamily) errors.push("관리 스킬에는 안정된 riskFamily 식별자가 필요합니다.");
  const rawPattern = [
    ...skill.triggerPatterns,
    ...skill.contextPatterns,
    ...skill.anyOfPatterns,
    ...(skill.exclusionPatterns ?? []),
  ].find((pattern) => pattern.startsWith("re:"));
  if (rawPattern) {
    errors.push(`관리 스킬은 raw regex를 사용할 수 없습니다: ${rawPattern.slice(0, 48)}`);
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
    riskFamily: "general_substantiation",
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

  const declaredSchemaVersion = readString(value, ["schema_version", "schemaVersion"]);
  if (
    declaredSchemaVersion
    && declaredSchemaVersion !== RISK_SKILL_SCHEMA_VERSION
    && declaredSchemaVersion !== "1.0.0"
  ) {
    return {
      issues: [`지원하지 않는 스키마 버전 ${declaredSchemaVersion}입니다.`],
    };
  }

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
  const patternType = readString(value, ["pattern_type", "patternType"]);
  const declaredMatchMode = readString(value, ["match_mode", "matchMode"]);
  const declaredRiskFamily = readString(value, ["risk_family", "riskFamily"]);
  const riskFamily = declaredRiskFamily && RISK_FAMILIES.includes(declaredRiskFamily as typeof RISK_FAMILIES[number])
    && declaredRiskFamily !== "none"
    ? declaredRiskFamily as ScorableRiskFamily
    : riskFamilyForPatternType(patternType);

  const skill: RiskSkill = {
    schemaVersion: RISK_SKILL_SCHEMA_VERSION,
    revision: Math.max(1, Math.round(readNumber(value, ["revision"], 1))),
    id,
    category: readString(value, ["category"]),
    subcategory: readString(value, ["subcategory"]),
    patternType,
    matchMode: declaredMatchMode === "atomic_lexeme" ? "atomic_lexeme" : "trigger_and_context",
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
    riskFamily,
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

  const issues = [
    ...(declaredRiskFamily && declaredRiskFamily !== riskFamily ? [`지원하지 않는 riskFamily ${declaredRiskFamily}입니다.`] : []),
    ...validateSkill(skill),
  ];
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

function skillFingerprint(skill: RiskSkill) {
  return JSON.stringify(skill);
}

export function previewSkillImport(
  currentSkills: RiskSkill[],
  incomingSkills: RiskSkill[],
  mode: SkillImportMode = "merge",
  errorCount = 0,
): SkillImportPreview {
  const currentById = new Map(currentSkills.map((skill) => [skill.id, skill]));
  const incomingById = new Map(incomingSkills.map((skill) => [skill.id, skill]));
  const newIds: string[] = [];
  const updateIds: string[] = [];
  const sameIds: string[] = [];
  const conflictIds: string[] = [];

  for (const incoming of incomingSkills) {
    const current = currentById.get(incoming.id);
    if (!current) {
      newIds.push(incoming.id);
    } else if (skillFingerprint(current) === skillFingerprint(incoming)) {
      sameIds.push(incoming.id);
    } else if (incoming.revision > current.revision) {
      updateIds.push(incoming.id);
    } else {
      conflictIds.push(incoming.id);
    }
  }

  const finalSkills = mode === "replace"
    ? [...incomingById.values()]
    : [
        ...currentSkills.filter((skill) => !updateIds.includes(skill.id)),
        ...incomingSkills.filter((skill) => newIds.includes(skill.id) || updateIds.includes(skill.id)),
      ];
  finalSkills.sort((left, right) => compareText(left.id, right.id));

  return {
    mode,
    newCount: newIds.length,
    updateCount: updateIds.length,
    sameCount: sameIds.length,
    conflictCount: conflictIds.length,
    skippedCount: mode === "merge" ? conflictIds.length + errorCount : errorCount,
    errorCount,
    finalCount: finalSkills.length,
    newIds: newIds.sort(compareText),
    updateIds: updateIds.sort(compareText),
    sameIds: sameIds.sort(compareText),
    conflictIds: conflictIds.sort(compareText),
    finalSkills,
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
    match_mode: skill.matchMode ?? "trigger_and_context",
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
    risk_family: skill.riskFamily ?? riskFamilyForPatternType(skill.patternType),
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
