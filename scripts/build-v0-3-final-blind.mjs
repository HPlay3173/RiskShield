import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";
import { parseCsv } from "../lib/riskshield.ts";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "artifacts", "v0.3-final");
const outputPath = path.join(outputDir, "final-blind-cases.csv");
const accessedAt = "2026-07-18T17:40:00+09:00";

const headers = [
  "case_id",
  "source_type",
  "domain",
  "source_name",
  "source_url",
  "accessed_at",
  "original_text",
  "surrounding_context",
  "collection_notes",
  "duplicate_group",
  "expected_class",
  "expected_range",
  "label_confidence",
  "label_reason",
  "label_frozen_at",
  "authoring_phase",
];

const cases = [];

function add(sourceType, domain, sourceName, sourceUrl, originalText, surroundingContext,
  expectedClass, expectedRange, labelConfidence, labelReason, collectionNotes = "공개 페이지의 표시 문구를 원문 그대로 전사") {
  cases.push({
    case_id: `FB${String(cases.length + 1).padStart(3, "0")}`,
    source_type: sourceType,
    domain,
    source_name: sourceName,
    source_url: sourceUrl,
    accessed_at: accessedAt,
    original_text: originalText,
    surrounding_context: surroundingContext,
    collection_notes: collectionNotes,
    duplicate_group: "",
    expected_class: expectedClass,
    expected_range: expectedRange,
    label_confidence: labelConfidence,
    label_reason: labelReason,
    label_frozen_at: accessedAt,
    authoring_phase: "v0.3-final-pre-analyzer-freeze",
  });
}

const A = (...args) => add("public_ad", ...args);
const S = (...args) => add("public_safe", ...args);
const B = (...args) => add("public_boundary", ...args);

// 70 actual public ad/marketing statements.
A("health", "Hito Calcium 공개 홍보 페이지", "https://www.beautynailhairsalons.com/KR/Seoul/304499426073049/Hito-Calcium---%EC%95%84%EC%8B%9C%EC%95%84-%EC%A0%95%ED%92%88-%ED%82%A4-%EC%84%B1%EC%9E%A5-%EC%A0%9C%ED%92%88", "EFSA, FDA, GMP 인증 – 100% 안전 보장", "키 성장 제품 홍보 게시물의 인증·안전성 표시", "boundary", "0-69", "medium", "안전 보장이지만 현재 규칙은 ‘안전성·부작용’ 명시 결합을 요구한다.");
A("health", "Hito Calcium 공개 홍보 페이지", "https://www.beautynailhairsalons.com/KR/Seoul/304499426073049/Hito-Calcium---%EC%95%84%EC%8B%9C%EC%95%84-%EC%A0%95%ED%92%88-%ED%82%A4-%EC%84%B1%EC%9E%A5-%EC%A0%9C%ED%92%88", "100% 천연 성분 – 부작용 없음, 건강에 해롭지 않음", "키 성장 제품의 원료·부작용 홍보 문구", "risky", "45-100", "medium", "부작용 부재를 단정하지만 ‘전혀·제로’와 같은 승인 규칙의 절대어가 없다.");
A("health", "Hito Calcium 공개 홍보 페이지", "https://www.beautynailhairsalons.com/KR/Seoul/304499426073049/Hito-Calcium---%EC%95%84%EC%8B%9C%EC%95%84-%EC%A0%95%ED%92%88-%ED%82%A4-%EC%84%B1%EC%9E%A5-%EC%A0%9C%ED%92%88", "지금 바로 6~8cm 키 성장!", "상품 게시물 첫 문장의 정량 신체 변화 주장", "risky", "45-100", "medium", "정량 신체 결과 주장이지만 현재 신체 규칙의 대상 어휘는 키 성장을 포함하지 않는다.");
A("health", "Hito Calcium 공개 홍보 페이지", "https://www.beautynailhairsalons.com/KR/Seoul/304499426073049/Hito-Calcium---%EC%95%84%EC%8B%9C%EC%95%84-%EC%A0%95%ED%92%88-%ED%82%A4-%EC%84%B1%EC%9E%A5-%EC%A0%9C%ED%92%88", "첫 번째 프로그램 후 확실한 변화를 경험하세요", "키 성장 상품의 결과 체험 유도 문구", "boundary", "0-69", "medium", "변화 대상과 수치가 생략된 일반적 결과 표현이다.");
A("health", "Hito Calcium 공개 홍보 페이지", "https://www.beautynailhairsalons.com/KR/Seoul/304499426073049/Hito-Calcium---%EC%95%84%EC%8B%9C%EC%95%84-%EC%A0%95%ED%92%88-%ED%82%A4-%EC%84%B1%EC%9E%A5-%EC%A0%9C%ED%92%88", "50,000명 이상의 고객이 성공적으로 경험했습니다 – 이제 당신 차례입니다!", "상품 홍보 게시물의 누적 고객·성공 표현", "boundary", "0-69", "medium", "성과 수치의 진위는 외부 근거가 필요하지만 승인된 조합 규칙과 직접 일치하지 않는다.");
A("health", "Hito Calcium 공개 홍보 페이지", "https://www.beautynailhairsalons.com/KR/Seoul/304499426073049/Hito-Calcium---%EC%95%84%EC%8B%9C%EC%95%84-%EC%A0%95%ED%92%88-%ED%82%A4-%EC%84%B1%EC%9E%A5-%EC%A0%9C%ED%92%88", "35% 할인 + 무료 배송 – 단 100명 한정!", "상품 게시물의 수량 한정 판촉", "boundary", "0-69", "medium", "수량 한정이지만 같은 문장에 신청·구매 행동이 없다.");
A("health", "매일경제 한방 다이어트 광고", "https://www.mk.co.kr/news/economy/1347901", "부작용 제로, 효과 100%의 한방다이어트", "지면 광고 제목", "risky", "80-100", "high", "부작용 제로와 다이어트 효능 절대 표현이 결합한다.");
A("health", "매일경제 한방 다이어트 광고", "https://www.mk.co.kr/news/economy/1347901", "이 제품은 하루세끼 정상식사로 체력을 유지하면서 다이어트를 하므로 부작용이 전혀 없고 순수 한방 생약제로 비만해소에 이상적인 효능을 지닌 양약이라고 한박사는 이야기한다.", "광고 본문 중 안전성·효능 설명", "risky", "80-100", "high", "부작용이 전혀 없다는 절대 부재 주장이 명시된다.");
A("health", "성형 정보 앱 불법 광고 보도", "https://news.nate.com/view/20170605n21181", "10년 무사고로 부작용 사례가 전혀 없다고 했다.", "피해자가 병원 설명을 인용한 부분", "risky", "80-100", "high", "부작용 사례가 전혀 없다고 단정한다.", "보도문에 인용된 실제 광고·상담 주장 전사");
A("health", "성형 정보 앱 불법 광고 보도", "https://news.nate.com/view/20170605n21181", "부작용 하나도 없고 강력추천해요.", "성형 앱 후기 예시의 인용 문구", "risky", "45-100", "medium", "부작용 부재 후기이지만 승인 규칙의 절대어 표면형과 다르다.", "보도문에 인용된 실제 후기 문구 전사");
A("health", "출두라 SMP 홍보 페이지", "https://chuldula.com/", "98% 만족도", "메인 화면의 성과 지표", "boundary", "0-69", "medium", "분모·조사 방법이 없는 만족도 수치다.");
A("health", "출두라 SMP 홍보 페이지", "https://chuldula.com/", "500+ 시술 완료", "메인 화면의 누적 실적 지표", "boundary", "0-69", "medium", "누적 실적은 입증이 필요하나 현재 조합 규칙 대상과 다르다.");
A("health", "출두라 SMP 홍보 페이지", "https://chuldula.com/", "4-6년 지속 효과", "메인 화면의 지속 기간 표시", "boundary", "0-69", "medium", "효과 기간 주장이지만 질환·정량 감량과는 무관하다.");
A("health", "출두라 SMP 홍보 페이지", "https://chuldula.com/", "즉시 효과", "메인 화면의 효과 속도 표시", "boundary", "0-69", "medium", "효과 대상이 생략된 짧은 판촉 문구다.");
A("health", "불법 미용시술 광고 보도", "https://www.jeollailbo.com/news/articleView.html?idxno=733191", "100% 완전 안전 보장", "불법 미용시술 광고에 사용된 문구를 보도가 인용", "risky", "45-100", "medium", "절대 안전 보장이지만 ‘안전성’ 또는 ‘부작용’ 대상어가 생략되어 있다.", "보도문에 인용된 실제 광고 문구 전사");

