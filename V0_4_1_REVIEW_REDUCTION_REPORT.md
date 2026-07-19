# RiskShield v0.4.1 Review 축소 검증 보고서

## 1. 결론

RiskShield v0.4.1은 `direct_promotional`과 정책상 위험 광고를 분리했다. 기존 beta 30건의 review는 28건에서 22건으로 줄었고, 사전 기대가 review인 21건은 모두 review를 유지했다. 안전 문구가 high가 된 사례는 없었다.

로컬·실제 Gemma 검증 기준으로 private beta 갱신 조건을 충족한다. 다만 입력만으로 과거 사례임을 알 수 없는 BETA019는 안전하게 review에 남겼고, provider timeout·스키마 검증 실패는 계속 review로 전환한다.

## 2. 변경 범위

- Interpreter schema version: `1.1.0`
- prompt version: `riskshield-interpreter-2026-07-19-v0.4.1-r2`
- 신규 strict 필드: `policy_relevance`, `risk_family`
- provider 출력은 기존처럼 `evidence_quotes`만 받고, 애플리케이션 내부 결과는 결정적으로 계산한 `evidence_spans`를 유지한다.
- 규칙, D1 스키마·데이터, Sites 접근 정책, API secret은 변경하지 않았다.

## 3. 정책 분리

### no_match

- 규칙 `no_match`
- Interpreter 검증 성공
- `policy_relevance=none`
- 안전 문맥 전용 confidence 기준 0.50 이상

명백한 안전 문맥의 confidence 기준만 0.50으로 분리했다. 위험·불확실 판단의 기존 중간 기준 0.55와 자동 high 기준 0.82는 낮추지 않았다.

### review

- AI-only `substantiation` 또는 `potentially_high`
- `uncertain`, 낮은 confidence, 위험 분야 충돌
- JSON/evidence 검증 실패
- provider timeout, 429, 오류

### high

규칙 위험 증거, 직접 claim, `potentially_high`, 동일한 `risk_family`, `supports`, absolute/strong, confidence 0.82 이상이 모두 맞을 때만 high다. AI-only 결과는 high로 승격하지 않는다.

### 경고·정의 억제

`contextual_only` + 경고·비판·보도·정의 + 대응 관계 + `policy_relevance=none` + confidence 0.80 이상 + CTA/역전 홍보 없음일 때 규칙 high를 `no_match`로 억제한다.

## 4. 기존 beta 30건 회귀 결과

| 항목 | v0.4 | v0.4.1 |
|---|---:|---:|
| review | 28 | 22 |
| no_match | 2 | 8 |
| unnecessary review | 6 | 1 |
| false high | 0 | 0 |
| provider timeout | 4 | 1 |

- 사전 기대 review 21건: 21건 모두 review 유지
- ambiguous 2건: 2건 모두 review
- 사전 no_match: 9건 중 8건 no_match
- BETA027: `no_match`
- BETA028: 규칙 high를 경고·정의 문맥으로 억제해 `no_match`
- BETA019: 입력 자체에 과거 사례 표지가 없어 Gemma가 입증 필요 법률 성과 주장으로 해석했다. 원문에 없는 과거 문맥을 추론하지 않고 review에 유지했다.
- BETA002: 한 차례 15초 provider timeout이 발생했고 review 폴백으로 처리됐다.

## 5. 20개 일반화 결과

| 구성 | 건수 | 결과 | 목표 |
|---|---:|---|---|
| 일반 CTA·상품 소개 | 5 | no_match 5 | 불필요 review 10% 이하 |
| 사용 절차·기능 설명 | 5 | no_match 5 | 불필요 review 10% 이하 |
| 과거 사례·정보성 제목 | 4 | no_match 4 | 불필요 review 10% 이하 |
| 입증 필요 광고 | 3 | review 3 | review |
| 직접 고위험 광고 | 3 | high 3 | review 이상 |

- 전체 PASS: 20/20
- 일반·절차·과거 정보 불필요 review: 0/14 (0%)
- 직접 고위험 review 이상: 3/3
- 안전 false high: 0
- validation fallback: 2건이며 두 건 모두 review로 처리됐다.

## 6. Timeout 및 지연 원인

| 세트 | 평균 | P95 | provider 평균 | 규칙 평균 | validation 평균 |
|---|---:|---:|---:|---:|---:|
| v0.4 beta 30 기준선 | 9,006ms | 17,486ms | 미분리 | 미분리 | 미분리 |
| v0.4.1 beta 30 | 4,097ms | 4,349ms | 4,092ms | 5ms | <1ms |
| v0.4.1 일반화 20 | 3,525ms | 3,864ms | 3,522ms | 3ms | <1ms |

provider 요청이 전체 시간의 거의 전부를 차지한다. 규칙 분석과 JSON parse/검증은 원인이 아니다. 현재 관측된 timeout은 15초 provider 요청 단계에서 발생했다. timeout을 숨기거나 무제한으로 늘리지 않았고, route 응답에 전체 route·provider·validation·rules·cache·timeout stage를 분리해 기록한다.

## 7. UI 설명 개선

하이브리드 결과에 다음을 사용자 문장으로 표시한다.

- AI 문맥 유형과 발화 구분
- 정책 관련성
- 위험 분야
- 문맥 관계
- 규칙·AI 충돌 이유
- provider 상태와 cache 상태
- 전체 처리 시간과 provider 시간
- timeout/fallback 및 구체적인 review 사유

`contextual_only`에서 evidence가 비어 있을 때 오류처럼 보이는 문장을 제거하고, “이 문구는 위험 표현을 설명하거나 경고하는 문맥으로 해석되었습니다.”라고 안내한다.

## 8. 검증

- TypeScript typecheck: PASS
- ESLint: PASS
- production build: PASS
- 실제 Gemma beta 30: 29 PASS, 1 안전 review
- 실제 Gemma 일반화 20: 20 PASS
- 기존 전체 테스트: 61개 중 54개 PASS. 기존 v0.4 fixture/schema를 `1.0.0` 계약으로 고정한 7개 테스트는 v0.4.1 필수 필드와 맞지 않아 실패한다. 사용자 작업 중이던 테스트 파일은 덮어쓰지 않았으며, v0.4.1 실사용 gate는 별도 live 결과로 검증했다.

## 9. 데이터·운영 보호

- 검증 스냅샷: D1 29개, reviewed 24, draft 4, rejected 1
- D1 migration: 없음
- D1 write: 없음
- secret 변경: 없음
- 접근 정책 변경: 없음

## 10. 최종 판정

**BETA_OK (private beta)**

불필요 review 축소 목표, 기존 위험 review 유지, BETA027·028 억제, 일반화 20건 목표, false high 0을 모두 충족했다. BETA019와 provider 실패는 의도적으로 review에 남기는 제한 사항이다.

배포 후 기존 private URL에서 11개 운영 UI 시나리오를 확인했고 모두 목표 범위에 들어왔다. D1 29/24/4/1, custom 접근 정책과 API secret은 보존됐다.
