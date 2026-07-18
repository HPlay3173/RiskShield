# RiskShield v0.3 라벨 감사 보고서

## 감사 범위와 원칙

- 원본: `artifacts/real-world-evaluation/collected-ad-cases.csv`
- 감사본: `artifacts/v0.3/collected-ad-cases-audited.csv`
- 판단 표면: Analyzer에 실제 전달된 `original_text`만 사용
- 보존 조건: 100개 `case_id`와 `original_text`는 바꾸지 않음
- 금지 조건: 기존 Analyzer 결과를 보고 성능에 유리하게 라벨을 바꾸지 않음

## 무결성 결과

| 항목 | 결과 |
|---|---:|
| 원본 행 수 | 100 |
| 감사본 행 수 | 100 |
| 원본 SHA-256 | `5AAD27324385D0484819ABE15F8F5EE347F0F87AF4909D3D1E2D35CD4F83A7F0` |
| 감사본 SHA-256 | `3B632481CABF3FE4659D4422E763F082F62400B11AA7D71F14D82621D1966C03` |
| label_confidence/label_reason 정렬 복구 | 73건 |
| expected_class 변경 | 25건 |
| case_id 변경 | 0건 |
| original_text 변경 | 0건 |

## 열 어긋남 복구

73개 행에서 설명 문장이 `label_confidence`로 이동하고 `label_reason`이 비어 있었다. 설명을 `label_reason`으로 복원하고, 명백한 risky/safe는 `high`, 입증·문맥 확인이 필요한 ambiguous는 `medium`으로 정규화했다. 복구한 case_id는 다음과 같다.

RW009, RW010, RW011, RW012, RW013, RW014, RW015, RW016, RW017, RW018, RW020, RW021, RW022, RW023, RW024, RW025, RW026, RW027, RW028, RW030, RW031, RW032, RW033, RW034, RW035, RW036, RW038, RW039, RW040, RW041, RW042, RW043, RW044, RW045, RW046, RW047, RW048, RW049, RW050, RW051, RW052, RW053, RW054, RW055, RW056, RW058, RW062, RW063, RW065, RW066, RW067, RW069, RW070, RW071, RW072, RW073, RW074, RW075, RW076, RW077, RW078, RW079, RW080, RW081, RW082, RW083, RW084, RW085, RW086, RW087, RW088, RW089, RW090

## 라벨 변경 내역

