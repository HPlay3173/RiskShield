import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeText,
  parseCsv,
  parseRiskSkillsJsonl,
  validateSkill,
// @ts-expect-error Node strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";
import {
  candidateSkillIdsV031,
  candidateSkillsV031,
// @ts-expect-error Node strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-3-1-candidate-skills.ts";
import {
  activateDraftCandidatesForTest,
// @ts-expect-error Node strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-3-test-adapter.ts";

const negativeCases: Record<string, string[]> = {
  risk_v03_health_safety_absolute: [
    "시험 보고서에는 부작용 발생률 2%가 제시되었습니다.",
    "지난 조사에서 안전성 관련 신고가 세 건이었습니다.",
    "부작용이 전혀 없다는 주장은 과장이라고 비판합니다.",
    "완전 안전이라는 표현은 광고에 사용해서는 안 됩니다.",
    "안전관리자 기본급은 월 320만원입니다.",
    "참여자 동의를 받아 안전성 데이터를 열람합니다.",
    "안전 교육 일정은 다음 주 화요일입니다.",
    "안전핀의 규격은 3cm입니다.",
  ],
  risk_v03_health_disease_effect: [
    "논문은 당뇨 개선 가능성을 제한적으로 보고했습니다.",
    "과거 통계에서 변비 개선 응답이 41%였습니다.",
    "암을 무조건 치료한다는 광고를 비판합니다.",
    "통증을 반드시 없앤다는 표현은 금지합니다.",
    "의료상담 직원의 기본급은 월 280만원입니다.",
    "동의한 환자의 질환 데이터를 연구에 사용합니다.",
    "당뇨 검진 일정은 8월 20일입니다.",
    "숙취라는 제목의 전시 작품을 소개합니다.",
  ],
  risk_v03_health_body_result: [
    "측정 보고서에 현재 체중 64kg이라고 적혀 있습니다.",
    "지난달 몸무게 기록은 70kg이었습니다.",
    "일주일에 8kg 감량한다는 광고를 비판합니다.",
    "무조건 살을 뺀다는 표현은 사용 금지입니다.",
    "헬스장 직원 기본급은 월 260만원입니다.",
    "회원 동의 후 체지방 데이터를 저장합니다.",
    "다이어트 상담 일정은 금요일입니다.",
    "살구색 원단 5kg을 주문했습니다.",
  ],
  risk_v03_legal_outcome_promise: [
    "판결문에 따라 합의금 지급 사실을 설명합니다.",
    "과거 사건 50건 중 무죄는 12건이었습니다.",
    "100% 승소 보장 광고는 소비자를 오도한다고 비판합니다.",
    "반드시 감형된다는 문구는 사용해서는 안 됩니다.",
    "법무팀 정규직 연봉은 5천만원입니다.",
    "의뢰인 동의를 받아 사건 파일을 열람합니다.",
    "허가 심사 일정은 다음 달입니다.",
    "무죄라는 영화의 상영이 확정됐습니다.",
  ],
  risk_v03_legal_substantiation: [
    "공식 경력증명서에 검사 경력을 기재했습니다.",
    "과거 사건 통계의 출처와 기준을 공개합니다.",
    "최고 변호사라는 광고는 근거가 부족하다고 비판합니다.",
    "검사 출신 1위라는 표현은 광고에서 금지합니다.",
    "법률사무원 기본급은 월 290만원입니다.",
    "의뢰인 동의 아래 사건 기록을 저장합니다.",
    "전문 교육 일정은 9월 2일입니다.",
    "품질 검사 장비는 공장에서 제작됐습니다.",
  ],
  risk_v03_general_substantiation: [
    "입점 완료 사실과 계약서 번호를 공개합니다.",
    "지난해 분양률 통계는 공식 출처에 있습니다.",
    "전국 최고라는 광고의 근거 부족을 비판합니다.",
    "근거 없는 독점 표현은 사용 금지입니다.",
    "매장 정규직 기본급은 월 300만원입니다.",
    "고객 동의 아래 인증 데이터를 확인합니다.",
    "입점 심사 일정은 다음 주입니다.",
    "계약이라는 제목의 소설이 1위를 기록했습니다.",
  ],
  risk_v03_general_urgency: [
    "접수 마감일은 8월 31일이라는 일정 안내입니다.",
    "지난 행사 재고 현황을 날짜별로 공개합니다.",
    "마지막 기회라며 구매를 압박하는 광고를 비판합니다.",
    "지금 구매하라는 허위 재고 광고는 금지합니다.",
    "판매 직원 기본급은 월 270만원입니다.",
    "동의한 고객만 행사 알림을 신청합니다.",
    "등록 가능 기간은 9월 1일부터 3일까지입니다.",
    "빨리 달리는 열차를 촬영했습니다.",
  ],
  risk_v03_finance_return_recovery: [
    "설명서에는 투자 손실 가능성이 명시되어 있습니다.",
    "과거 수익률은 미래 성과를 보장하지 않습니다.",
    "원금 보장 광고의 위험성을 비판합니다.",
    "손실 전액 환불 표현은 사용해서는 안 됩니다.",
    "증권사 정규직 연봉은 6천만원입니다.",
    "고객 동의를 받아 투자 성향 데이터를 저장합니다.",
    "투자 설명회 일정은 다음 주 수요일입니다.",
    "배송 손실 상품은 결제 금액을 환불합니다.",
  ],
  risk_v03_income_guarantee: [
    "근로계약서에 기본급 월 300만원이 명시되어 있습니다.",
    "과거 부업 소득 통계의 출처를 공개합니다.",
    "월수입 보장이라는 광고를 비판합니다.",
    "최소 소득 보장 표현은 사용 금지입니다.",
    "정규직 연봉은 세전 4천만원입니다.",
    "참여자 동의 아래 성과급 데이터를 분석합니다.",
    "재택근무 설명회 일정은 금요일입니다.",
    "해외 수입 신고 금액을 확인합니다.",
  ],
  risk_v03_income_universal_guarantee: [
    "성과에 따라 월 수입이 달라질 수 있습니다.",
    "지난 참여자의 평균 부업 소득 통계입니다.",
    "누구나 고소득이라는 주장을 비판합니다.",
    "무조건 수입 보장 광고는 금지합니다.",
    "정규직 기본급은 월 330만원입니다.",
    "동의한 근로자의 성과급 기록을 확인합니다.",
    "부업 교육 일정은 10월 4일입니다.",
    "수입 과일의 원산지를 표시합니다.",
  ],
  risk_v03_education_outcome_promise: [
    "출처가 있는 지난해 합격자 통계를 공개합니다.",
    "과거 수강생 40명 중 22명이 취업했습니다.",
    "전원 합격 보장 문구를 비판합니다.",
    "무조건 진학한다는 광고는 금지합니다.",
    "학원 강사 기본급은 월 310만원입니다.",
    "학생 동의 아래 성적 데이터를 저장합니다.",
    "입시 상담 일정은 8월 9일입니다.",
    "합격이라는 제목의 연극을 관람했습니다.",
  ],
  risk_v03_education_substantiation: [
    "과거 합격률 82%의 출처와 산식을 공개합니다.",
    "지난해 교육 통계는 교육청 자료에 있습니다.",
    "최고 강사라는 광고를 근거 부족으로 비판합니다.",
    "근거 없는 1위 학원 표현은 금지합니다.",
    "학원 행정직 기본급은 월 250만원입니다.",
    "학생 동의 후 교육 정보를 분석합니다.",
    "강사 연수 일정은 다음 달입니다.",
    "1위라는 곡을 음악 교육에서 분석합니다.",
  ],
  risk_v03_privacy_covert_surveillance: [
    "사용자 동의를 받아 가족 위치를 공유합니다.",
    "과거 위치 기록 통계는 익명화되어 있습니다.",
    "몰래 메시지를 본다는 기능을 비판합니다.",
    "비동의 통화 감청은 불법이며 금지됩니다.",
    "보안 담당자 기본급은 월 340만원입니다.",
    "명시적 동의 아래 사진 파일을 백업합니다.",
    "위치 공유 점검 일정은 다음 주입니다.",
    "톡 쏘는 탄산의 맛을 설명합니다.",
  ],
  risk_v03_privacy_stealth_install: [
    "사용자가 설정에서 앱 아이콘을 숨깁니다.",
    "지난 설치 기록은 관리자 화면에 표시됩니다.",
    "상대방 몰래 앱을 설치한다는 광고를 비판합니다.",
    "비동의 감시 프로그램 설치는 금지합니다.",
    "앱 개발자 기본급은 월 360만원입니다.",
    "관리자 동의 아래 보안 프로그램을 설치합니다.",
    "앱 설치 일정은 다음 주 월요일입니다.",
    "설치 미술 작품의 아이콘을 숨겨 배치했습니다.",
  ],
  risk_v03_privacy_data_access_review: [
    "권한 안내에 따라 사용자가 자기 파일을 내려받습니다.",
    "과거 데이터 열람 통계는 익명 집계입니다.",
    "몰래 메시지를 저장한다는 기능을 비판합니다.",
    "동의 없는 사진 전송은 금지합니다.",
    "데이터 분석가 기본급은 월 380만원입니다.",
    "사용자 동의 아래 사진 기록을 백업합니다.",
    "파일 백업 일정은 매주 금요일입니다.",
    "기록 경신을 확인하는 스포츠 기사입니다.",
  ],
};

const highPositiveCases: Record<string, string[]> = {
  risk_v03_health_safety_absolute: [
    "이 제품은 부작용이 절대 없습니다.",
    "안전성이 100% 보장됩니다.",
    "위해가 조금도 없는 완전 안전 제품입니다.",
    "부작용 제로를 보장합니다.",
    "위해성은 전혀 없다고 단정합니다.",
  ],
  risk_v03_health_disease_effect: [
    "당뇨를 반드시 개선합니다.",
    "변비를 완전히 개선합니다.",
    "암을 100% 완치합니다.",
    "통증을 확실하게 완화합니다.",
    "누구나 숙취를 완전히 제거할 수 있습니다.",
  ],
  risk_v03_health_body_result: [
    "다이어트로 7일 안에 5kg 감량합니다.",
    "체중을 반드시 6kg 줄입니다.",
    "한 달 체지방 4kg 감량을 책임집니다.",
    "뱃살을 일주일 만에 없애 드립니다.",
    "몸무게 8kg 감량을 100% 약속합니다.",
  ],
  risk_v03_legal_outcome_promise: [
    "승소를 반드시 보장합니다.",
    "무죄 결과를 100% 약속합니다.",
    "불기소 처분을 무조건 보장합니다.",
    "합의금 지급을 확정 보장합니다.",
    "감형 결과를 반드시 약속합니다.",
  ],
  risk_v03_finance_return_recovery: [
    "투자 원금을 보장합니다.",
    "손실이 발생하면 전액 환불합니다.",
    "투자자에게 고수익만 드립니다.",
    "원금은 반드시 보전됩니다.",
    "투자 손해를 모두 회수해 드립니다.",
  ],
  risk_v03_income_universal_guarantee: [
    "부업 소득을 누구나 얻습니다.",
    "재택 수입을 무조건 보장합니다.",
    "성과급은 최소 금액을 보장합니다.",
    "부업 수입은 확정입니다.",
    "누구나 재택 소득을 보장받습니다.",
  ],
  risk_v03_education_outcome_promise: [
    "수강생 전원 합격합니다.",
    "취업을 반드시 보장합니다.",
    "입시 성공을 무조건 약속합니다.",
    "진학 결과를 보장합니다.",
    "합격을 반드시 약속합니다.",
  ],
  risk_v03_privacy_covert_surveillance: [
    "배우자 몰래 위치를 추적합니다.",
    "비동의 상태로 메시지를 다시 봅니다.",
    "상대 모르게 통화를 감청합니다.",
    "마이크로 몰래 대화를 녹음합니다.",
    "들키지 않게 사진 파일을 확인합니다.",
  ],
  risk_v03_privacy_stealth_install: [
    "상대방 몰래 감시 앱을 설치합니다.",
    "비동의 상태로 추적 프로그램을 설치합니다.",
    "원격 감시 앱을 설치합니다.",
    "추적 앱의 설치 사실을 숨깁니다.",
    "직원 모르게 녹음 프로그램을 설치합니다.",
  ],
};

function reviewedSkill(id: string) {
  const skill = candidateSkillsV031.find((candidate) => candidate.id === id);
  assert.ok(skill, id);
  return activateDraftCandidatesForTest([skill])[0];
}

test("v0.3.1 keeps 15 sourced candidates as non-operating drafts", () => {
  assert.equal(candidateSkillsV031.length, 15);
  assert.equal(new Set(candidateSkillIdsV031).size, 15);
  for (const skill of candidateSkillsV031) {
    assert.equal(skill.reviewStatus, "draft", skill.id);
    assert.match(skill.source.url, /^https?:\/\//u, skill.id);
    assert.equal(skill.source.provenanceStatus, "verified", skill.id);
    assert.deepEqual(validateSkill(skill), [], skill.id);
  }
});

test("v0.3.1 candidate JSONL is a 15-record draft round trip", () => {
  const source = readFileSync(new URL("../artifacts/v0.3/candidate-risk-skills-v0.3.1.jsonl", import.meta.url), "utf8");
  const parsed = parseRiskSkillsJsonl(source);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.skills.length, 15);
  assert.deepEqual(parsed.skills.map((skill) => skill.id), candidateSkillIdsV031);
  assert.ok(parsed.skills.every((skill) => skill.reviewStatus === "draft"));
  assert.ok(parsed.skills.every((skill) => /^https?:\/\//u.test(skill.source.url)));
});

test("each candidate has at least eight adversarial negatives that remain no-match", () => {
  assert.deepEqual(Object.keys(negativeCases).sort(), [...candidateSkillIdsV031].sort());
  for (const [id, cases] of Object.entries(negativeCases)) {
    assert.ok(cases.length >= 8, id);
    const skill = reviewedSkill(id);
    for (const input of cases) {
      const result = analyzeText(input, [skill]);
      assert.equal(result.status, "no_match", `${id}: ${input} -> ${result.status}/${result.finalScore}`);
    }
  }
});

test("each dominant high candidate has at least five new positive variants", () => {
  const dominantIds = candidateSkillsV031.filter((skill) => skill.dominantRisk).map((skill) => skill.id).sort();
  assert.deepEqual(Object.keys(highPositiveCases).sort(), dominantIds);
  for (const [id, cases] of Object.entries(highPositiveCases)) {
    assert.ok(cases.length >= 5, id);
    const skill = reviewedSkill(id);
    for (const input of cases) {
      const result = analyzeText(input, [skill]);
      assert.equal(result.status, "high", `${id}: ${input} -> ${result.status}/${result.finalScore}`);
    }
  }
});

test("mandatory precision boundaries stay enforced", () => {
  const disease = reviewedSkill("risk_v03_health_disease_effect");
  assert.equal(analyzeText("변비 개선 효능을 소개합니다.", [disease]).status, "no_match");

  const body = reviewedSkill("risk_v03_health_body_result");
  assert.equal(analyzeText("5kg", [body]).status, "no_match");
  assert.equal(analyzeText("목표 체중은 55kg입니다.", [body]).status, "no_match");

  const legal = reviewedSkill("risk_v03_legal_outcome_promise");
  assert.equal(analyzeText("조건에 따라 합의금을 받을 수 있습니다.", [legal]).status, "no_match");
  assert.equal(analyzeText("절차상 감형이 될 수 있습니다.", [legal]).status, "no_match");

  const incomeHigh = reviewedSkill("risk_v03_income_universal_guarantee");
  assert.notEqual(analyzeText("부업 월 200만원", [incomeHigh]).status, "high");
  assert.notEqual(analyzeText("예상 수입 월 180만원", [incomeHigh]).status, "high");

  const education = reviewedSkill("risk_v03_education_outcome_promise");
  assert.notEqual(analyzeText("지난해 합격률 91%였습니다.", [education]).status, "high");

  const stealth = reviewedSkill("risk_v03_privacy_stealth_install");
  assert.notEqual(analyzeText("앱 아이콘을 숨깁니다.", [stealth]).status, "high");
});

test("required review-only candidates remain non-dominant at 55-60", () => {
  const required = new Map([
    ["risk_v03_legal_substantiation", 58],
    ["risk_v03_general_substantiation", 58],
    ["risk_v03_general_urgency", 55],
    ["risk_v03_education_substantiation", 58],
    ["risk_v03_privacy_data_access_review", 55],
  ]);
  for (const [id, floor] of required) {
    const skill = candidateSkillsV031.find((candidate) => candidate.id === id);
    assert.ok(skill, id);
    assert.equal(skill.dominantRisk, false, id);
    assert.equal(skill.severityFloor, floor, id);
  }
});

test("the frozen blind set and results satisfy every preapproval target", () => {
  const casesSource = readFileSync(new URL("../artifacts/v0.3/preapproval-blind-cases.csv", import.meta.url), "utf8").replace(/^\uFEFF/u, "");
  const resultsSource = readFileSync(new URL("../artifacts/v0.3/preapproval-blind-results.csv", import.meta.url), "utf8").replace(/^\uFEFF/u, "");
  const [caseHeaders, ...caseRows] = parseCsv(casesSource);
  const [resultHeaders, ...resultRows] = parseCsv(resultsSource);
  const c = Object.fromEntries(caseHeaders.map((header, index) => [header, index]));
  const r = Object.fromEntries(resultHeaders.map((header, index) => [header, index]));
  assert.equal(caseRows.length, 80);
  assert.equal(resultRows.length, 80);
  assert.deepEqual(
    [...new Set(caseRows.map((row) => row[c.expected_class]))].sort(),
    ["ambiguous", "risky", "safe"],
  );
  assert.ok(caseRows.every((row) => row[c.labeler_process] === "authoring-v0.3.1-pre-evaluation"));
  assert.ok(resultRows.every((row) => row[r.evaluator_process] === "evaluation-v0.3.1-post-freeze"));

  const risky = resultRows.filter((row) => row[r.expected_class] === "risky");
  const safe = resultRows.filter((row) => row[r.expected_class] === "safe");
  const riskyHigh = risky.filter((row) => row[r.actual_status] === "high");
  const safeFp = safe.filter((row) => row[r.actual_status] !== "no_match");
  const contextFp = safe.filter((row) => ["prohibition", "criticism"].includes(row[r.control_tag]) && row[r.actual_status] !== "no_match");
  const overHigh = resultRows.filter((row) => ["simple_amount", "past_statistic", "icon_hiding"].includes(row[r.control_tag]) && row[r.actual_status] === "high");
  assert.ok(riskyHigh.length / risky.length >= 0.85);
  assert.ok(safeFp.length / safe.length <= 0.05);
  assert.equal(contextFp.length, 0);
  assert.equal(overHigh.length, 0);
});