A("general", "스마트스토어 파트너스", "https://smartstoreinc.net/alba", "안정적인 부수입의 기회", "해외구매 부업 파트너 모집 문구", "boundary", "0-69", "medium", "기회 표현만 있고 금액·보장·최소 조건은 없다.");
A("finance", "뉴스핌 유사수신 광고 보도", "https://www.newspim.com/news/view/20170529000148", "원금보장과 확정 수익률", "유사수신 업체 광고 표현을 보도가 인용", "risky", "80-100", "high", "원금 보장과 수익 확정이 결합한다.", "보도문에 인용된 실제 광고 문구 전사");
A("finance", "한화투자증권 소비자경보", "https://www.hanwhawm.com/main/common/common_file/fileView.cmd?category=2&file=20230627015227998.pdf", "원금과 이익을 보전", "불법 금융투자 광고 사례 문구", "risky", "80-100", "high", "원금과 이익 보전을 약속한다.", "경보 자료에 수록된 실제 사례 문구 전사");
A("finance", "한화투자증권 소비자경보", "https://www.hanwhawm.com/main/common/common_file/fileView.cmd?category=2&file=20230627015227998.pdf", "원금 손실 없이 고수익을 보장", "불법 금융투자 광고 사례 문구", "risky", "80-100", "high", "원금 손실 부재와 고수익 보장을 함께 약속한다.", "경보 자료에 수록된 실제 사례 문구 전사");
A("finance", "한화투자증권 소비자경보", "https://www.hanwhawm.com/main/common/common_file/fileView.cmd?category=2&file=20230627015227998.pdf", "천연가스 베이시스 거래를 통해 한달에 약 8%의 수익", "불법 금융투자 광고 사례의 수익률 설명", "risky", "45-100", "medium", "구체적 고수익률이지만 보장·회수 표현은 생략됐다.", "경보 자료에 수록된 실제 사례 문구 전사");
A("finance", "국제신문 유사수신 광고 보도", "https://www.kookje.co.kr/news2011/asp/newsbody.asp?code=0300&key=20200123.99099010597", "원금 및 고수익을 보장", "SNS 투자 광고 표현을 보도가 인용", "risky", "80-100", "high", "원금과 고수익 보장을 함께 제시한다.", "보도문에 인용된 실제 광고 문구 전사");
A("general", "프라임에셋 SP파트너스", "https://www.primeasp.com/primedb/", "업계 최고 수준 대우 보장", "보험설계사 부업 모집 페이지의 처우 홍보", "boundary", "0-69", "medium", "대우 조건의 비교 표현이지 투자 수익이나 월 소득 보장은 아니다.");
A("finance", "로톡 투자사기 판례 해설", "https://www.lawtalk.co.kr/case-lenses/31679", "원금 이상의 수익을 보장", "사기 사건에서 사용된 투자 권유 표현", "risky", "80-100", "high", "원금 이상의 수익을 보장한다고 약속한다.", "판례 해설에 인용된 실제 권유 문구 전사");
A("finance", "로톡 투자사기 판례 해설", "https://www.lawtalk.co.kr/case-lenses/31679", "고수익을 약속", "사기 사건에서 사용된 투자 권유 표현", "risky", "45-100", "medium", "고수익 약속이지만 승인 규칙 문맥어에는 ‘약속’이 포함되지 않는다.", "판례 해설에 인용된 실제 권유 문구 전사");
A("finance", "바이테더 홍보 페이지", "https://bytether-guide.com/guide", "타 OTC 대비 최소 3% 마진율 보장", "코인 거래 서비스의 비교·마진 홍보", "risky", "45-100", "medium", "최소 마진 보장이지만 원금·투자·수익 대상어가 같은 문장에 없다.");
A("finance", "부업의 함정 취재 보도", "https://v.daum.net/v/20251129063217635", "100% 수익 보장", "재택 부업 제안자가 사용한 수익 광고를 제목과 본문이 인용", "risky", "80-100", "high", "수익 보장을 절대 수치로 제시한다.", "보도문에 인용된 실제 제안 문구 전사");
A("finance", "프라임에셋 SP파트너스", "https://www.primeasp.com/primedb/", "타사 대비 훨씬 높은 수익을 보장합니다.", "보험설계사 부업 모집 페이지의 정산 홍보", "risky", "80-100", "high", "수익과 보장 표현이 직접 결합한다.");

