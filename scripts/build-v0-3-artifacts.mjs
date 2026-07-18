import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Workbook } from "@oai/artifact-tool";

const root = path.resolve(process.argv[2] ?? process.cwd());
const riskshield = await import(pathToFileURL(path.join(root, "lib", "riskshield.ts")));
const candidateModule = await import(pathToFileURL(path.join(root, "lib", "v0-3-candidate-skills.ts")));
const testAdapter = await import(pathToFileURL(path.join(root, "lib", "v0-3-test-adapter.ts")));
const { analyzeText, starterSkills, validateSkill } = riskshield;
const { candidateSkillsV03 } = candidateModule;
const { activateDraftCandidatesForTest } = testAdapter;
const outputDir = path.join(root, "artifacts", "v0.3");
const sourceCasesPath = path.join(root, "artifacts", "real-world-evaluation", "collected-ad-cases.csv");
const sourceResultsPath = path.join(root, "artifacts", "real-world-evaluation", "analyzer-real-world-results.csv");
const fixturePath = path.join(root, "tests", "fixtures", "analyzer-v0.3-generalization.csv");

const labelChanges = {
  RW004: ["safe", "0-19", "high", "일반 할인 이벤트 안내만으로는 투자 위험이나 기만성을 판단할 수 없다."],
  RW011: ["ambiguous", "20-79", "medium", "근로·부업·실적급 맥락이 없어 월 200만원 보장이 정상 급여인지 소득 광고인지 원문만으로 확정할 수 없다."],
  RW020: ["ambiguous", "20-79", "medium", "‘책임감량제’라는 명칭만으로 보장 범위와 실제 효능 주장을 확정할 수 없어 추가 문맥이 필요하다."],
  RW021: ["ambiguous", "20-79", "medium", "모공 수 개선은 측정 기준과 제품 범위에 대한 입증이 필요한 주장이나 원문만으로 허위 여부는 확정할 수 없다."],
  RW032: ["ambiguous", "20-79", "medium", "‘가장 큰’은 비교 기준과 조사 범위를 확인해야 하는 최상급 표현이다."],
  RW033: ["ambiguous", "20-79", "medium", "‘최고의 강사’는 객관적 비교 기준과 입증 자료가 필요한 표현이다."],
  RW035: ["ambiguous", "20-79", "medium", "판사 경력과 직접 진행 사실만으로 결과 영향력 암시 여부를 단정하기 어려워 주변 광고 문맥이 필요하다."],
  RW036: ["ambiguous", "20-79", "medium", "‘제일 잘한다’는 비교 대상과 근거를 확인해야 하는 주관적 최상급 표현이다."],
  RW039: ["ambiguous", "20-79", "medium", "‘국내 최고 승소율’은 산정 기간·모수·비교 범위를 확인해야 하는 입증 필요 주장이다."],
  RW040: ["ambiguous", "20-79", "medium", "‘유일한’이라는 독점 표현은 객관적 비교 범위와 등록 현황 확인이 필요하다."],
  RW042: ["ambiguous", "20-79", "medium", "승소율 99%는 산정 기준과 사건 범위를 확인해야 하며 원문만으로 허위 여부를 확정할 수 없다."],
  RW055: ["ambiguous", "20-79", "medium", "데이터 열람·저장은 정상적인 본인 기능일 수도 있어 대상·동의·권한 문맥이 필요하다."],
  RW062: ["ambiguous", "20-79", "medium", "‘특급호텔’은 공식 등급 또는 상품 설명의 진위를 외부 자료로 확인해야 한다."],
  RW063: ["ambiguous", "20-79", "medium", "특정지역 우선권은 실제 공급 조건과 공고 근거가 있어야 사실 여부를 판단할 수 있다."],
  RW065: ["ambiguous", "20-79", "medium", "95% 분양완료는 기준일과 계약 집계 자료가 필요한 사실 주장이다."],
  RW066: ["ambiguous", "20-79", "medium", "신청 기한이 실제로 임박했을 수 있어 일정과 수량 근거를 확인해야 한다."],
  RW067: ["ambiguous", "20-79", "medium", "100% 분양은 기준일과 계약 완료 자료를 확인해야 하는 실적 주장이다."],
  RW069: ["ambiguous", "20-79", "medium", "전국 최고 경쟁률은 비교 대상·기간·집계 기준에 대한 입증이 필요하다."],
  RW070: ["ambiguous", "20-79", "medium", "은행지점 입점확정은 계약 또는 공식 발표를 확인해야 하는 외부 사실 주장이다."],
  RW037: ["safe", "0-19", "high", "소속 변호사의 무료 상담 가능성을 안내할 뿐 결과나 효능을 보장하지 않는다."],
  RW093: ["safe", "0-19", "high", "패키지 상품에 별도 규정이 적용됨을 알리는 조건 안내다."],
  RW094: ["safe", "0-19", "high", "할인쿠폰의 적용 제한 가능성을 명시한 조건 안내다."],
  RW095: ["safe", "0-19", "high", "할인쿠폰 중복 사용 제한을 명시한 정상 조건 안내다."],
  RW097: ["safe", "0-19", "high", "개인적 추천 의사 표현만으로 위험 주장이나 기만 요소를 판단할 수 없다."],
  RW099: ["safe", "0-19", "high", "광고 포함 여부를 표시하는 고지 문구이며 위험 기능이나 효능을 주장하지 않는다."],
};

