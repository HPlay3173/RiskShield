import {
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./riskshield.ts";
import {
  candidateSkillsV03,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./v0-3-candidate-skills.ts";

const VERIFIED_AT = "2026-07-18T12:00:00.000Z";

type VerifiedSource = RiskSkill["source"];

const sources: Record<string, VerifiedSource> = {
  risk_v03_health_safety_absolute: {
    title: "의료법 제56조(의료광고의 금지 등)",
    url: "https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1032849723",
    date: "2026-04-07",
    sourceId: "law_medical_service_act_article_56",
    provenanceStatus: "verified",
  },
  risk_v03_health_disease_effect: {
    title: "식품 등의 표시ㆍ광고에 관한 법률 제8조",
    url: "https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1029093705",
    date: "2025-09-19",
    sourceId: "law_food_labeling_advertising_article_8",
    provenanceStatus: "verified",
  },
  risk_v03_health_body_result: {
    title: "표시ㆍ광고의 공정화에 관한 법률 시행령 제3조",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=65001",
    date: "2025-10-01",
    sourceId: "law_fair_labeling_advertising_decree_article_3",
    provenanceStatus: "verified",
  },
  risk_v03_legal_outcome_promise: {
    title: "변호사법 제23조(광고)",
    url: "https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900175869",
    date: "2021-01-05",
    sourceId: "law_attorney_at_law_act_article_23",
    provenanceStatus: "verified",
  },
  risk_v03_legal_substantiation: {
    title: "변호사법 제23조(광고)",
    url: "https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900175869",
    date: "2021-01-05",
    sourceId: "law_attorney_at_law_act_article_23",
    provenanceStatus: "verified",
  },
  risk_v03_general_substantiation: {
    title: "표시ㆍ광고의 공정화에 관한 법률 제5조(실증)",
    url: "https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900553850",
    date: "2025-01-21",
    sourceId: "law_fair_labeling_advertising_article_5",
    provenanceStatus: "verified",
  },
  risk_v03_general_urgency: {
    title: "부당한 표시ㆍ광고 시정 제도 안내",
    url: "https://www.ftc.go.kr/www/contents.do?key=700",
    date: "2026-07-18",
    sourceId: "kftc_unfair_labeling_advertising_overview",
    provenanceStatus: "verified",
  },
  risk_v03_finance_return_recovery: {
    title: "금융소비자 보호에 관한 법률 제22조",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025059417",
    date: "2026-01-02",
    sourceId: "law_financial_consumer_protection_article_22",
    provenanceStatus: "verified",
  },
  risk_v03_income_guarantee: {
    title: "한국소비자원 민간자격증 광고 실태조사",
    url: "https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1004003291&searchKeyword=%EB%AF%BC%EA%B0%84%EC%9E%90%EA%B2%A9&searchKeywordType=1",
    date: "2026-02-11",
    sourceId: "kca_private_qualification_ad_survey_2026",
    provenanceStatus: "verified",
  },
  risk_v03_income_universal_guarantee: {
    title: "한국소비자원 민간자격증 광고 실태조사",
    url: "https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1004003291&searchKeyword=%EB%AF%BC%EA%B0%84%EC%9E%90%EA%B2%A9&searchKeywordType=1",
    date: "2026-02-11",
    sourceId: "kca_private_qualification_ad_survey_2026",
    provenanceStatus: "verified",
  },
  risk_v03_education_outcome_promise: {
    title: "한국소비자원 민간자격증 광고 실태조사",
    url: "https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1004003291&searchKeyword=%EB%AF%BC%EA%B0%84%EC%9E%90%EA%B2%A9&searchKeywordType=1",
    date: "2026-02-11",
    sourceId: "kca_private_qualification_ad_survey_2026",
    provenanceStatus: "verified",
  },
  risk_v03_education_substantiation: {
    title: "표시ㆍ광고의 공정화에 관한 법률 제5조(실증)",
    url: "https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900553850",
    date: "2025-01-21",
    sourceId: "law_fair_labeling_advertising_article_5",
    provenanceStatus: "verified",
  },
  risk_v03_privacy_covert_surveillance: {
    title: "위치정보의 보호 및 이용 등에 관한 법률 제15조",
    url: "https://law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0015&lsiSeq=277359&urlMode=lsScJoRltInfoR",
    date: "2025-10-01",
    sourceId: "law_location_information_article_15",
    provenanceStatus: "verified",
  },
  risk_v03_privacy_stealth_install: {
    title: "위치정보의 보호 및 이용 등에 관한 법률 제15조",
    url: "https://law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0015&lsiSeq=277359&urlMode=lsScJoRltInfoR",
    date: "2025-10-01",
    sourceId: "law_location_information_article_15",
    provenanceStatus: "verified",
  },
  risk_v03_privacy_data_access_review: {
    title: "개인정보 보호법 제15조(개인정보의 수집ㆍ이용)",
    url: "https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398929",
    date: "2025-10-02",
    sourceId: "law_personal_information_protection_article_15",
    provenanceStatus: "verified",
  },
};

const overrides: Partial<Record<string, Partial<RiskSkill>>> = {
  risk_v03_health_safety_absolute: {
    triggerPatterns: ["부작용", "안전성", "위해성", "re:위해(?=가|를|는|도|조차|\\s)"],
    contextPatterns: ["re:(?:전혀|절대|조금도)[^.!?\\n]{0,16}(?:없|않)", "re:제로", "re:100\\s*%[^.!?\\n]{0,10}안전", "완전 안전", "re:보장"],
  },
  risk_v03_health_disease_effect: {
    triggerPatterns: [
      "re:(?:종양|항암|암|당뇨|혈당|변비|숙취|통증|질환|뼈건강)(?=[^.!?\\n]{0,28}(?:효능|치료|개선|완화|예방|배출|제거|조절|완치|없애|고쳐|낫게))",
    ],
    contextPatterns: [
      "re:100\\s*%", "re:무조건", "re:반드시", "re:확실(?:히|하게)?", "re:완전(?:히|하게)?", "re:보장", "re:누구나", "re:모든\\s*(?:사람|환자|경우)", "re:틀림없이", "re:완치",
      "re:(?:질환|증상|통증)[^.!?\\n]{0,18}(?:없애|고쳐|낫게)[^.!?\\n]{0,8}(?:드립니다|합니다|보장)",
    ],
    exclusionPatterns: ["연구", "논문", "가능성", "개인차", "상담", "검진", "과거", "통계", "비판", "금지", "불법", "보장하지", "단정할 수 없"],
    surfaceMeaning: "질환·증상 효능에 절대성, 확정성, 보장 또는 적용 범위 과장을 더합니다.",
    riskReason: "질환·증상 대상과 효능·치료 주장에 확정 또는 과장 신호가 함께 나타납니다.",
    falsePositiveNote: "단순 효능 설명, 제한적 연구 결과, 가능성·개인차 고지는 high가 아니라 REVIEW 또는 미탐지로 구분합니다.",
  },
  risk_v03_health_body_result: {
    triggerPatterns: ["다이어트", "감량", "체중", "체지방", "몸무게", "허리둘레", "뱃살", "체형", "re:(?<![가-힣])살(?![가-힣])"],
    contextPatterns: ["re:\\d+(?:[.]\\d+)?\\s*kg", "re:(?:하루|이틀|사흘|일주일|7일|\\d+개월)", "re:(?:100\\s*%|확실|반드시|무조건)", "만들어 줌", "책임"],
    exclusionPatterns: ["개인차", "목표", "계획", "희망", "과거", "지난", "기록", "측정", "현재 체중", "상담"],
    falsePositiveNote: "같은 kg 한 번만으로 두 의미 그룹을 충족하지 않으며, 과거 체중 기록·현재 측정값·목표 수치는 제외합니다.",
  },
  risk_v03_general_substantiation: {
    exclusionPatterns: ["완료 사실", "공식 인증번호", "기준일", "일정 안내", "출처", "통계", "과거", "지난", "비판", "금지", "불법"],
  },
  risk_v03_finance_return_recovery: {
    triggerPatterns: ["re:(?:투자|수익|고수익|원금|손실|손해)"],
    contextPatterns: ["re:보장", "re:회수", "re:전액(?:을|은|도)?\\s*환불", "re:수익만", "re:원금\\s*보전", "re:보전(?:하|해|됩|된|되|$)", "re:(?:연간|연)\\s*\\d{2,4}\\s*%", "re:만\\s*드리"],
  },
  risk_v03_privacy_covert_surveillance: {
    exclusionPatterns: ["동의받", "동의를 받은", "동의 필수", "불법", "금지", "차단", "보안 교육", "비판"],
  },
  risk_v03_legal_outcome_promise: {
    triggerPatterns: ["re:승소", "re:합의금", "re:무죄", "re:불기소", "re:감형", "re:집행유예", "re:허가"],
    contextPatterns: [
      "보장", "무조건", "확정", "반드시", "100%", "결과를 약속", "결과가 나온다고 단정",
      "re:(?<=승소)(?:합니다|한다|됩니다|된다|할\\s*것입니다)",
      "re:(?<=무죄)(?:입니다|가\\s*나옵니다|를\\s*받습니다)",
      "re:(?<=불기소)(?:됩니다|처분을\\s*받습니다)",
      "re:(?<=감형)(?:됩니다|을\\s*받습니다)",
    ],
    exclusionPatterns: ["결과는 달라", "보장하지", "증명하지 못", "과장 광고", "가능성", "받을 수 있", "될 수 있", "과거", "통계", "비판", "금지", "불법", "허용되지", "오도", "사용해서는", "문구"],
    falsePositiveNote: "가능성 설명인 ‘받을 수 있다’·‘될 수 있다’, 과거 결과, 보장 비판 문맥은 제외합니다.",
  },
  risk_v03_income_guarantee: {
    patternType: "income_or_side_job + estimate_or_performance_amount",
    triggerPatterns: ["소득", "수입", "부업", "재택", "성과급", "인센티브"],
    contextPatterns: ["예상", "평균", "최대", "실적", "성과", "re:월\\s*\\d{1,5}\\s*(?:만\\s*)?원", "re:약\\s*\\d{1,5}\\s*(?:만\\s*)?원"],
    exclusionPatterns: ["정규직", "근로계약", "기본급", "연봉", "세전", "급여 조건", "월급", "고정급"],
    surfaceMeaning: "부업·성과형 수입의 예상액이나 실적 수치를 제시해 산정 근거 확인이 필요합니다.",
    riskReason: "성과형 소득 대상과 예상·평균·실적·금액 표현이 결합합니다.",
    falsePositiveNote: "금액만으로 high가 되지 않으며, 확정 기본급·연봉·월급은 제외하고 예상 소득은 REVIEW로 유지합니다.",
  },
  risk_v03_income_universal_guarantee: {
    triggerPatterns: ["소득", "수입", "부업", "재택", "성과급", "인센티브"],
    contextPatterns: ["re:누구나", "re:무조건", "re:보장", "re:확정", "re:최소[^.!?\\n]{0,16}보장", "re:보장[^.!?\\n]{0,16}최소"],
    exclusionPatterns: ["정규직", "근로계약", "기본급", "연봉", "세전", "급여 조건", "월급", "고정급", "실적에 따라", "성과에 따라", "달라질 수", "예상", "평균"],
    riskReason: "성과형 소득·부업 대상과 누구나·무조건·보장·확정·최소 보장 신호가 결합합니다.",
    falsePositiveNote: "금액이나 예상액만으로 high가 되지 않으며 정상 채용 급여와 실적 변동 고지는 제외합니다.",
  },
  risk_v03_education_outcome_promise: {
    contextPatterns: ["보장", "전원", "무조건", "반드시", "re:약속(?:하|했|할|합니다|했다)", "re:100\\s*%[^.!?\\n]{0,16}(?:보장|합격시|취업시|진학시)"],
    exclusionPatterns: ["합격자 발표", "과거", "지난", "지원", "심사", "목표", "통계", "집계", "기록", "출처", "비판", "금지", "불법"],
    riskReason: "합격·진학·취업 결과와 전원·보장·약속·반드시 같은 미래 확정 신호가 결합합니다.",
    falsePositiveNote: "해결책, 과거 합격 통계와 비율만으로는 high가 되지 않으며 미래 결과 확정 신호를 별도로 요구합니다.",
  },
  risk_v03_privacy_stealth_install: {
    triggerPatterns: ["앱", "설치", "프로그램"],
    contextPatterns: [
      "피감시자", "비동의", "상대방 몰래", "동의 없이", "원격 감시", "원격 추적", "원격 녹음",
      "re:(?:감시|추적|녹음)[^.!?\\n]{0,24}(?:몰래|모르게|숨기|숨김|은폐|표시되지)",
      "re:(?:몰래|모르게|숨기|숨김|은폐|표시되지)[^.!?\\n]{0,24}(?:감시|추적|녹음)",
      "re:(?<=설치)\\s*사실(?:을|이)?[^.!?\\n]{0,12}(?:숨기|숨깁|숨김|은폐|표시되지)",
      "re:(?:배우자|상대방|직원|자녀|대상자)[^.!?\\n]{0,24}(?:몰래|모르게|숨기|은폐)",
    ],
    exclusionPatterns: ["동의", "관리자", "보안", "접근성", "자기 기기", "본인 기기", "사용자 설정", "불법", "금지", "차단", "비판"],
    riskReason: "앱 설치·작동과 피감시자·비동의·은밀성·감시 목적·설치 은폐·원격 감시 신호가 결합합니다.",
    falsePositiveNote: "아이콘 숨김이나 접근성·보안 설정만으로는 high가 아니며 감시·비동의·은폐 목적 신호를 추가로 요구합니다.",
  },
  risk_v03_privacy_data_access_review: {
    exclusionPatterns: ["동의", "권한", "고지", "백업", "관리자", "불법", "금지", "비판", "과거", "통계", "익명"],
  },
};

export const candidateSkillsV031: RiskSkill[] = candidateSkillsV03.map((skill) => {
  const source = sources[skill.id];
  if (!source) throw new Error(`v0.3.1 verified source missing: ${skill.id}`);
  return {
    ...skill,
    ...overrides[skill.id],
    revision: 2,
    source: { ...source },
    recentContextTags: [...skill.recentContextTags, "v0.3.1 사전 승인 보강"],
    notes: "운영 미반영 v0.3.1 사전 승인 후보. 공식 출처 검증 및 적대·블라인드 검증 후 사람 승인 필요.",
    updatedAt: VERIFIED_AT,
    reviewStatus: "draft",
  };
});

export const candidateSkillIdsV031 = candidateSkillsV031.map((skill) => skill.id);
