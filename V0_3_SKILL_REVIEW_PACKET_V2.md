# RiskShield v0.3.1 후보 스킬 사람 검토 패킷 v2

작성일: 2026-07-18
검토 대상: `artifacts/v0.3/candidate-risk-skills-v0.3.1.jsonl`의 draft 15개
운영 반영: 없음

## 승인 요약

| 처분 | 수 | 의미 |
|---|---:|---|
| `APPROVE_REVIEWED` | 9 | 사람 승인 후 별도 승격 절차를 진행할 수 있는 고신뢰 후보 |
| `APPROVE_REVIEW_ONLY` | 6 | 자동 high가 아닌 55~60점 REVIEW로만 사용하도록 승인 권고 |
| `REVISE` | 0 | 이번 검증에서 추가 수정이 필요한 후보 없음 |
| `REJECT` | 0 | 기각 후보 없음 |

이 표는 **승인 권고**다. JSONL의 `review_status`는 모두 `draft`이며 운영 번들·D1·Sites에는 반영하지 않았다.

## 후보별 최종 처분

| 후보 | floor | dominant | 최종 처분 | v0.3.1 판단 근거 |
|---|---:|---:|---|---|
| `risk_v03_health_safety_absolute` | 88 | true | `APPROVE_REVIEWED` | 부작용·위해성 + 절대 부재·제로·보장 조합, 의료법 출처, 음성 8·양성 5 통과 |
| `risk_v03_health_disease_effect` | 82 | true | `APPROVE_REVIEWED` | 질환 효능만으로 high 금지, 효능 + 절대성·확정성·보장·범위 과장 요구, 음성 8·양성 5 통과 |
| `risk_v03_health_body_result` | 82 | true | `APPROVE_REVIEWED` | kg를 trigger에서 제거, 구체 체중어와 별도 결과 증거 요구, 과거 기록·목표 제외 |
| `risk_v03_legal_outcome_promise` | 85 | true | `APPROVE_REVIEWED` | 가능성 표현 제거, 보장·무조건·확정·반드시·100%·결과 약속·단정만 high |
| `risk_v03_legal_substantiation` | 58 | false | `APPROVE_REVIEW_ONLY` | 경력·실적 사실은 입증 확인 대상이며 자동 high 금지 |
| `risk_v03_general_substantiation` | 58 | false | `APPROVE_REVIEW_ONLY` | 표시광고법 제5조에 따른 실증 확인용 REVIEW 유지 |
| `risk_v03_general_urgency` | 55 | false | `APPROVE_REVIEW_ONLY` | 실제 재고·일정·마감 조건 확인이 필요해 자동 high 금지 |
| `risk_v03_finance_return_recovery` | 85 | true | `APPROVE_REVIEWED` | 투자·원금·손실 + 보장·회수·전액 환불·보전 조합, 금융소비자보호법 출처 |
| `risk_v03_income_guarantee` | 60 | false | `APPROVE_REVIEW_ONLY` | 예상·평균·성과형 소득의 산정 근거 확인용 REVIEW로 역할 분리 |
| `risk_v03_income_universal_guarantee` | 82 | true | `APPROVE_REVIEWED` | 금액을 high 근거에서 제거하고 누구나·무조건·보장·확정·최소 보장만 요구 |
| `risk_v03_education_outcome_promise` | 84 | true | `APPROVE_REVIEWED` | 해결책·비율만으로 high 금지, 미래 전원·보장·무조건·반드시·약속 요구 |
| `risk_v03_education_substantiation` | 58 | false | `APPROVE_REVIEW_ONLY` | 합격률·최상급은 출처·산식 확인용 REVIEW 유지 |
| `risk_v03_privacy_covert_surveillance` | 86 | true | `APPROVE_REVIEWED` | 위치·통신 자산 + 몰래·비동의·감청·원격녹음 조합, 금지·비판 제외 |
| `risk_v03_privacy_stealth_install` | 84 | true | `APPROVE_REVIEWED` | 아이콘 숨김만으로 high 금지, 피감시자·비동의·상대방 몰래·감시 목적·설치 은폐·원격 감시 추가 요구 |
| `risk_v03_privacy_data_access_review` | 55 | false | `APPROVE_REVIEW_ONLY` | 데이터 접근은 동의·권한·보관·전송 확인용 REVIEW 유지 |