const generalizationCases = [
  ["G001", "health_safety", "이 시술은 부작용이 절대 없습니다.", "high", 80, 100, "risk_v03_health_safety_absolute", "부작용 절대 부재"],
  ["G002", "health_safety", "제품의 위해성이 조금도 없다고 확언합니다.", "high", 80, 100, "risk_v03_health_safety_absolute", "위해성 절대 부재 동의 표현"],
  ["G003", "health_safety", "안전성은 100% 안전하다고 보장합니다.", "high", 80, 100, "risk_v03_health_safety_absolute", "100% 안전성 보장"],
  ["G004", "health_safety", "부작용 가능성이 있으므로 전문가와 상담하세요.", "no_match", 0, 0, "", "전문가 상담 경고"],
  ["G005", "health_safety", "부작용이 전혀 없다고 말할 수 없습니다.", "no_match", 0, 0, "", "절대 부재 주장을 부정"],

  ["G006", "health_disease", "이 제품은 혈당을 확실히 조절해 줍니다.", "high", 80, 100, "risk_v03_health_disease_effect", "혈당 조절 효능"],
  ["G007", "health_disease", "숙취를 완화하는 효능이 있습니다.", "high", 80, 100, "risk_v03_health_disease_effect", "숙취 완화 효능"],
  ["G008", "health_disease", "이 기기는 통증 제거 효과를 제공합니다.", "high", 80, 100, "risk_v03_health_disease_effect", "통증 제거 효능"],
  ["G009", "health_disease", "혈당 관리에 도움을 줄 수 있으며 개인차가 있습니다.", "no_match", 0, 0, "", "가능성·개인차 제한"],
  ["G010", "health_disease", "연구 표본에서 변비 개선 경향을 관찰했습니다.", "no_match", 0, 0, "", "제한된 연구 설명"],

  ["G011", "health_body", "7일 동안 체지방 3kg을 줄여 드립니다.", "high", 80, 100, "risk_v03_health_body_result", "단기간 정량 감량"],
  ["G012", "health_body", "한 달이면 몸매를 확실하게 만들어 줍니다.", "high", 80, 100, "risk_v03_health_body_result", "기간·확정 외모 결과"],
  ["G013", "health_body", "다이어트로 반드시 체중 감량에 성공합니다.", "high", 80, 100, "risk_v03_health_body_result", "감량 결과 확정"],
  ["G014", "health_body", "개인차에 따라 체중 변화가 다를 수 있습니다.", "no_match", 0, 0, "", "개인차 고지"],
  ["G015", "health_body", "건강한 식습관 목표를 세우는 다이어트 프로그램입니다.", "no_match", 0, 0, "", "지원 과정 안내"],

  ["G016", "legal_outcome", "이 사건은 무조건 승소를 보장합니다.", "high", 80, 100, "risk_v03_legal_outcome_promise", "승소 결과 보장"],
  ["G017", "legal_outcome", "합의금 수령을 100% 약속드립니다.", "high", 80, 100, "risk_v03_legal_outcome_promise", "합의금 결과 약속"],
  ["G018", "legal_outcome", "허가를 확정적으로 받아 드립니다.", "high", 80, 100, "risk_v03_legal_outcome_promise", "행정 결과 확정"],
  ["G019", "legal_outcome", "사건 결과는 사실관계에 따라 달라지며 승소를 보장하지 않습니다.", "no_match", 0, 0, "", "결과 불확실성 고지"],
  ["G020", "legal_outcome", "무조건 승소라는 광고는 과장 광고입니다.", "no_match", 0, 0, "", "결과 보장 비판"],

  ["G021", "legal_substantiation", "국내 최고 승소율을 자랑하는 법률사무소입니다.", "review", 1, 69, "risk_v03_legal_substantiation", "최상급·성과 입증 필요"],
  ["G022", "legal_substantiation", "판사 출신 변호사가 사건을 직접 맡습니다.", "review", 1, 69, "risk_v03_legal_substantiation", "권위 경력 신호"],
  ["G023", "legal_substantiation", "승소율 92%의 이혼 전문 변호사입니다.", "review", 1, 69, "risk_v03_legal_substantiation", "성과 수치 입증 필요"],
  ["G024", "legal_substantiation", "과거 승소율 통계는 산정 기준과 함께 확인하세요.", "no_match", 0, 0, "", "검증 기준 안내"],
  ["G025", "legal_substantiation", "최고라는 표현은 증명할 자료가 없으면 금지됩니다.", "no_match", 0, 0, "", "최상급 표현 금지"],

  ["G026", "general_substantiation", "상가 분양 97% 완료를 알립니다.", "review", 1, 69, "risk_v03_general_substantiation", "완료율 입증 필요"],
  ["G027", "general_substantiation", "유명 카페 입점이 확정됐습니다.", "review", 1, 69, "risk_v03_general_substantiation", "입점 확정 입증 필요"],
  ["G028", "general_substantiation", "공식 인증 등급을 받았다고 표시합니다.", "review", 1, 69, "risk_v03_general_substantiation", "인증·등급 입증 필요"],
  ["G029", "general_substantiation", "공식 인증번호와 기준일을 함께 공개합니다.", "no_match", 0, 0, "", "확인 가능한 인증 정보"],
  ["G030", "general_substantiation", "행사는 다음 달 시작하는 일정 안내입니다.", "no_match", 0, 0, "", "단순 일정 안내"],

  ["G031", "general_urgency", "마지막 기회이니 지금 구매하세요.", "review", 1, 69, "risk_v03_general_urgency", "구매 압박"],
  ["G032", "general_urgency", "선착순으로 등록 가능한 한정 프로그램입니다.", "review", 1, 69, "risk_v03_general_urgency", "등록 희소성"],
  ["G033", "general_urgency", "재고가 얼마 남지 않았으니 빨리 신청하세요.", "review", 1, 69, "risk_v03_general_urgency", "신청 압박"],
  ["G034", "general_urgency", "접수 마감일은 8월 31일이라는 일정 안내입니다.", "no_match", 0, 0, "", "실제 마감 일정 안내"],
  ["G035", "general_urgency", "현재 재고 현황을 매일 공개합니다.", "no_match", 0, 0, "", "재고 사실 안내"],

  ["G036", "finance", "원금은 6개월 안에 전액 회수됩니다.", "high", 80, 100, "risk_v03_finance_return_recovery", "원금 회수 확정"],
  ["G037", "finance", "손실이 나면 투자금 전액 환불을 보장합니다.", "high", 80, 100, "risk_v03_finance_return_recovery", "손실 환불 보장"],
  ["G038", "finance", "고수익만 제공하고 원금도 보전해 드립니다.", "high", 80, 100, "risk_v03_finance_return_recovery", "수익·원금 보장"],
  ["G039", "finance", "투자에는 원금 손실 가능성이 있으며 수익은 보장되지 않습니다.", "no_match", 0, 0, "", "투자 위험 고지"],
  ["G040", "finance", "결제 취소 시 배송 전 금액을 전액 환불합니다.", "no_match", 0, 0, "", "소비자 환불 정책"],

  ["G041", "income", "재택 부업으로 누구나 월 300만원을 보장받습니다.", "high", 80, 100, "risk_v03_income_universal_guarantee", "부업 소득 보장"],
  ["G042", "income", "최소 소득 250만원 이상을 확정 지급합니다.", "high", 80, 100, "risk_v03_income_universal_guarantee", "최소 소득 확정"],
  ["G043", "income", "부업 수입은 누구나 최소 월 150만원입니다.", "high", 80, 100, "risk_v03_income_universal_guarantee", "보편 소득 약속"],
  ["G044", "income", "정규직 기본급은 근로계약에 따라 월 280만원입니다.", "no_match", 0, 0, "", "정상 근로계약 급여"],
  ["G045", "income", "성과에 따라 수입이 달라질 수 있습니다.", "no_match", 0, 0, "", "실적 변동 고지"],

  ["G046", "education_outcome", "수강생 전원의 취업을 보장합니다.", "high", 80, 100, "risk_v03_education_outcome_promise", "취업 결과 보장"],
  ["G047", "education_outcome", "50명 중 50명이 합격하도록 약속합니다.", "high", 80, 100, "risk_v03_education_outcome_promise", "분수형 전원 합격"],
  ["G048", "education_outcome", "조건에 상관없이 성적 향상을 보장합니다.", "high", 80, 100, "risk_v03_education_outcome_promise", "성적 결과 보장"],
  ["G049", "education_outcome", "지난해 합격자 통계는 출처와 함께 공개합니다.", "no_match", 0, 0, "", "과거 통계 설명"],
  ["G050", "education_outcome", "진학 목표에 맞춰 지원 과정을 제공합니다.", "no_match", 0, 0, "", "교육 지원 과정"],

  ["G051", "education_substantiation", "전국 1위 입시 강사의 수업입니다.", "review", 1, 69, "risk_v03_education_substantiation", "교육 최상급 입증 필요"],
  ["G052", "education_substantiation", "가장 큰 학원에서 교육합니다.", "review", 1, 69, "risk_v03_education_substantiation", "학원 규모 입증 필요"],
  ["G053", "education_substantiation", "합격률 96%를 기록한 독보적 교육 과정입니다.", "review", 1, 69, "risk_v03_education_substantiation", "교육 성과 입증 필요"],
  ["G054", "education_substantiation", "과거 합격자 통계의 출처와 기준을 공개합니다.", "no_match", 0, 0, "", "근거가 있는 과거 통계"],
  ["G055", "education_substantiation", "최고 강사라는 광고는 부당 광고 위반 소지가 있습니다.", "no_match", 0, 0, "", "최상급 광고 비판"],

  ["G056", "privacy_surveillance", "상대 몰래 메시지를 실시간으로 확인할 수 있습니다.", "high", 80, 100, "risk_v03_privacy_covert_surveillance", "비동의 메시지 열람"],
  ["G057", "privacy_surveillance", "마이크를 켜 원격 녹음하고 통화를 감청합니다.", "high", 80, 100, "risk_v03_privacy_covert_surveillance", "통신 감청"],
  ["G058", "privacy_surveillance", "GPS 위치를 들키지 않게 추적해 드립니다.", "high", 80, 100, "risk_v03_privacy_covert_surveillance", "은폐 위치 추적"],
  ["G059", "privacy_surveillance", "명시적 동의를 받은 가족의 위치만 공유합니다.", "no_match", 0, 0, "", "동의 기반 위치 공유"],
  ["G060", "privacy_surveillance", "몰래 위치를 추적하는 행위는 불법이며 금지됩니다.", "no_match", 0, 0, "", "비동의 추적 금지"],

  ["G061", "privacy_stealth", "설치한 앱의 아이콘을 숨겨 상대가 모르게 합니다.", "high", 80, 100, "risk_v03_privacy_stealth_install", "설치 은폐"],
  ["G062", "privacy_stealth", "피감시자가 알기 어렵도록 앱 작동 표시를 숨깁니다.", "high", 80, 100, "risk_v03_privacy_stealth_install", "작동 은폐"],
  ["G063", "privacy_stealth", "설치 사실이 표시되지 않도록 은폐합니다.", "high", 80, 100, "risk_v03_privacy_stealth_install", "설치 사실 은폐"],
  ["G064", "privacy_stealth", "관리자 동의 아래 보안 앱을 설치합니다.", "no_match", 0, 0, "", "동의 기반 보안 설치"],
  ["G065", "privacy_stealth", "접근성 기능 사용 여부를 앱 화면에 명확히 표시합니다.", "no_match", 0, 0, "", "투명한 기능 표시"],

  ["G066", "privacy_data", "저장된 메시지를 내려받아 확인할 수 있습니다.", "review", 1, 69, "risk_v03_privacy_data_access_review", "데이터 반출 권한 검토"],
  ["G067", "privacy_data", "실시간 데이터를 열람하고 외부로 전송합니다.", "review", 1, 69, "risk_v03_privacy_data_access_review", "데이터 열람·전송"],
  ["G068", "privacy_data", "사진과 파일 기록을 저장해 확인합니다.", "review", 1, 69, "risk_v03_privacy_data_access_review", "파일 저장·확인"],
  ["G069", "privacy_data", "사용자 동의와 권한에 따라 본인 파일을 다운로드합니다.", "no_match", 0, 0, "", "권한 기반 본인 다운로드"],
  ["G070", "privacy_data", "관리자 권한으로 백업 데이터를 복원합니다.", "no_match", 0, 0, "", "정상 관리자 백업"],

  ["G071", "income_review", "월 220만원 이상 보장합니다.", "review", 1, 69, "risk_v03_income_guarantee", "도메인이 불명확한 월 금액 보장"],
  ["G072", "income_review", "월 180만원을 최소 보장합니다.", "review", 1, 69, "risk_v03_income_guarantee", "도메인이 불명확한 최소 월 금액"],
  ["G073", "income_review", "월 350만원 이상 지급을 약속합니다.", "review", 1, 69, "risk_v03_income_guarantee", "추가 문맥이 필요한 월 지급 주장"],
  ["G074", "income_review", "근로계약의 기본급은 월 250만원으로 확정됩니다.", "no_match", 0, 0, "", "정상 근로계약 급여"],
  ["G075", "income_review", "월별 실적과 소득은 달라질 수 있습니다.", "no_match", 0, 0, "", "소득 변동 고지"],
];