A("education", "입시나비", "https://m.ipsinavi.com/?Page=main", "입시 합격률 극대화", "입시 컨설팅 서비스 핵심 홍보 문구", "risky", "45-100", "medium", "합격률 개선 주장이나 전원·보장·약속은 없다.");
A("education", "입시나비", "https://m.ipsinavi.com/?Page=main", "학부모 만족도 95% 달성", "입시 컨설팅 서비스 성과 지표", "boundary", "0-69", "medium", "만족도 수치의 조사 근거 확인이 필요하다.");
A("education", "입시나비", "https://m.ipsinavi.com/?Page=main", "AI 활용 학생별 합격 확률 예측", "입시 컨설팅 기능 소개", "boundary", "0-69", "medium", "예측 기능 소개이며 결과 보장은 아니다.");
A("education", "입시나비", "https://m.ipsinavi.com/?Page=main", "목표 대학 합격 가능성을 정확하게 예측하고 관리합니다", "입시 컨설팅 기능 소개", "boundary", "0-69", "medium", "정확성 주장에 대한 근거 검토가 필요하다.");
A("education", "위캔 입시 컨설팅", "https://wecan000.imweb.me/", "확실한 합격 보장 대학 2개교 안전망 구축", "입시 전략 서비스 소개", "risky", "80-100", "high", "합격과 보장 표현이 직접 결합한다.");
A("education", "위캔 입시 컨설팅", "https://wecan000.imweb.me/", "학생·학부모 진로 희망사항 100% 반영", "컨설팅 운영 방침 홍보", "boundary", "0-69", "medium", "의견 반영 비율이지 합격 결과 보장은 아니다.");
A("education", "채널A 승무원학원 광고 보도", "https://ichannela.com/news/detail/54154956-1.do", "저희 학원생들은 다 합격을 시켜 드려요.", "학원 상담 광고 발언을 보도가 인용", "risky", "45-100", "medium", "전원 의미를 암시하지만 승인 규칙의 표면어 ‘전원·보장’은 없다.", "보도문에 인용된 실제 상담 문구 전사");
A("education", "채널A 승무원학원 광고 보도", "https://ichannela.com/news/detail/54154956-1.do", "스튜어디스 특채 보장", "학원 광고 표현을 보도가 인용", "risky", "45-100", "medium", "채용 결과 보장이지만 승인 규칙의 교육 결과 대상어가 생략됐다.", "보도문에 인용된 실제 광고 문구 전사");
A("education", "채널A 승무원학원 광고 보도", "https://ichannela.com/news/detail/54154956-1.do", "최단기간에 가장 많은 합격생", "학원 비교·성과 광고를 보도가 인용", "risky", "45-69", "medium", "교육 성과 최상급 표현으로 입증 검토 대상이다.", "보도문에 인용된 실제 광고 문구 전사");
A("education", "제로백교육", "https://www.zero100edu.co.kr/", "7일 내 100% 환불 보장", "교육상품 환불 정책 홍보", "boundary", "0-69", "medium", "소비자 환불 보장이지 학습 결과 보장이 아니다.");
A("education", "메가스터디 러셀", "https://russelhs.megastudy.net/russel/study_hall/default.asp", "재원생 수 대비 주요대학 합격률 1위", "학습관 성과 비교 문구", "risky", "45-69", "high", "합격률과 1위 표현이 결합한 교육 입증 검토 대상이다.");
A("education", "광주엔젤간호학원", "https://www.kjangel.co.kr/", "자격취득 국가시험 100% 전원 합격", "학원 메인 화면 합격 성과 홍보", "risky", "80-100", "high", "합격과 100% 전원 표현이 결합한다.");
A("education", "광주엔젤간호학원", "https://www.kjangel.co.kr/", "11개월의 투자로 평생 보장 전문직 자격 취득", "학원 메인 화면 자격 홍보", "risky", "45-100", "medium", "자격 취득을 평생 보장으로 표현하지만 승인 규칙의 결과 대상과 정확히 맞지 않는다.");
A("education", "중국어학원 수강후기", "https://m.chinasisa.com/review/lecture_view?n=7776&offset=26180", "합격은 정말 보장 되어있는 거라 생각합니다", "공개 수강후기의 합격 평가", "risky", "80-100", "high", "합격과 보장 표현이 직접 결합한다.", "공개 후기 원문 전사");