## 필수 수정 후보 검토 메모

### `risk_v03_health_disease_effect`

- 질환어는 뒤따르는 치료·개선·완화·예방·완치 등 효능 표현이 있어야 trigger가 된다.
- 별도 context에서 `100%`, `무조건`, `반드시`, `확실`, `완전히`, `보장`, `누구나`, 과도한 적용 범위를 요구한다.
- `변비 개선 효능을 소개합니다` 같은 단순 효능은 high가 아니다.
- 연구·논문·가능성·개인차·검진·과거 통계·비판·금지 문맥은 제외한다.

### `risk_v03_health_body_result`

- `kg`는 context에만 있어 같은 한 번의 출현이 두 의미 그룹을 동시에 만족할 수 없다.
- trigger는 다이어트·감량·체중·체지방·몸무게·허리둘레·뱃살·체형 및 경계가 있는 `살`로 제한했다.
- 목표·계획·희망·과거·기록·측정·현재 체중은 제외한다.

### `risk_v03_legal_outcome_promise`

- `받을 수 있다`, `될 수 있다`, `가능성`을 명시적으로 제외했다.
- 허용 신호는 보장·무조건·확정·반드시·100%·결과 약속·결과 단정에 한정했다.
- 과거 통계, 금지·비판·오도 설명은 제외한다.

### income 두 규칙

- `risk_v03_income_guarantee`: 예상·평균·최대·실적·성과·월 금액을 다루는 **REVIEW 전용** 규칙이다.
- `risk_v03_income_universal_guarantee`: 누구나·무조건·보장·확정·최소 보장이 있을 때만 high다.
- 정규직·근로계약·기본급·연봉·월급·고정급은 두 규칙에서 제외한다.
- `부업 월 200만원`, `예상 수입 월 180만원`은 high가 아니다.

### `risk_v03_education_outcome_promise`

- `해결책`, 단순 비율, `N명 중 N명`을 high context에서 제거했다.
- 전원·보장·무조건·반드시·미래 약속을 요구한다.
- 과거·지난·통계·집계·기록·출처·발표·심사 문맥은 제외한다.

### `risk_v03_privacy_stealth_install`

- trigger를 앱·설치·프로그램으로 제한하고, 별도 context에 피감시자·비동의·상대방 몰래·원격 감시/추적/녹음·감시 목적 은폐·설치 사실 은폐를 요구한다.
- `앱 아이콘을 숨깁니다`는 high가 아니다.
- 사용자 설정, 동의, 관리자, 보안, 접근성, 자기 기기, 금지·비판 문맥은 제외한다.

## 검증 근거

- 공식 출처: 15/15 후보 연결 완료. 상세는 `V0_3_SOURCE_VERIFICATION.md`.
- 적대 음성: 후보별 8개, 총 **120개** 모두 `no_match`.
- 신규 양성: dominant 후보 9개 × 5개, 총 **45개** 모두 `high`.
- 독립 블라인드: 80개, 위험 30·안전 30·경계 20.
- 위험 재현율: **100% (30/30)**.
- 안전 오탐률: **0% (0/30)**.
- 금지·비판 오탐: **0건**.
- 단순 금액·과거 통계·아이콘 숨김 과도 high: **0건**.
- 전체 자동 테스트: **40/40 통과**.

## 사람 승인 체크리스트

- [ ] 9개 `APPROVE_REVIEWED` 후보의 출처·표현 범위에 도메인 담당자가 동의한다.
- [ ] 6개 `APPROVE_REVIEW_ONLY` 후보를 dominant로 올리지 않는 데 동의한다.
- [ ] high 후보의 대체 문구가 실제 운영 정책과 충돌하지 않는지 확인한다.
- [ ] 승인 후에도 별도 번들 승격·D1 반영·배포 변경으로 관리한다.
- [ ] 승인 전에는 이 패킷의 draft JSONL을 운영 Analyzer에 넣지 않는다.