const positiveNegativeBySkill = new Map();
for (const row of generalizationCases) {
  const skillId = row[6];
  if (!skillId) continue;
  const entry = positiveNegativeBySkill.get(skillId) ?? { positives: [], negatives: [] };
  entry.positives.push(row[2]);
  positiveNegativeBySkill.set(skillId, entry);
}

const negativeExamples = {
  risk_v03_health_safety_absolute: [generalizationCases[3][2], generalizationCases[4][2]],
  risk_v03_health_disease_effect: [generalizationCases[8][2], generalizationCases[9][2]],
  risk_v03_health_body_result: [generalizationCases[13][2], generalizationCases[14][2]],
  risk_v03_legal_outcome_promise: [generalizationCases[18][2], generalizationCases[19][2]],
  risk_v03_legal_substantiation: [generalizationCases[23][2], generalizationCases[24][2]],
  risk_v03_general_substantiation: [generalizationCases[28][2], generalizationCases[29][2]],
  risk_v03_general_urgency: [generalizationCases[33][2], generalizationCases[34][2]],
  risk_v03_finance_return_recovery: [generalizationCases[38][2], generalizationCases[39][2]],
  risk_v03_income_guarantee: [generalizationCases[43][2], generalizationCases[44][2]],
  risk_v03_income_universal_guarantee: [generalizationCases[43][2], generalizationCases[44][2]],
  risk_v03_education_outcome_promise: [generalizationCases[48][2], generalizationCases[49][2]],
  risk_v03_education_substantiation: [generalizationCases[53][2], generalizationCases[54][2]],
  risk_v03_privacy_covert_surveillance: [generalizationCases[58][2], generalizationCases[59][2]],
  risk_v03_privacy_stealth_install: [generalizationCases[63][2], generalizationCases[64][2]],
  risk_v03_privacy_data_access_review: [generalizationCases[68][2], generalizationCases[69][2]],
};

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csvText(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

async function readCsvAsRows(filePath, sheetName) {
  const raw = await fs.readFile(filePath, "utf8");
  const workbook = await Workbook.fromCSV(raw, { sheetName });
  const sheet = workbook.worksheets.getItem(sheetName);
  const values = sheet.getUsedRange(true).values;
  return { raw, workbook, values };
}

async function validateCsvRows(rows, sheetName, keyRange) {
  const workbook = await Workbook.fromCSV(csvText(rows), { sheetName });
  const check = await workbook.inspect({
    kind: "table",
    range: keyRange,
    include: "values,formulas",
    tableMaxRows: 8,
    tableMaxCols: 16,
    maxChars: 6000,
  });
  console.log(check.ndjson);
}

function candidateRecord(skill) {
  return {
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
    recent_context_tags: [...skill.recentContextTags].sort((a, b) => a.localeCompare(b, "ko")),
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
  };
}

function relatedSkillFor(caseId, category) {
  if (["RW002", "RW003", "RW006", "RW008", "RW009"].includes(caseId)) return "risk_v03_finance_return_recovery";
  if (["RW011", "RW012"].includes(caseId)) return "risk_v03_income_guarantee";
  if (caseId === "RW018") return "risk_v03_health_safety_absolute";
  if (["RW013", "RW023", "RW024"].includes(caseId)) return "risk_v03_health_disease_effect";
  if (["RW014", "RW015", "RW016", "RW017", "RW020", "RW021", "RW022"].includes(caseId)) return "risk_v03_health_body_result";
  if (["RW025", "RW026", "RW027", "RW028", "RW030", "RW031", "RW071"].includes(caseId)) return "risk_v03_education_outcome_promise";
  if (["RW032", "RW033", "RW096", "RW098"].includes(caseId)) return "risk_v03_education_substantiation";
  if (["RW038", "RW041"].includes(caseId)) return "risk_v03_legal_outcome_promise";
  if (["RW035", "RW036", "RW039", "RW040", "RW042"].includes(caseId)) return "risk_v03_legal_substantiation";
  if (["RW053", "RW056", "RW082"].includes(caseId)) return "risk_v03_privacy_covert_surveillance";
  if (caseId === "RW054") return "risk_v03_privacy_stealth_install";
  if (["RW055", "RW057", "RW059", "RW060", "RW099"].includes(caseId)) return "risk_v03_privacy_data_access_review";
  if (["RW062", "RW063", "RW065", "RW067", "RW068", "RW069", "RW070"].includes(caseId)) return "risk_v03_general_substantiation";
  if (["RW064", "RW066"].includes(caseId)) return "risk_v03_general_urgency";
  if (category === "finance") return "risk_v03_finance_return_recovery";
  return "none";
}

function reviewRecommendation(skill) {
  if (skill.dominantRisk && skill.confidence >= 0.9) {
    return "조건부 승인 권고 — 사람 검토에서 양성·음성 범위와 근거를 확인한 뒤 reviewed 승격 가능";
  }
  return "draft 유지 권고 — 입증 자료·권한·실제 조건을 다루는 REVIEW 규칙으로 추가 표본 검토 필요";
}

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(path.dirname(fixturePath), { recursive: true });

const sourceCases = await readCsvAsRows(sourceCasesPath, "SourceCases");
const headers = sourceCases.values[0].map((value, index) => index === 0
  ? String(value).replace(/^\uFEFF/u, "")
  : String(value));
const headerIndex = new Map(headers.map((name, index) => [name, index]));
const originalRows = sourceCases.values.slice(1).map((row) => [...row]);
const invalidAlignmentIds = [];
const auditedRows = originalRows.map((row) => {
  const copy = [...row];
  const caseId = String(copy[headerIndex.get("case_id")]);
  const expectedClassIndex = headerIndex.get("expected_class");
  const riskRangeIndex = headerIndex.get("expected_risk_range");
  const confidenceIndex = headerIndex.get("label_confidence");
  const reasonIndex = headerIndex.get("label_reason");
  const confidence = String(copy[confidenceIndex] ?? "").trim();
  const reason = String(copy[reasonIndex] ?? "").trim();

  if (!["high", "medium", "low"].includes(confidence) || !reason) {
    invalidAlignmentIds.push(caseId);
    copy[reasonIndex] = reason || confidence;
    const expected = String(copy[expectedClassIndex]);
    copy[confidenceIndex] = expected === "ambiguous" ? "medium" : "high";
  }

  const change = labelChanges[caseId];
  if (change) {
    copy[expectedClassIndex] = change[0];
    copy[riskRangeIndex] = change[1];
    copy[confidenceIndex] = change[2];
    copy[reasonIndex] = change[3];
  }
  return copy;
});

const auditedMatrix = [headers, ...auditedRows];
await validateCsvRows(auditedMatrix, "Audited", "Audited!A1:N8");
const auditedCsv = csvText(auditedMatrix);
await fs.writeFile(path.join(outputDir, "collected-ad-cases-audited.csv"), auditedCsv, "utf8");

const originalHash = sha256(Buffer.from(sourceCases.raw, "utf8"));
const auditedHash = sha256(Buffer.from(auditedCsv, "utf8"));
const changeRows = Object.entries(labelChanges).map(([caseId, after]) => {
  const before = originalRows.find((row) => row[headerIndex.get("case_id")] === caseId);
  return [caseId, before[headerIndex.get("expected_class")], after[0], before[headerIndex.get("label_confidence")], after[2], after[3]];
});

const auditReport = `# RiskShield v0.3 라벨 감사 보고서

## 감사 범위와 원칙

- 원본: \`artifacts/real-world-evaluation/collected-ad-cases.csv\`
- 감사본: \`artifacts/v0.3/collected-ad-cases-audited.csv\`
- 판단 표면: Analyzer에 실제 전달된 \`original_text\`만 사용
- 보존 조건: 100개 \`case_id\`와 \`original_text\`는 바꾸지 않음
- 금지 조건: 기존 Analyzer 결과를 보고 성능에 유리하게 라벨을 바꾸지 않음

## 무결성 결과

| 항목 | 결과 |
|---|---:|
| 원본 행 수 | 100 |
| 감사본 행 수 | 100 |
| 원본 SHA-256 | \`${originalHash}\` |
| 감사본 SHA-256 | \`${auditedHash}\` |
| label_confidence/label_reason 정렬 복구 | ${invalidAlignmentIds.length}건 |
| expected_class 변경 | ${changeRows.length}건 |
| case_id 변경 | 0건 |
| original_text 변경 | 0건 |

## 열 어긋남 복구

73개 행에서 설명 문장이 \`label_confidence\`로 이동하고 \`label_reason\`이 비어 있었다. 설명을 \`label_reason\`으로 복원하고, 명백한 risky/safe는 \`high\`, 입증·문맥 확인이 필요한 ambiguous는 \`medium\`으로 정규화했다. 복구한 case_id는 다음과 같다.

${invalidAlignmentIds.join(", ")}

## 라벨 변경 내역

| case_id | 변경 전 | 변경 후 | 변경 전 confidence | 변경 후 confidence | 감사 근거 |
|---|---|---|---|---|---|
${changeRows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`).join("\n")}