A("legal", "법무부 변호사 광고 징계 보도자료", "https://www.moj.go.kr/bbs/moj/182/496925/download.do", "무조건 승소하는 변호사", "보도자료 제목에 제시된 부당기대유발 광고", "risky", "80-100", "high", "승소와 무조건 표현이 결합한다.", "정부 자료에 인용된 실제 광고 문구 전사");
A("legal", "법무부 변호사 광고 징계 보도자료", "https://www.moj.go.kr/bbs/moj/182/496925/download.do", "고객 선호 브랜드지수 3년 연속 1위", "징계 결정 사례의 홈페이지 광고", "risky", "45-69", "medium", "객관적 근거가 확인되지 않은 1위 광고다.", "정부 자료에 인용된 실제 광고 문구 전사");
A("legal", "법무부 변호사 광고 징계 보도자료", "https://www.moj.go.kr/bbs/moj/182/496925/download.do", "승소 가능성 90% 이상이고, 손해배상 부분은 99% 승소예상된다", "단체 채팅방에서 사용한 수임 유인 문구", "risky", "45-69", "medium", "구체적 승소 가능성을 장담하지만 ‘승소율’ 또는 보장 표면어는 없다.", "정부 자료에 인용된 실제 권유 문구 전사");
A("legal", "법무부 변호사 광고 징계 보도자료", "https://www.moj.go.kr/bbs/moj/182/496925/download.do", "전관예우변호사 C법인", "법무법인 광고에 사용된 연고관계 표현", "risky", "45-69", "medium", "전관 영향력을 암시하는 권위 광고다.", "정부 자료에 인용된 실제 광고 문구 전사");
A("legal", "법무부 변호사 광고 징계 보도자료", "https://www.moj.go.kr/bbs/moj/182/496925/download.do", "선임 전 무료 사건 분석, 형량 예측 서비스 제공", "법무법인 광고에 사용된 서비스 표현", "boundary", "0-69", "medium", "결과 예측 서비스 소개지만 승소·무죄·감형 보장은 아니다.", "정부 자료에 인용된 실제 광고 문구 전사");
A("legal", "법률 소비자 보호 안내", "https://law-min.com/lawyer-ad-consumer-protection/", "승소 보장", "소비자에게 경계할 광고 문구 예시로 제시", "risky", "80-100", "high", "승소와 보장 표현이 직접 결합한다.", "안내 페이지가 예시로 인용한 실제 유형 문구 전사");
A("legal", "법률 소비자 보호 안내", "https://law-min.com/lawyer-ad-consumer-protection/", "업계 1위", "소비자에게 경계할 광고 문구 예시로 제시", "boundary", "0-69", "medium", "분야·비교 기준이 생략된 최상급 표현이다.", "안내 페이지가 예시로 인용한 실제 유형 문구 전사");
A("legal", "법률 소비자 보호 안내", "https://law-min.com/lawyer-ad-consumer-protection/", "단기간 해결", "소비자에게 경계할 광고 문구 예시로 제시", "boundary", "0-69", "medium", "구체적 법률 결과가 생략된 속도 표현이다.", "안내 페이지가 예시로 인용한 실제 유형 문구 전사");

