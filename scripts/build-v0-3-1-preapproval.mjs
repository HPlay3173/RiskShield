import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCsv,
  validateSkill,
// @ts-expect-error Node strips TypeScript at runtime.
} from "../lib/riskshield.ts";
import {
  candidateSkillsV031,
// @ts-expect-error Node strips TypeScript at runtime.
} from "../lib/v0-3-1-candidate-skills.ts";

const { Workbook } = await import(process.env.ARTIFACT_TOOL_MODULE ?? "@oai/artifact-tool");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "artifacts", "v0.3");
const blindPath = path.join(outputDir, "preapproval-blind-cases.csv");
const jsonlPath = path.join(outputDir, "candidate-risk-skills-v0.3.1.jsonl");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvText(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
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

const blindCases = [
  ["PB001", "health", "부작용이 조금도 없는 완전 안전한 시술입니다.", "risky", "high", "부작용 부재와 절대 안전을 함께 보장한다.", "health_safety"],
  ["PB002", "health", "이 건강식품은 위해가 전혀 없고 100% 안전합니다.", "risky", "high", "위해 가능성을 절대적으로 부정한다.", "health_safety"],
  ["PB003", "health", "이 치료는 부작용 제로라고 자신 있게 보장합니다.", "risky", "high", "부작용 제로를 보장한다.", "health_safety"],
  ["PB004", "health", "이 제품은 당뇨를 무조건 개선합니다.", "risky", "high", "질환 개선을 무조건 단정한다.", "health_disease"],
  ["PB005", "health", "관절염 통증을 확실하게 완화하는 효능을 보장합니다.", "risky", "high", "통증 완화를 확정·보장한다.", "health_disease"],
  ["PB006", "health", "모든 환자의 변비를 완전히 개선합니다.", "risky", "high", "모든 환자에 대한 과도한 적용 범위를 단정한다.", "health_disease"],
  ["PB007", "health", "이 한 병이면 위암을 완치합니다.", "risky", "high", "식품·제품으로 암 완치를 단정한다.", "health_disease"],
  ["PB008", "health", "일주일 다이어트로 6kg 감량합니다.", "risky", "high", "짧은 기간의 정량 감량 결과를 제시한다.", "health_body"],
  ["PB009", "health", "체중 8kg을 반드시 줄여 드립니다.", "risky", "high", "체중 결과와 확정 신호가 결합한다.", "health_body"],
  ["PB010", "health", "한 달 만에 체지방 5kg 감량을 책임집니다.", "risky", "high", "기간·정량 신체 결과를 책임진다.", "health_body"],
  ["PB011", "legal", "이 소송은 무조건 승소하도록 보장해 드립니다.", "risky", "high", "승소 결과를 무조건 보장한다.", "legal_outcome"],
  ["PB012", "legal", "형사 사건은 반드시 무죄가 나옵니다.", "risky", "high", "무죄 결과를 반드시 단정한다.", "legal_outcome"],
  ["PB013", "legal", "합의금 100% 수령 결과를 약속합니다.", "risky", "high", "합의금 결과를 100% 약속한다.", "legal_outcome"],
  ["PB014", "finance", "이 투자 상품은 원금을 무조건 보장합니다.", "risky", "high", "투자 원금의 손실 가능성을 제거한다.", "finance_recovery"],
  ["PB015", "finance", "손실이 나면 투자금 전액을 환불해 드립니다.", "risky", "high", "투자 손실의 전액 환불을 약속한다.", "finance_recovery"],
  ["PB016", "finance", "고수익만 드리고 원금은 보전됩니다.", "risky", "high", "수익과 원금 보전을 확정한다.", "finance_recovery"],
  ["PB017", "income", "이 재택 부업은 누구나 월수입을 얻습니다.", "risky", "high", "성과형 수입을 누구나 얻는다고 단정한다.", "income_universal"],
  ["PB018", "income", "초보도 부업 소득을 무조건 보장받습니다.", "risky", "high", "부업 소득을 무조건 보장한다.", "income_universal"],
  ["PB019", "income", "재택 수입은 최소 금액을 보장합니다.", "risky", "high", "성과형 수입의 최소 보장을 약속한다.", "income_universal"],
  ["PB020", "education", "우리 수강생은 전원 취업합니다.", "risky", "high", "모든 수강생의 미래 취업 결과를 단정한다.", "education_outcome"],
  ["PB021", "education", "이번 과정은 합격을 반드시 보장합니다.", "risky", "high", "미래 합격 결과를 반드시 보장한다.", "education_outcome"],
  ["PB022", "education", "수료생 100% 취업을 보장합니다.", "risky", "high", "취업 결과를 100% 보장한다.", "education_outcome"],
  ["PB023", "education", "이 입시반은 무조건 진학을 약속합니다.", "risky", "high", "진학 결과를 무조건 약속한다.", "education_outcome"],
  ["PB024", "privacy", "배우자 몰래 GPS 위치를 추적합니다.", "risky", "high", "상대방 모르게 위치를 추적한다.", "privacy_covert"],
  ["PB025", "privacy", "상대가 모르게 메시지를 다시 볼 수 있습니다.", "risky", "high", "상대방 모르게 메시지를 열람한다.", "privacy_covert"],
  ["PB026", "privacy", "비동의 상태에서 마이크를 원격 녹음합니다.", "risky", "high", "동의 없이 마이크를 원격 녹음한다.", "privacy_covert"],
  ["PB027", "privacy", "직원 몰래 통화를 감청하는 기능입니다.", "risky", "high", "직원 통화를 몰래 감청한다.", "privacy_covert"],
  ["PB028", "privacy", "상대방 몰래 감시 앱을 설치합니다.", "risky", "high", "상대방 몰래 감시 앱을 설치한다.", "privacy_stealth"],
  ["PB029", "privacy", "추적 프로그램의 설치 사실을 숨깁니다.", "risky", "high", "추적 목적 프로그램의 설치 사실을 은폐한다.", "privacy_stealth"],
  ["PB030", "privacy", "원격 감시 앱을 대상자 휴대폰에 설치합니다.", "risky", "high", "대상자 기기에 원격 감시 앱을 설치한다.", "privacy_stealth"],

  ["PB031", "health", "부작용이 전혀 없다는 표현은 과장 광고이므로 비판합니다.", "safe", "high", "위험 표현을 비판한다.", "criticism"],
  ["PB032", "health", "당뇨를 무조건 개선한다고 광고해서는 안 됩니다.", "safe", "high", "질환 효능 보장 표현을 금지한다.", "prohibition"],
  ["PB033", "health", "지난 진료 기록에는 체중이 62kg으로 측정되었습니다.", "safe", "high", "과거 체중 측정 기록이다.", "past_record"],
  ["PB034", "health", "연구 보고서는 관절 통증 완화 가능성만 제한적으로 설명합니다.", "safe", "high", "근거와 한계를 밝힌 연구 설명이다.", "substantiated_fact"],
  ["PB035", "legal", "승소를 100% 보장한다는 광고는 허용되지 않습니다.", "safe", "high", "결과 보장 광고를 금지한다.", "prohibition"],
  ["PB036", "legal", "사실관계에 따라 합의금을 받을 수 있습니다.", "safe", "high", "가능성만 설명하고 결과를 보장하지 않는다.", "possibility"],
  ["PB037", "legal", "지난해 처리 사건 40건 중 28건이 조정으로 끝났다는 통계입니다.", "safe", "high", "출처가 있는 과거 실적 설명이다.", "past_statistic"],
  ["PB038", "legal", "무죄가 반드시 나온다는 문구는 소비자를 오도할 수 있습니다.", "safe", "high", "결과 단정을 비판한다.", "criticism"],
  ["PB039", "general", "공식 인증번호와 발급기관을 함께 표시했습니다.", "safe", "high", "검증 가능한 인증 사실이다.", "substantiated_fact"],
  ["PB040", "general", "접수 마감일은 9월 3일이며 남은 좌석은 매일 공개합니다.", "safe", "high", "근거가 명확한 일정·재고 안내다.", "schedule"],
  ["PB041", "general", "마지막 기회라는 근거 없는 광고를 사용하면 안 됩니다.", "safe", "high", "긴급성 광고를 금지한다.", "prohibition"],
  ["PB042", "general", "지난 분기 입점 완료 사실은 계약서 번호로 확인할 수 있습니다.", "safe", "high", "완료 사실과 근거를 제시한다.", "substantiated_fact"],
  ["PB043", "finance", "투자 원금은 보장되지 않으며 손실 가능성이 있습니다.", "safe", "high", "투자 위험을 명시한다.", "risk_disclosure"],
  ["PB044", "finance", "과거 수익률은 미래 수익을 보장하지 않습니다.", "safe", "high", "과거 실적의 한계를 명시한다.", "past_statistic"],
  ["PB045", "finance", "배송 중 손실된 상품은 결제 금액을 환불합니다.", "safe", "high", "투자가 아닌 정상 소비자 환불이다.", "other_meaning"],
  ["PB046", "income", "정규직 기본급은 세전 월 310만원입니다.", "safe", "high", "근로계약상 확정 급여 안내다.", "normal_salary"],
  ["PB047", "income", "연봉 4천만원이며 성과급은 실적에 따라 달라집니다.", "safe", "high", "고정 급여와 변동 성과급을 구분한다.", "normal_salary"],
  ["PB048", "income", "누구나 고수입을 보장한다는 부업 광고를 비판합니다.", "safe", "high", "소득 보장 광고를 비판한다.", "criticism"],
  ["PB049", "education", "지난해 합격자 80명이라는 통계의 출처를 공개합니다.", "safe", "high", "출처가 있는 과거 통계다.", "past_statistic"],
  ["PB050", "education", "전원 합격 보장 표현은 광고에 사용하지 않습니다.", "safe", "high", "미래 결과 보장을 금지한다.", "prohibition"],
  ["PB051", "education", "진학 목표에 맞춘 상담 일정을 안내합니다.", "safe", "high", "목표와 일정 안내일 뿐 결과 약속이 아니다.", "schedule"],
  ["PB052", "education", "최고 강사라는 광고의 비교 기준이 부족하다고 비판했습니다.", "safe", "high", "최상급 광고를 비판한다.", "criticism"],
  ["PB053", "privacy", "가족 모두의 동의를 받아 위치 공유를 켭니다.", "safe", "high", "동의 기반 위치 기능이다.", "consented_data"],
  ["PB054", "privacy", "몰래 통화를 감청하는 행위는 불법이며 금지됩니다.", "safe", "high", "감청 행위를 금지한다.", "prohibition"],
  ["PB055", "privacy", "보안 담당자와 합의한 뒤 관리용 앱을 설치합니다.", "safe", "high", "관리 권한과 동의가 있는 설치다.", "consented_data"],
  ["PB056", "privacy", "사용자가 직접 자기 사진 파일을 백업합니다.", "safe", "high", "본인 데이터의 정상 백업이다.", "consented_data"],
  ["PB057", "privacy", "접근성 설정에서 앱 아이콘 표시 여부를 사용자가 선택합니다.", "safe", "high", "사용자 설정에 따른 아이콘 표시다.", "icon_hiding"],
  ["PB058", "general", "살구색 표본을 제품 사진과 비교했습니다.", "safe", "high", "‘살’이 체중과 무관한 다른 의미다.", "other_meaning"],
  ["PB059", "general", "무죄라는 제목의 영화 상영 일정이 확정됐습니다.", "safe", "high", "법률 결과가 아닌 작품 제목과 일정이다.", "other_meaning"],
  ["PB060", "general", "수익률 계산 교육은 금요일에 진행합니다.", "safe", "high", "투자 보장이 아닌 교육 일정이다.", "schedule"],

  ["PB061", "health", "이 원료는 소화 개선에 도움을 줄 수 있습니다.", "ambiguous", "medium", "단순 효능 가능성으로 근거와 적용 범위 검토가 필요하다.", "simple_efficacy"],
  ["PB062", "health", "피로 완화 효능을 소개합니다.", "ambiguous", "medium", "확정성 없는 단순 효능 표현이다.", "simple_efficacy"],
  ["PB063", "health", "다음 달 목표 체중은 58kg입니다.", "ambiguous", "medium", "미래 목표 수치이며 결과 보장이 아니다.", "simple_amount"],
  ["PB064", "health", "어제 몸무게 기록은 71kg이었습니다.", "ambiguous", "medium", "과거 체중 기록이다.", "simple_amount"],
  ["PB065", "legal", "조건이 맞으면 합의금을 받을 수 있습니다.", "ambiguous", "medium", "법률 결과의 가능성 설명이다.", "possibility"],
  ["PB066", "legal", "절차가 끝나면 감형이 될 수 있습니다.", "ambiguous", "medium", "법률 결과의 가능성 설명이다.", "possibility"],
  ["PB067", "legal", "사건 처리 경험 120건을 소개합니다.", "ambiguous", "medium", "경력 사실의 입증 확인이 필요하다.", "substantiation"],
  ["PB068", "legal", "지역 1위 법률사무소라고 안내합니다.", "ambiguous", "medium", "최상급 비교 근거 확인이 필요하다.", "substantiation"],
  ["PB069", "general", "상가 입점이 확정됐다고 안내합니다.", "ambiguous", "medium", "계약 근거 확인이 필요한 상업 주장이다.", "substantiation"],
  ["PB070", "general", "전국 최고 분양률을 기록했다고 합니다.", "ambiguous", "medium", "비교 기준과 실적 근거 확인이 필요하다.", "substantiation"],
  ["PB071", "general", "이번 주까지만 신청할 수 있습니다.", "ambiguous", "medium", "실제 마감 근거 확인이 필요한 일정 주장이다.", "schedule_claim"],
  ["PB072", "general", "재고가 얼마 남지 않았으니 서둘러 구매하세요.", "ambiguous", "medium", "재고 근거 확인이 필요한 긴급성 주장이다.", "urgency_claim"],
  ["PB073", "income", "재택 부업의 월 예상 수입은 160만원입니다.", "ambiguous", "medium", "예상 성과형 수입의 산정 근거 확인이 필요하다.", "simple_amount"],
  ["PB074", "income", "지난 참여자의 평균 부업 소득은 월 90만원이었습니다.", "ambiguous", "medium", "과거 평균 수치의 모집단·산식 확인이 필요하다.", "past_statistic"],
  ["PB075", "income", "성과에 따라 월 수입이 최대 240만원입니다.", "ambiguous", "medium", "변동형 수입의 조건과 분포 확인이 필요하다.", "simple_amount"],
  ["PB076", "education", "지난 기수 합격률은 78%였습니다.", "ambiguous", "medium", "과거 통계의 산식과 출처 확인이 필요하다.", "past_statistic"],
  ["PB077", "education", "수강생 50명 중 32명이 취업했습니다.", "ambiguous", "medium", "과거 결과 통계일 수 있어 시점과 출처 확인이 필요하다.", "past_statistic"],
  ["PB078", "privacy", "앱 아이콘을 폴더 안에서 숨깁니다.", "ambiguous", "medium", "아이콘 숨김만으로 감시 목적을 단정할 수 없다.", "icon_hiding"],
  ["PB079", "privacy", "권한 안내 후 메시지 데이터를 내려받습니다.", "ambiguous", "medium", "데이터 접근 권한과 주체 확인이 필요하다.", "data_access"],
  ["PB080", "privacy", "사진 기록을 서버에 저장해 확인할 수 있습니다.", "ambiguous", "medium", "저장 주체·동의·보관 기간 확인이 필요하다.", "data_access"],
];

if (blindCases.length !== 80) throw new Error(`Expected 80 blind cases, got ${blindCases.length}`);
if (new Set(blindCases.map((row) => row[2])).size !== 80) throw new Error("Blind inputs must be unique");

const oldAudited = parseCsv(await fs.readFile(path.join(outputDir, "collected-ad-cases-audited.csv"), "utf8"));
const oldGeneralization = parseCsv(await fs.readFile(path.join(root, "tests", "fixtures", "analyzer-v0.3-generalization.csv"), "utf8"));
const auditedHeader = Object.fromEntries(oldAudited[0].map((header, index) => [header, index]));
const generalizationHeader = Object.fromEntries(oldGeneralization[0].map((header, index) => [header, index]));
const oldInputs = new Set([
  ...oldAudited.slice(1).map((row) => row[auditedHeader.original_text]),
  ...oldGeneralization.slice(1).map((row) => row[generalizationHeader.input]),
]);
const reusedInputs = blindCases.filter((row) => oldInputs.has(row[2])).map((row) => row[0]);
if (reusedInputs.length) throw new Error(`Blind cases reuse prior inputs: ${reusedInputs.join(", ")}`);

const validationErrors = candidateSkillsV031.flatMap((skill) =>
  validateSkill(skill).map((error) => `${skill.id}: ${error}`));
if (validationErrors.length) throw new Error(`Candidate validation failed:\n${validationErrors.join("\n")}`);
if (candidateSkillsV031.length !== 15) throw new Error("Expected 15 v0.3.1 candidates");
if (candidateSkillsV031.some((skill) => skill.reviewStatus !== "draft")) throw new Error("All v0.3.1 candidates must remain draft");
if (candidateSkillsV031.some((skill) => !/^https?:\/\//u.test(skill.source.url))) throw new Error("Every candidate needs an HTTP(S) source");

const candidateJsonl = `${candidateSkillsV031.map((skill) => JSON.stringify(candidateRecord(skill))).join("\n")}\n`;
await fs.writeFile(jsonlPath, candidateJsonl, "utf8");

const blindHeaders = ["case_id", "source_type", "category", "input", "expected_class", "label_confidence", "expected_reason", "control_tag", "label_frozen_at", "labeler_process"];
const blindRows = [blindHeaders, ...blindCases.map(([id, category, input, expectedClass, confidence, reason, tag]) => [
  id, "synthetic_generalization", category, input, expectedClass, confidence, reason, tag, "2026-07-18T13:00:00+09:00", "authoring-v0.3.1-pre-evaluation",
])];
const blindCsv = csvText(blindRows);
await fs.writeFile(blindPath, blindCsv, "utf8");

const workbook = await Workbook.fromCSV(blindCsv, { sheetName: "BlindCases" });
const check = await workbook.inspect({
  kind: "table",
  range: "BlindCases!A1:J81",
  include: "values,formulas",
  tableMaxRows: 6,
  tableMaxCols: 10,
  maxChars: 8000,
});
console.log(check.ndjson);
console.log(JSON.stringify({ candidates: candidateSkillsV031.length, blindCases: blindCases.length, jsonlPath, blindPath }));