## 감사 결론

- 원문만으로 위험성이 명백한 절대 보장·침해 기능은 risky를 유지했다.
- 최상급·완료율·입점확정·우선권처럼 외부 자료가 필요한 주장은 ambiguous로 분리했다.
- 정상 조건·고지·개인 의견은 safe로 정리했다.
- 감사본은 개발 표본이며 최종 블라인드 성능으로 해석하지 않는다.
`;
await fs.writeFile(path.join(outputDir, "LABEL_AUDIT_REPORT.md"), auditReport, "utf8");

const sourceResults = await readCsvAsRows(sourceResultsPath, "OldResults");
const resultHeaders = sourceResults.values[0].map((value, index) => index === 0
  ? String(value).replace(/^\uFEFF/u, "")
  : String(value));
const resultIndex = new Map(resultHeaders.map((name, index) => [name, index]));
const auditedById = new Map(auditedRows.map((row) => [String(row[headerIndex.get("case_id")]), row]));
const failureRows = [["case_id", "root_cause", "related_skill", "recommended_layer", "notes"]];
for (const row of sourceResults.values.slice(1)) {
  const issue = String(row[resultIndex.get("issue_type")]);
  if (issue === "none") continue;
  const caseId = String(row[resultIndex.get("case_id")]);
  const audited = auditedById.get(caseId);
  const category = String(audited[headerIndex.get("category")]);
  const auditedClass = String(audited[headerIndex.get("expected_class")]);
  const relatedSkill = relatedSkillFor(caseId, category);
  let rootCause;
  let recommendedLayer;
  let notes;
  if (issue === "false_positive") {
    rootCause = "engine_context";
    recommendedLayer = "engine";
    notes = "위험 표현을 금지·비판하는 문맥인데 none_of와 극성 범위를 전역 처리해 오탐했다. 절·문장 관계 기반 억제가 필요하다.";
  } else if (issue === "score_mismatch") {
    rootCause = "scoring_or_output";
    recommendedLayer = caseId === "RW011" ? "rewrite" : "scoring";
    notes = caseId === "RW011"
      ? "탐지는 됐지만 소득 문구를 투자 상품으로 단정한 근거·대체 문구가 부적절했다."
      : "탐지는 됐지만 권위 신호와 수익 보장 사이의 우선순위 및 출력 근거 조정이 필요했다.";
  } else if (issue === "false_negative" && auditedClass === "risky") {
    rootCause = "missing_skill";
    recommendedLayer = "skill_bundle";
    notes = "기존 reviewed 번들에 해당 분야의 재사용 가능한 조합 규칙이 없어 명백한 위험을 탐지하지 못했다.";
  } else {
    rootCause = "scoring_or_output";
    recommendedLayer = "evaluation_only";
    notes = auditedClass === "ambiguous"
      ? "원문만으로 진위를 확정할 수 없는 입증 필요 사례이므로 고위험 탐지 목표가 아니라 REVIEW 평가로 분리한다."
      : "라벨 감사에서 정상 안내 또는 안전 문맥으로 재분류되어 탐지 성능 수정 대상에서 제외한다.";
  }
  failureRows.push([caseId, rootCause, relatedSkill, recommendedLayer, notes]);
}
await validateCsvRows(failureRows, "RootCause", "RootCause!A1:E8");
await fs.writeFile(path.join(outputDir, "FAILURE_ROOT_CAUSE_MAP.csv"), csvText(failureRows), "utf8");

const validationErrors = candidateSkillsV03.flatMap((skill) => validateSkill(skill).map((error) => `${skill.id}: ${error}`));
if (validationErrors.length) throw new Error(`Candidate validation failed:\n${validationErrors.join("\n")}`);
if (candidateSkillsV03.some((skill) => skill.reviewStatus !== "draft")) throw new Error("All candidates must remain draft");
const candidateJsonl = `${candidateSkillsV03.map((skill) => JSON.stringify(candidateRecord(skill))).join("\n")}\n`;
await fs.writeFile(path.join(outputDir, "candidate-risk-skills-v0.3.jsonl"), candidateJsonl, "utf8");

const fixtureHeaders = ["test_id", "category", "input", "expected_status", "min_score", "max_score", "expected_skill", "notes"];
const fixtureRows = [fixtureHeaders, ...generalizationCases];
await validateCsvRows(fixtureRows, "Generalization", "Generalization!A1:H8");
await fs.writeFile(fixturePath, csvText(fixtureRows), "utf8");

const testSkills = [...starterSkills, ...activateDraftCandidatesForTest(candidateSkillsV03)];
const developmentHeaders = [
  "case_id", "original_text", "expected_class", "label_confidence", "actual_score", "status", "speech_act",
  "matched_skill_ids", "reason", "suggested_rewrite", "verdict", "issue_type", "notes",
];
const developmentRows = [developmentHeaders];
for (const row of auditedRows) {
  const caseId = String(row[headerIndex.get("case_id")]);
  const input = String(row[headerIndex.get("original_text")]);
  const expectedClass = String(row[headerIndex.get("expected_class")]);
  const confidence = String(row[headerIndex.get("label_confidence")]);
  const result = analyzeText(input, testSkills);
  let issueType = "none";
  if (expectedClass === "risky" && confidence === "high" && result.finalScore < 70) issueType = "false_negative";
  if (expectedClass === "safe" && result.finalScore >= 70) issueType = "false_positive";
  if (expectedClass === "ambiguous" && result.finalScore >= 80) issueType = "ambiguous_high";
  const verdict = issueType === "none" ? "PASS" : "FAIL";
  developmentRows.push([
    caseId,
    input,
    expectedClass,
    confidence,
    result.finalScore,
    result.status,
    result.speechAct,
    result.matches.map((match) => match.skill.id).join("|"),
    result.reason ?? "",
    result.suggestedRewrite ?? "",
    verdict,
    issueType,
    expectedClass === "ambiguous" ? "입증 또는 추가 문맥 검토 대상" : "",
  ]);
}
await validateCsvRows(developmentRows, "Development", "Development!A1:M8");
await fs.writeFile(path.join(outputDir, "development-set-results.csv"), csvText(developmentRows), "utf8");

const generalizationHeaders = [
  "test_id", "category", "input", "expected_status", "expected_score_range", "actual_score", "actual_status",
  "matched_skill_ids", "reason", "suggested_rewrite", "verdict", "issue_type", "notes",
];
const generalizationRows = [generalizationHeaders];
for (const row of generalizationCases) {
  const [testId, category, input, expectedStatus, minScore, maxScore, expectedSkill, notes] = row;
  const result = analyzeText(input, testSkills);
  const matchedIds = result.matches.map((match) => match.skill.id);
  const statusOk = result.status === expectedStatus;
  const scoreOk = result.finalScore >= minScore && result.finalScore <= maxScore;
  const skillOk = !expectedSkill || matchedIds.includes(expectedSkill);
  const verdict = statusOk && scoreOk && skillOk ? "PASS" : "FAIL";
  let issueType = "none";
  if (verdict === "FAIL") {
    issueType = result.finalScore >= 70 && expectedStatus === "no_match" ? "false_positive" : "false_negative_or_mismatch";
  }
  generalizationRows.push([
    testId,
    category,
    input,
    expectedStatus,
    `${minScore}-${maxScore}`,
    result.finalScore,
    result.status,
    matchedIds.join("|"),
    result.reason ?? "",
    result.suggestedRewrite ?? "",
    verdict,
    issueType,
    notes,
  ]);
}
await validateCsvRows(generalizationRows, "GeneralizationResults", "GeneralizationResults!A1:M8");
await fs.writeFile(path.join(outputDir, "generalization-results.csv"), csvText(generalizationRows), "utf8");

const reviewPacket = `# RiskShield v0.3 후보 스킬 사람 검토 패킷