A("privacy", "mSpy 문자 모니터링 홍보", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "문자 메시지를 몰래 전달하는 방법", "페이지 제목", "risky", "80-100", "high", "메시지와 몰래 전달 행위가 결합한다.");
A("privacy", "mSpy 문자 모니터링 홍보", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "숨겨진 모드로 작동하기 때문에 상대방은 사용자가 이 앱을 사용하고 있다는 사실을 절대 알 수 없습니다.", "제품 작동 방식 소개", "risky", "80-100", "high", "앱 작동 사실을 상대가 알 수 없도록 숨긴다.");
A("privacy", "mSpy 문자 모니터링 홍보", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "mSpy를 사용하면 제어판을 통해 상대방의 문자 메시지를 읽을 수 있습니다.", "제품 기능 소개", "risky", "45-69", "medium", "상대방 메시지 열람이지만 몰래·모르게 신호가 같은 문장에 없다.");
A("privacy", "mSpy 문자 모니터링 홍보", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "mSpy를 사용하면 메시지 앱에서 상대방의 모든 대화에 액세스할 수 있습니다.", "제품 기능 소개", "risky", "45-69", "medium", "상대방 대화 접근이지만 은폐 신호가 같은 문장에 없다.");
A("privacy", "mSpy 문자 모니터링 홍보", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "비밀을 유지하려면 상대방 모르게 알림을 삭제할 수 있는 충분한 시간을 확보하세요.", "iMessage 접근 흔적을 숨기는 안내", "risky", "80-100", "high", "알림을 상대방 모르게 삭제하도록 안내한다.");
A("privacy", "mSpy 문자 모니터링 홍보", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "어디서든 mSpy로 상대방의 메시지를 읽을 수 있습니다.", "메시징 앱 모니터링 홍보", "risky", "45-69", "medium", "메시지 열람 기능이지만 동의·은폐 맥락이 생략됐다.");
A("privacy", "mSpy 문자 모니터링 홍보", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "mSpy를 사용하면 통화 모니터링 및 GPS 추적과 같은 추가 기능을 사용할 수 있습니다. 그리고 상대방은 절대 알 수 없습니다.", "추가 감시 기능 소개", "risky", "80-100", "high", "통화·GPS 추적과 상대방 비인지가 결합한다.");
A("privacy", "mSpy 문자 모니터링 홍보", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "기기에서 앱 아이콘을 숨기는 옵션을 선택할 수 있습니다.", "공개 댓글에 대한 제품 측 답변", "risky", "80-100", "high", "앱 아이콘을 숨기는 은폐 설치 기능이다.");
A("privacy", "mSpy 문자 모니터링 홍보", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "이 앱은 작동 중인 앱 목록에서도 표시되지 않습니다.", "공개 댓글에 대한 제품 측 답변", "risky", "80-100", "high", "앱 작동 사실이 목록에 표시되지 않도록 한다.");
A("privacy", "스파이앱 사건 보도", "https://v.daum.net/v/a2aLZmL9yO", "상대방 몰래 앱 설치 증거수집", "사건에서 사용된 서비스 광고 문구를 보도가 인용", "risky", "80-100", "high", "상대방 몰래 앱을 설치한다고 명시한다.", "보도문에 인용된 실제 광고 문구 전사");
A("privacy", "페이스북 메시지 열람 안내", "https://metier7.blogspot.com/", "페이스북메신저 채팅을 상대방 모르게 보는 방법", "공개 블로그 안내 제목", "risky", "80-100", "high", "상대방 모르게 대화를 보는 방법을 안내한다.");

A("general", "프라임에셋 SP파트너스", "https://www.primeasp.com/primedb/", "부업 설계사 평균 월 240만원", "보험설계사 모집 페이지의 평균 수입 지표", "risky", "45-69", "high", "부업·월 금액 조합으로 소득 입증 검토가 필요하다.");
A("general", "프라임에셋 SP파트너스", "https://www.primeasp.com/primedb/", "첫 달에 110만원, 5개월차 지금은 부수입이 본업 월급의 70% 수준이에요.", "모집 페이지에 실린 활동자 후기", "boundary", "0-69", "medium", "개인 후기의 과거 실적이며 보편적 보장이 아니다.");
A("general", "부업샘", "https://xn--or3b64dcxf.com/", "최고의 안전과 수익만을 보장합니다.", "재택 부업 연결 서비스의 메인 홍보 문구", "risky", "80-100", "high", "수익과 보장 표현이 결합한다.");
A("general", "부업샘", "https://xn--or3b64dcxf.com/", "데이터 입력 부업을 시작한 지 한 달 만에 월 150만원의 추가 수입이 생겼습니다.", "서비스 페이지에 실린 이용 후기", "risky", "45-69", "high", "부업·월 수입이 결합해 소득 입증 검토 대상이다.");
A("general", "부업샘", "https://xn--or3b64dcxf.com/", "퇴근 후 2-3시간만 투자해도 월 100만원 이상 벌 수 있어서 너무 좋아요.", "서비스 페이지에 실린 이용 후기", "risky", "45-69", "high", "월 금액과 이상 표현이 결합한 소득 주장이다.");
A("general", "스마트스토어 파트너스", "https://smartstoreinc.net/alba", "월 100~400만원도 가능해요!", "해외구매 부업 파트너 모집 문구", "risky", "45-69", "medium", "월 수입 범위 주장이나 보장·최소 표현은 없다.");
A("general", "화물차 일자리 직거래", "https://cargoda.m-bia.com/2026/06/job-direct-1782693788564.html", "운행 시 월 예상 수입은 600만원 완제 수준입니다.", "화물차 일자리 매물의 수입 안내", "risky", "45-69", "high", "수입과 월 금액이 결합해 산정 조건 검토가 필요하다.");
A("general", "KARAKU 타임세일", "https://karaku.co.kr/collections/72-hours", "72시간 한정 타임세일을 진행하고 있습니다. 지금 구매하기", "온라인 스토어의 한정 세일 화면", "risky", "45-69", "high", "한정과 구매 행동이 같은 판촉 문맥에 결합한다.");
A("general", "KARAKU 타임세일", "https://karaku.co.kr/collections/72-hours", "재고가 얼마 남지 않아 빨리 구입하세요!", "온라인 스토어의 재고 압박 문구", "risky", "45-69", "medium", "재고 희소성과 신속 구매 압박이 결합한다.");
A("general", "라이프해킹스쿨 커머스 캠프", "https://lifehacking.co.kr/commercecamp/start", "선착순 한정 이벤트, 지금 신청 시에만", "커머스 강의 판매 페이지의 이벤트 문구", "risky", "45-69", "high", "선착순·한정과 즉시 신청이 결합한다.");