| case_id | 변경 전 | 변경 후 | 변경 전 confidence | 변경 후 confidence | 감사 근거 |
|---|---|---|---|---|---|
| RW004 | ambiguous | safe | medium | high | 일반 할인 이벤트 안내만으로는 투자 위험이나 기만성을 판단할 수 없다. |
| RW011 | risky | ambiguous | 실적급 직무의 월소득을 확정적으로 보장한다. | medium | 근로·부업·실적급 맥락이 없어 월 200만원 보장이 정상 급여인지 소득 광고인지 원문만으로 확정할 수 없다. |
| RW020 | risky | ambiguous | 감량 결과를 사업자가 책임지는 보장으로 읽힐 수 있다. | medium | ‘책임감량제’라는 명칭만으로 보장 범위와 실제 효능 주장을 확정할 수 없어 추가 문맥이 필요하다. |
| RW021 | risky | ambiguous | 화장품 범위를 넘어 신체 구조 개선 효과를 주장한다. | medium | 모공 수 개선은 측정 기준과 제품 범위에 대한 입증이 필요한 주장이나 원문만으로 허위 여부는 확정할 수 없다. |
| RW032 | risky | ambiguous | 객관적 근거 없는 규모 최상급 표현이다. | medium | ‘가장 큰’은 비교 기준과 조사 범위를 확인해야 하는 최상급 표현이다. |
| RW033 | risky | ambiguous | 객관적 근거 없는 최고 표현이다. | medium | ‘최고의 강사’는 객관적 비교 기준과 입증 자료가 필요한 표현이다. |
| RW035 | risky | ambiguous | 전관 경력이 사건 결과에 특별한 영향력을 줄 수 있다는 인상을 준다. | medium | 판사 경력과 직접 진행 사실만으로 결과 영향력 암시 여부를 단정하기 어려워 주변 광고 문맥이 필요하다. |
| RW036 | risky | ambiguous | 근거 없는 최상급 비교 표현이다. | medium | ‘제일 잘한다’는 비교 대상과 근거를 확인해야 하는 주관적 최상급 표현이다. |
| RW039 | risky | ambiguous | 검증 근거 없는 최고 승소율 주장이다. | medium | ‘국내 최고 승소율’은 산정 기간·모수·비교 범위를 확인해야 하는 입증 필요 주장이다. |
| RW040 | risky | ambiguous | 유일성을 객관적으로 입증하기 어려운 독점적 표현이다. | medium | ‘유일한’이라는 독점 표현은 객관적 비교 범위와 등록 현황 확인이 필요하다. |
| RW042 | risky | ambiguous | 산정 기준이 없는 고승소율 수치로 결과 기대를 부풀린다. | medium | 승소율 99%는 산정 기준과 사건 범위를 확인해야 하며 원문만으로 허위 여부를 확정할 수 없다. |
| RW055 | risky | ambiguous | 타인의 실시간·저장 데이터를 확인하는 감시 기능을 암시한다. | medium | 데이터 열람·저장은 정상적인 본인 기능일 수도 있어 대상·동의·권한 문맥이 필요하다. |
| RW062 | risky | ambiguous | 공인 등급이 없는 상품에 특급 등급이 있는 것처럼 표시할 수 있다. | medium | ‘특급호텔’은 공식 등급 또는 상품 설명의 진위를 외부 자료로 확인해야 한다. |
| RW063 | risky | ambiguous | 사실과 다른 거래 우선권을 제시해 구매 결정을 유도한다. | medium | 특정지역 우선권은 실제 공급 조건과 공고 근거가 있어야 사실 여부를 판단할 수 있다. |
| RW065 | risky | ambiguous | 객관적 실적과 다른 높은 완료율을 제시한다. | medium | 95% 분양완료는 기준일과 계약 집계 자료가 필요한 사실 주장이다. |
| RW066 | risky | ambiguous | 근거 없는 희소성과 시간 압박으로 구매를 재촉한다. | medium | 신청 기한이 실제로 임박했을 수 있어 일정과 수량 근거를 확인해야 한다. |
| RW067 | risky | ambiguous | 분양 결과를 100% 완료로 단정한다. | medium | 100% 분양은 기준일과 계약 완료 자료를 확인해야 하는 실적 주장이다. |
| RW069 | risky | ambiguous | 전국 최고라는 비교 우위를 근거 없이 단정할 수 있다. | medium | 전국 최고 경쟁률은 비교 대상·기간·집계 기준에 대한 입증이 필요하다. |
| RW070 | risky | ambiguous | 체결되지 않은 입점을 확정 사실처럼 제시한다. | medium | 은행지점 입점확정은 계약 또는 공식 발표를 확인해야 하는 외부 사실 주장이다. |
| RW037 | ambiguous | safe | medium | high | 소속 변호사의 무료 상담 가능성을 안내할 뿐 결과나 효능을 보장하지 않는다. |
| RW093 | ambiguous | safe | medium | high | 패키지 상품에 별도 규정이 적용됨을 알리는 조건 안내다. |
| RW094 | ambiguous | safe | medium | high | 할인쿠폰의 적용 제한 가능성을 명시한 조건 안내다. |
| RW095 | ambiguous | safe | medium | high | 할인쿠폰 중복 사용 제한을 명시한 정상 조건 안내다. |
| RW097 | ambiguous | safe | low | high | 개인적 추천 의사 표현만으로 위험 주장이나 기만 요소를 판단할 수 없다. |
| RW099 | ambiguous | safe | high | high | 광고 포함 여부를 표시하는 고지 문구이며 위험 기능이나 효능을 주장하지 않는다. |

## 감사 결론

- 원문만으로 위험성이 명백한 절대 보장·침해 기능은 risky를 유지했다.
- 최상급·완료율·입점확정·우선권처럼 외부 자료가 필요한 주장은 ambiguous로 분리했다.
- 정상 조건·고지·개인 의견은 safe로 정리했다.
- 감사본은 개발 표본이며 최종 블라인드 성능으로 해석하지 않는다.