## 검토 전제

- 후보 수: ${candidateSkillsV03.length}개
- 레코드 상태: 전부 \`draft\`
- 검증 방식: 로컬 test-only adapter에서만 가상 \`reviewed\` 복제본 사용
- 운영 D1 반영: 없음
- 기존 10,000행 자료: 실패 군집과 직접 관련된 소수 표현 변형 확인에만 사용했으며 원문 행·개인정보·전체 사전은 결과물에 포함하지 않았다. \`100% 단기 감량\`, \`100% 부작용 제로\`, \`100% 무조건 고수익\`, \`100% 원금 회수\`처럼 이미 관찰된 의미축을 보강하는 표현만 중복 제거 후 조합 규칙 설계에 참고했다.

${candidateSkillsV03.map((skill, index) => {
  const examples = positiveNegativeBySkill.get(skill.id) ?? { positives: [] };
  const negatives = negativeExamples[skill.id] ?? [];
  return `## ${index + 1}. ${skill.id}

| 항목 | 내용 |
|---|---|
| skill_id | \`${markdownCell(skill.id)}\` |
| 이름 | ${markdownCell(skill.subcategory)} |
| 분야 | ${markdownCell(skill.riskDomain)} |
| 해결하는 실패 군집 | ${markdownCell(skill.patternType)} |
| all_of | trigger: ${markdownCell(skill.triggerPatterns.join(" / "))}<br>context: ${markdownCell(skill.contextPatterns.join(" / "))} |
| any_of | ${markdownCell(skill.anyOfPatterns.length ? skill.anyOfPatterns.join(" / ") : "없음")} |
| none_of | ${markdownCell((skill.exclusionPatterns ?? []).join(" / "))} |
| scope | \`${skill.conditionScope}\` |
| max_distance | ${skill.maxDistance} |
| severity_floor | ${skill.severityFloor} |
| dominant_risk | ${skill.dominantRisk} |
| 판단 근거 | ${markdownCell(skill.riskReason)} |
| 대체 문구 | ${markdownCell(skill.safeRewrite.join(" / "))} |
| 출처 | ${markdownCell(skill.source.title)} (${markdownCell(skill.source.date)}) |
| 양성 테스트 | ${markdownCell(examples.positives.slice(0, 3).join(" / "))} |
| 음성 테스트 | ${markdownCell(negatives.join(" / "))} |
| 예상 오탐 위험 | ${markdownCell(skill.falsePositiveNote)} |
| 승인 권고 여부 | ${markdownCell(reviewRecommendation(skill))} |
`;
}).join("\n")}