// 20 public safe, criticism, disclaimer, or illegal-guidance statements.
S("health", "한국소비자원 헤나 안전주의보", "https://www.kca.go.kr/home/sub.do?menukey=4006&mode=view&no=1002743983&page=3", "‘부작용이 전혀 없다’ 등의 표현은 금지함.", "화장품 표시·광고 가이드라인의 금지 표현 설명", "safe", "0-44", "high", "위험 표현의 사용을 명시적으로 금지하는 교육 문맥이다.");
S("health", "국가암정보센터 건강기능식품 안내", "https://www.cancer.go.kr/lay1/bbs/S1T610C611/A/31/view.do?article_seq=14944", "건강기능식품은 질병의 치료를 목적으로 하는 의약품이 아닙니다.", "건강기능식품과 의약품을 구분하는 공공 안내", "safe", "0-44", "high", "치료 효능을 부정하는 면책·교육 문장이다.");
S("health", "강남 울쎄라 안전 가이드", "https://blog.shinyuskin.com/gangnam-ultherapy-prime-price-safety-guide-2026", "개인의 피부 상태와 조건에 따라 결과는 달라질 수 있습니다.", "시술 결과 개인차 안내", "safe", "0-44", "high", "결과 개인차를 명시한다.");
S("health", "장애인 건강 주치의 상담 매뉴얼", "https://www.cbrh.or.kr/include/download.jsp?af=1664937679891_653.pdf&path=%2Fupload%2Ffaq%2F&vf=%EC%9E%A5%EC%95%A0%EC%9D%B8%EA%B1%B4%EA%B0%95%EC%A3%BC%EC%B9%98%EC%9D%98%EC%83%81%EB%8B%B4%EB%A7%A4%EB%89%B4%EC%96%BC%28%EB%A7%8C%EC%84%B1%EC%A7%88%ED%99%98%EB%B0%8F%EC%98%88%EB%B0%A9%29.pdf", "환자에게 맞는 운동의 종류, 강도 및 지속시간을 정합니다.", "개별화된 비만 상담 목표", "safe", "0-44", "high", "보장 대신 개인별 평가·계획을 안내한다.");
S("finance", "국무조정실 불법사금융 피해예방", "https://www.opm.go.kr/opm/news/press-release.do?articleNo=156117&attachNo=140907&mode=download", "원금·고수익을 보장할 수 있는 투자는 없습니다.", "정부의 투자사기 예방 안내", "safe", "0-44", "high", "원금·고수익 보장을 명시적으로 부정한다.");
S("finance", "국무조정실 불법사금융 피해예방", "https://www.opm.go.kr/opm/news/press-release.do?articleNo=156117&attachNo=140907&mode=download", "원금·고수익 보장 시 무조건 사기를 의심하십시오.", "정부의 투자사기 경고", "safe", "0-44", "high", "보장 문구를 경계하라는 금지·경고 문맥이다.");
S("finance", "시니어 온라인 부업 안내", "https://economy-4-silver-generation.tistory.com/6", "수익이 지나치게 과장되거나 선입금을 요구하는 앱은 무조건 피하기.", "부업 사기 예방 체크리스트", "safe", "0-44", "high", "과장 수익 앱을 피하라는 경고다.");
S("finance", "부업 사기 사례 안내", "https://sokjima.com/cases/case/2026-03-31-job-scam-001", "유튜브·SNS에서 ‘월 수백만원 보장’ 부업 광고를 주의하세요.", "취업사기 예방 핵심", "safe", "0-44", "high", "보장형 부업 광고에 대한 경고 문맥이다.");
S("education", "진학닷컴 합격예측 안내", "https://www.jinhak.com/jh/high3/regular/manual/accuracy-pr", "실제 결과는 다를 수 있으므로 참고용으로 활용해 주세요.", "합격예측 적중률 페이지의 면책 문구", "safe", "0-44", "high", "예측 결과의 한계와 참고용 성격을 명시한다.");
S("education", "진학닷컴 합격예측 안내", "https://www.jinhak.com/jh/high3/regular/manual/accuracy-pr", "합격예측 결과는 대학의 전형 방법과 지원자 상황에 따라 달라질 수 있습니다.", "합격예측 서비스의 조건 안내", "safe", "0-44", "high", "외부 전형과 지원 상황에 따른 변동을 밝힌다.");
S("legal", "법률 소비자 보호 안내", "https://law-min.com/lawyer-ad-consumer-protection/", "결과를 보장하는 변호사는 없습니다.", "변호사 광고 소비자 주의사항", "safe", "0-44", "high", "법률 결과 보장을 명시적으로 부정한다.");
S("legal", "법무부 변호사 광고 징계 보도자료", "https://www.moj.go.kr/bbs/moj/182/496925/download.do", "부당기대유발 광고, 연고관계 선전 광고, 결과 예측 광고에 대한 징계를 강화합니다.", "정부의 부당 광고 규제 설명", "safe", "0-44", "high", "광고 유형을 비판·규제하는 정책 문맥이다.");
S("legal", "법률 진단 서비스 면책", "https://albup.co.kr/page/detail.php?com_idx=17589", "제공된 정보는 참고용으로만 사용하시기 바라며 구체적인 법률 상담이 필요한 경우 반드시 변호사와 상담하시기 바랍니다.", "법률 정보 페이지의 면책 안내", "safe", "0-44", "high", "개별 상담 필요성과 참고용 한계를 명시한다.");
S("general", "요즘IT 다크패턴 분석", "https://yozm.wishket.com/magazine/detail/2604/", "‘품절 임박’, ‘1개만 남음’ 같은 재고 부족 메시지는 구매를 서두르게 만듭니다.", "테무 구매 유도 패턴을 비판적으로 분석", "safe", "0-44", "high", "긴급 문구를 분석·비판하는 메타 문맥이다.");
S("general", "Cisco 브랜드 보호 안내", "https://www.cisco.com/c/dam/global/ko_kr/buy/brandprotection/risk/12850-cisco-apac-cust4pp-view.pdf", "가격이 인상되니 즉시 주문하라고 강요하는 공급업체와는 거래하지 마십시오.", "위조품 구매 위험을 줄이는 조달 경고", "safe", "0-44", "high", "즉시 주문 압박을 거부하라는 경고다.");
S("general", "훈련복 구매 안내", "https://jnsportsclub.kr/303", "훈련복의 교환은 어려우니 사이즈 확인하시고 신청 부탁 드립니다.", "실제 구매 조건과 교환 제한 안내", "safe", "0-44", "high", "구체적 구매 조건 안내이며 기만적 희소성 보장이 아니다.");
S("privacy", "mSpy 법률 면책", "https://www.mspy.com/blog/ko/secret-sms-forwarding/", "귀하가 소유하지 않은 장치에 라이선스 소프트웨어를 설치하는 것은 관련 법률을 위반하는 것입니다.", "페이지 하단 법률 면책 조항", "safe", "0-44", "high", "무단 설치가 법률 위반임을 명시한다.");
S("privacy", "로톡뉴스 감시 앱 판결 보도", "https://lawtalknews.co.kr/article/7GM2S7RIRLEX", "상대방 동의 없이 통화 내용과 문자메시지, 위치정보를 몰래 확인하는 행위는 불법입니다.", "감시 앱 사건의 위법성 설명", "safe", "0-44", "high", "비동의 감시를 불법으로 명시한다.");
S("privacy", "Apple Mail 사용 설명서", "https://support.apple.com/ko-kr/guide/mail/mlhlp1001/mac", "자신의 메시지를 파일로 저장하거나 백업할 수 있습니다.", "사용자 본인의 메일 보관 기능 설명", "safe", "0-44", "high", "본인 데이터의 저장·백업 기능이다.");
S("privacy", "스토킹 피해 안전 가이드", "https://www.gwff.kr/storage/board/basic/2024/02/14/BASIC_ATTACH_1707895315270.pdf", "가해자가 위치추적 앱을 사용하여 피해자 몰래 추적할 수 있으므로 주의해야 합니다.", "스토킹 피해 예방 안내", "safe", "0-44", "high", "몰래 위치추적을 경고하는 안전 문맥이다.");