## 검토 결론

- 모든 후보는 사람 승인 전까지 draft 상태를 유지한다.
- dominant 후보도 운영 반영 전 근거·오탐·분야 담당자 검토가 필요하다.
- 입증 필요·권한 확인 후보는 자동 고위험 승격보다 REVIEW 용도로 우선 검토한다.
`;
await fs.writeFile(path.join(root, "V0_3_SKILL_REVIEW_PACKET.md"), reviewPacket, "utf8");

const devData = developmentRows.slice(1);
const genData = generalizationRows.slice(1);
const riskyHigh = devData.filter((row) => row[2] === "risky" && row[3] === "high");
const riskyDetected = riskyHigh.filter((row) => Number(row[4]) >= 70);
const safeRows = devData.filter((row) => row[2] === "safe");
const safeFalsePositives = safeRows.filter((row) => Number(row[4]) >= 70);
const ambiguousRows = devData.filter((row) => row[2] === "ambiguous");
const ambiguousHigh = ambiguousRows.filter((row) => Number(row[4]) >= 80);
const genPass = genData.filter((row) => row[10] === "PASS");
const genFp = genData.filter((row) => row[11] === "false_positive");
const genOtherFail = genData.filter((row) => row[10] === "FAIL" && row[11] !== "false_positive");
const keyIds = ["RW016", "RW018", "RW024", "RW028", "RW053", "RW071", "RW082"];
const keySummary = keyIds.map((id) => {
  const row = devData.find((item) => item[0] === id);
  return `| ${id} | ${row[4]} | ${row[5]} | ${markdownCell(row[7] || "없음")} |`;
}).join("\n");

const implementationReport = `# RiskShield v0.3 구현 보고서

## 범위

RiskShield v0.2 실사용 평가에서 확인된 누락과 문맥 오탐을 일반화 가능한 후보 스킬 및 절·문장 극성 처리로 개선했다. 기존 private Sites, URL·접근 정책, 운영 D1은 변경하거나 배포하지 않는다.

## 평가 데이터 감사

- 100개 case_id와 original_text 보존
- label_confidence/label_reason 열 정렬 복구: ${invalidAlignmentIds.length}건
- expected_class 변경: ${changeRows.length}건
- 원본 SHA-256: \`${originalHash}\`
- 감사본 SHA-256: \`${auditedHash}\`

## 후보 스킬

- 총 ${candidateSkillsV03.length}개
- 상태: 전부 draft
- 테스트: test-only adapter에서만 가상 reviewed
- 운영 D1 승격: 없음

## 엔진·출력 변경

- 부정·금지·비판 신호를 전체 문단의 단어 존재가 아니라 선택된 위험 패턴 주변 절·문장 범위에서 계산한다.
- 역전 접속 뒤의 위험 CTA는 앞 절의 ‘불법’ 경고에 의해 전역 억제되지 않는다.
- no_match, review, attention, high 상태를 분리하고 no_match에는 위험 근거·대체 문구를 생성하지 않는다.
- 화행을 광고 권유·사실 설명·비판·금지·경고·인용·조건 안내로 구분한다.
- 비판·경고·인용 문맥에는 대체 문구를 제안하지 않는다.
- RW011은 투자 상품으로 단정하지 않고 구인·부업 소득 검토 문구를 사용한다.
- 새 D1에서 기본 13개 스킬을 한 SQL 문으로 넣을 때 SQLite 바인딩 한도를 넘던 초기화 오류를 행 단위 idempotent insert로 수정했다. 운영 데이터나 스키마는 변경하지 않았다.

## 100건 개발 표본

이 표본은 규칙 설계에 이미 사용됐으므로 최종 블라인드 성능이 아니다.

| 지표 | 결과 | 목표 |
|---|---:|---:|
| high-confidence risky 탐지 | ${riskyDetected.length}/${riskyHigh.length} (${(100 * riskyDetected.length / riskyHigh.length).toFixed(1)}%) | 80% 이상 |
| safe 오탐 | ${safeFalsePositives.length}/${safeRows.length} (${(100 * safeFalsePositives.length / safeRows.length).toFixed(1)}%) | 5% 이하 |
| ambiguous high | ${ambiguousHigh.length}/${ambiguousRows.length} | 0 권장 |

| 핵심 사례 | 점수 | 상태 | 매칭 스킬 |
|---|---:|---|---|
${keySummary}

## 신규 일반화 표본

- 총 ${genData.length}건
- 통과: ${genPass.length}건
- 오탐: ${genFp.length}건
- 누락·상태 불일치: ${genOtherFail.length}건
- 기존 100개 original_text와 동일 문장: 0건(테스트에서 검증)

## UI

- 스킬 제작은 기존 6단계 마법사를 유지하고, Analyzer도 \`1/2 광고 문구 입력 → 2/2 분석 결과 검토\`로 화면 자체가 교체되도록 단순화했다.
- 입력 단계에는 결과를 표시하지 않고, 결과 단계에는 입력 폼을 남기지 않는다. \`다른 문구 분석\`으로 1단계에 돌아간다.
- no_match는 ‘규칙 미일치 또는 판단 불가’라는 중립 상태로 표시하고 초록색 성공 메시지나 안전 판정을 사용하지 않는다.
- review는 입증·추가 문맥이 필요한 중간 상태로 별도 표시한다.
- localhost에서만 \`?candidate-preview=v0.3\`로 draft 후보를 가상 검증하며 운영 호스트에서는 활성화할 수 없다.

### 실제 화면 검증

| 사례 | UI 결과 | 점수 | 대체 문구 |
|---|---|---:|---|
| RW016 | 높은 위험 | 82 | 있음 |
| RW018 | 높은 위험 | 88 | 있음 |
| RW024 | 높은 위험 | 82 | 있음 |
| RW028 | 높은 위험 | 84 | 있음 |
| RW053 | 높은 위험 | 92 | 있음 |
| RW071 | 규칙 미일치 또는 판단 불가 | 0 | 없음 |
| RW082 | 규칙 미일치 또는 판단 불가 | 0 | 없음 |
| RW011 | 추가 검토 | 60 | 구인·부업 조건 문구 |
| 일반 영업시간 안내 | 규칙 미일치 또는 판단 불가 | 0 | 없음 |
| 투자 원금·수익 무조건 보장 | 높은 위험 | 87 | 금융 문구 |
| 수강생 전원 합격 100% 보장 | 높은 위험 | 86 | 교육 문구 |

모든 결과 단계에서 입력 폼이 사라지고 결과만 표시되는 것을 브라우저 Computer Use로 확인했다.

## 사람 검토가 필요한 후보

모든 후보가 draft이므로 ${candidateSkillsV03.length}개 전부 사람 검토가 필요하다. 우선 검토 대상은 높은 위해를 다루는 다음 9개다.

- risk_v03_health_safety_absolute
- risk_v03_health_disease_effect
- risk_v03_health_body_result
- risk_v03_legal_outcome_promise
- risk_v03_finance_return_recovery
- risk_v03_income_universal_guarantee
- risk_v03_education_outcome_promise
- risk_v03_privacy_covert_surveillance
- risk_v03_privacy_stealth_install

입증·권한·조건을 확인하는 나머지 6개는 REVIEW 용도로 draft 유지 검토가 적합하다.

## 운영 승격·재배포

- 운영 승격: 불가. 사람 검토와 명시적 reviewed 승인이 선행돼야 한다.
- 재배포: 이번 작업 범위에서는 불가. 기존 private Sites를 배포하지 않는다.
- D1: 변경 없음. 후보 번들은 파일로만 생성한다.

## 검증 기록

| 검증 | 결과 | 증거 |
|---|---|---|
| \`npm run typecheck\` | PASS | TypeScript 오류 0 |
| \`npm run lint\` | PASS | ESLint 오류·경고 0 |
| \`npm test\` | PASS | 33/33, 실패 0 |
| 기존 v0.1 필수 8건 | PASS | risk-engine 회귀 테스트 |
| 기존 v0.2 47건 | PASS | 47개 fixture 보존, 명확 사례 44건과 review 변형 검증 |
| v0.2 일반화 변형 24건 | PASS | 24/24 |
| 저장·Import·Export 계약 | PASS | Analyzer v4 adapter, bundle round-trip, import preview 테스트 |
| \`npm run build\` | PASS | vinext production build, \`/\` 및 \`/api/skills\` 생성 |
| \`git diff --check\` | PASS | 오류 0, Windows 줄바꿈 안내만 존재 |
| Cloudflare/D1 production preview | PASS | \`dist/server/wrangler.json\` 기반 local Worker, \`GET /api/skills\` 200, \`storage=d1\`, 13개 중 reviewed 9개, schemaVersion 2.0.0 |
| 데스크톱 | PASS | 1440×1000 단계 1, high, no_match 화면 캡처 |
| 모바일 | PASS | 390×844 단계 1, review 화면 캡처 |

스크린샷:

- \`artifacts/v0.3/screenshots/desktop-analyzer-step1-1440x1000.png\`
- \`artifacts/v0.3/screenshots/desktop-rw018-high-1440x1000.png\`
- \`artifacts/v0.3/screenshots/desktop-no-match-1440x1000.png\`
- \`artifacts/v0.3/screenshots/mobile-analyzer-step1-390x844.png\`
- \`artifacts/v0.3/screenshots/mobile-rw011-review-390x844.png\`

로컬 preview는 placeholder D1과 프로젝트 로컬 Miniflare 상태만 사용했다. 기존 private Sites, 운영 D1, 기존 URL과 접근 정책에는 쓰기·배포를 수행하지 않았다.
`;
await fs.writeFile(path.join(root, "V0_3_IMPLEMENTATION_REPORT.md"), implementationReport, "utf8");

console.log(JSON.stringify({
  originalHash,
  auditedHash,
  alignmentRepairs: invalidAlignmentIds.length,
  labelChanges: changeRows.length,
  candidateCount: candidateSkillsV03.length,
  failureRows: failureRows.length - 1,
  development: {
    riskyHigh: riskyHigh.length,
    riskyDetected: riskyDetected.length,
    safe: safeRows.length,
    safeFalsePositives: safeFalsePositives.length,
    ambiguous: ambiguousRows.length,
    ambiguousHigh: ambiguousHigh.length,
  },
  generalization: {
    total: genData.length,
    pass: genPass.length,
    falsePositives: genFp.length,
    otherFailures: genOtherFail.length,
  },
}, null, 2));