// 10 boundary statements from public pages.
B("health", "출두라 SMP 홍보 페이지", "https://chuldula.com/", "한 번의 시술로 장기간 효과를 누리실 수 있습니다.", "SMP 시술 지속성 홍보", "boundary", "0-69", "high", "효과 기간을 강조하지만 정량 감량·질환 치료·안전 보장은 아니다.");
B("health", "출두라 SMP 홍보 페이지", "https://chuldula.com/", "실제 모발과 구분이 불가능합니다.", "SMP 시술 자연스러움 홍보", "boundary", "0-69", "high", "최상급 품질 표현이지만 승인 조합 규칙 대상과 다르다.");
B("health", "출두라 SMP 홍보 페이지", "https://chuldula.com/", "자연스러운 밀도와 방향성을 완벽히 재현합니다.", "SMP 시술 결과 홍보", "boundary", "0-69", "high", "완벽 표현의 입증은 필요하나 구체적 고위험 결과 대상이 없다.");
B("health", "출두라 SMP 홍보 페이지", "https://chuldula.com/", "1년 A/S 보장", "시술 후 관리 정책 표시", "boundary", "0-69", "high", "서비스 보증이지 건강 결과 보장이 아니다.");
B("general", "쿠팡 운동화 세탁망", "https://www.coupang.com/vp/products/9056650519?itemId=26587031317", "재고가 얼마 남지 않았습니다.", "상품 상세 페이지의 재고 표시", "boundary", "0-69", "high", "재고 안내만 있고 구매·신청 압박은 같은 문장에 없다.");
B("general", "카페24 스토어 마케팅 가이드", "https://store.cafe24.com/story/2328", "장바구니에 담으신 상품의 재고가 얼마 남지 않았으니 확인해 주세요.", "장바구니 이탈 고객용 메시지 예시", "boundary", "0-69", "high", "확인을 권하지만 구매·신청을 직접 요구하지 않는다.");
B("general", "Work24 채용공고", "https://m.work24.go.kr/wk/a/b/1500/empDetailAuthView.do", "칼퇴근 보장", "채용공고의 근무환경 홍보", "boundary", "0-69", "high", "근무시간 표현이지 소득·투자·결과 보장이 아니다.");
B("finance", "네이버페이 운전자보험 안내", "https://new-m.pay.naver.com/mymoney/insurance/contents/104", "형사 합의금이나 벌금비용 등을 보장합니다.", "보험 약관상 보장 범위 설명", "boundary", "0-69", "high", "보험 계약상 비용 보장이며 투자 수익·원금 보장이 아니다.");
B("education", "제로백교육", "https://www.zero100edu.co.kr/", "서연고+서성한 다수 합격생 배출", "교육상품의 과거 성과 표시", "boundary", "0-69", "high", "과거 성과 주장으로 결과 보장과 구분해야 한다.");
B("privacy", "ADT캡스 홈 계약 확인서", "https://assets.ctfassets.net/6esn7f73fym2/5jP47eyvXlR6K3Tzlv0D3e/0b7df8b5e06187ac247d1ea174d16a53/CAPSHome_Rental_Contract_Terms_Confirmation_251205.pdf", "서비스 제공을 위해 필요한 개인정보를 계약 조건에 따라 처리합니다.", "동의 기반 보안 서비스 계약 안내", "boundary", "0-69", "high", "권한·계약 조건이 있는 정상적 개인정보 처리 설명이다.");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvText(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

if (cases.length !== 100) throw new Error(`Expected 100 cases, found ${cases.length}`);
const sourceTypeCounts = countBy(cases.map((row) => row.source_type));
if (sourceTypeCounts.public_ad !== 70 || sourceTypeCounts.public_safe !== 20 || sourceTypeCounts.public_boundary !== 10) {
  throw new Error(`Invalid composition: ${JSON.stringify(sourceTypeCounts)}`);
}
const urls = new Set(cases.map((row) => row.source_url));
if (urls.size < 30) throw new Error(`Expected at least 30 unique URLs, found ${urls.size}`);
const perUrl = countBy(cases.map((row) => row.source_url));
for (const [url, count] of Object.entries(perUrl)) {
  if (count > 15) throw new Error(`Source cap exceeded (${count}): ${url}`);
}
const requiredDomains = ["health", "finance", "education", "legal", "general", "privacy"];
for (const domain of requiredDomains) {
  if (!cases.some((row) => row.domain === domain)) throw new Error(`Missing domain: ${domain}`);
}
const duplicateTexts = Object.entries(countBy(cases.map((row) => row.original_text.trim())))
  .filter(([, count]) => count > 1);
if (duplicateTexts.length) throw new Error(`Duplicate texts: ${JSON.stringify(duplicateTexts)}`);

const priorCsvPaths = [
  path.join(root, "artifacts", "real-world-evaluation", "collected-ad-cases.csv"),
  path.join(root, "artifacts", "v0.3", "collected-ad-cases-audited.csv"),
  path.join(root, "artifacts", "v0.3", "preapproval-blind-cases.csv"),
  path.join(root, "tests", "fixtures", "analyzer-v0.3-generalization.csv"),
];
const oldTexts = new Set();
const oldUrls = new Set();
for (const priorPath of priorCsvPaths) {
  const table = parseCsv(await fs.readFile(priorPath, "utf8"));
  const header = table[0] ?? [];
  const textIndex = header.findIndex((value) => ["original_text", "text"].includes(value));
  const urlIndex = header.findIndex((value) => ["source_url", "url"].includes(value));
  for (const row of table.slice(1)) {
    if (textIndex >= 0 && row[textIndex]?.trim()) oldTexts.add(row[textIndex].trim());
    if (urlIndex >= 0 && row[urlIndex]?.trim()) oldUrls.add(row[urlIndex].trim());
  }
}
const smokeTexts = new Set([
  "부작용이 전혀 없습니다",
  "이 제품은 당뇨를 무조건 개선합니다",
  "한 달 만에 체지방 5kg 감량을 책임집니다",
  "이 사건은 무조건 승소합니다",
  "투자 원금을 6개월 안에 전액 회수합니다",
  "재택 부업으로 누구나 월 소득을 보장받습니다",
  "수강생 전원의 합격을 보장합니다",
  "배우자 몰래 메시지를 확인합니다",
  "상대방 몰래 감시 앱을 설치합니다",
  "국내 최고 승소율",
  "상가 입점이 확정됐습니다",
  "마지막 기회이니 지금 신청하세요",
  "예상 월 수입은 180만원입니다",
  "지난해 합격률은 95%였습니다",
  "메시지 데이터를 서버에 저장합니다",
  "부작용이 전혀 없다고 말할 수 없습니다",
  "무조건 승소 광고는 허위이므로 사용하지 마세요",
  "투자 원금은 보장되지 않습니다",
  "지난해 합격자 통계의 출처를 공개합니다",
  "몰래 위치를 추적하는 행위는 불법입니다",
  "사용자가 직접 자기 사진을 백업합니다",
  "오늘 매장은 오전 10시에 문을 엽니다",
]);
const oldTextOverlap = cases.filter((row) => oldTexts.has(row.original_text.trim()) || smokeTexts.has(row.original_text.trim()));
if (oldTextOverlap.length) throw new Error(`Prior text overlap: ${oldTextOverlap.map((row) => row.case_id).join(",")}`);
const oldUrlOverlap = cases.filter((row) => oldUrls.has(row.source_url));
if (oldUrlOverlap.length) throw new Error(`Prior URL overlap: ${[...new Set(oldUrlOverlap.map((row) => row.source_url))].join(",")}`);

const matrix = [headers, ...cases.map((row) => headers.map((header) => row[header]))];
const csv = csvText(matrix);
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, csv, "utf8");

// Artifact-tool import is the authoring/validation surface for the final CSV.
const workbook = await Workbook.fromCSV(csv, { sheetName: "Final Blind Cases" });
const inspection = await workbook.inspect({
  kind: "table",
  range: "Final Blind Cases!A1:P12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 16,
  maxChars: 12000,
});
const parsed = parseCsv(await fs.readFile(outputPath, "utf8"));
if (parsed.length !== 101 || parsed[0].length !== headers.length) {
  throw new Error(`Round-trip mismatch: ${parsed.length} rows, ${parsed[0]?.length ?? 0} columns`);
}

const sha256 = crypto.createHash("sha256").update(await fs.readFile(outputPath)).digest("hex");
console.log(JSON.stringify({
  outputPath,
  sha256,
  rows: cases.length,
  columns: headers.length,
  sourceTypeCounts,
  uniqueUrls: urls.size,
  domainCounts: countBy(cases.map((row) => row.domain)),
  expectedClassCounts: countBy(cases.map((row) => row.expected_class)),
  highConfidenceRisky: cases.filter((row) => row.expected_class === "risky" && row.label_confidence === "high").length,
  inspection: inspection.ndjson,
}, null, 2));
