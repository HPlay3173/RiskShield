# RiskShield v0.3 구현 보고서

## 범위

RiskShield v0.2 실사용 평가에서 확인된 누락과 문맥 오탐을 일반화 가능한 후보 스킬 및 절·문장 극성 처리로 개선했다. 기존 private Sites, URL·접근 정책, 운영 D1은 변경하거나 배포하지 않는다.

## 평가 데이터 감사

- 100개 case_id와 original_text 보존
- label_confidence/label_reason 열 정렬 복구: 73건
- expected_class 변경: 25건
- 원본 SHA-256: `5AAD27324385D0484819ABE15F8F5EE347F0F87AF4909D3D1E2D35CD4F83A7F0`
- 감사본 SHA-256: `3B632481CABF3FE4659D4422E763F082F62400B11AA7D71F14D82621D1966C03`

## 후보 스킬

- 총 15개
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
| high-confidence risky 탐지 | 29/29 (100.0%) | 80% 이상 |
| safe 오탐 | 0/39 (0.0%) | 5% 이하 |
| ambiguous high | 0/32 | 0 권장 |

| 핵심 사례 | 점수 | 상태 | 매칭 스킬 |
|---|---:|---|---|
| RW016 | 82 | high | risk_v03_health_body_result |
| RW018 | 88 | high | risk_v03_health_safety_absolute |
| RW024 | 82 | high | risk_v03_health_disease_effect |
| RW028 | 84 | high | risk_v03_education_outcome_promise |
| RW053 | 92 | high | risk_v03_privacy_covert_surveillance\|risk_v03_privacy_data_access_review |
| RW071 | 0 | no_match | 없음 |
| RW082 | 0 | no_match | 없음 |

## 신규 일반화 표본

- 총 75건
- 통과: 75건
- 오탐: 0건
- 누락·상태 불일치: 0건
- 기존 100개 original_text와 동일 문장: 0건(테스트에서 검증)

## UI

- 스킬 제작은 기존 6단계 마법사를 유지하고, Analyzer도 `1/2 광고 문구 입력 → 2/2 분석 결과 검토`로 화면 자체가 교체되도록 단순화했다.
- 입력 단계에는 결과를 표시하지 않고, 결과 단계에는 입력 폼을 남기지 않는다. `다른 문구 분석`으로 1단계에 돌아간다.
- no_match는 ‘규칙 미일치 또는 판단 불가’라는 중립 상태로 표시하고 초록색 성공 메시지나 안전 판정을 사용하지 않는다.
- review는 입증·추가 문맥이 필요한 중간 상태로 별도 표시한다.
- localhost에서만 `?candidate-preview=v0.3`로 draft 후보를 가상 검증하며 운영 호스트에서는 활성화할 수 없다.

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

모든 후보가 draft이므로 15개 전부 사람 검토가 필요하다. 우선 검토 대상은 높은 위해를 다루는 다음 9개다.

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
| `npm run typecheck` | PASS | TypeScript 오류 0 |
| `npm run lint` | PASS | ESLint 오류·경고 0 |
| `npm test` | PASS | 33/33, 실패 0 |
| 기존 v0.1 필수 8건 | PASS | risk-engine 회귀 테스트 |
| 기존 v0.2 47건 | PASS | 47개 fixture 보존, 명확 사례 44건과 review 변형 검증 |
| v0.2 일반화 변형 24건 | PASS | 24/24 |
| 저장·Import·Export 계약 | PASS | Analyzer v4 adapter, bundle round-trip, import preview 테스트 |
| `npm run build` | PASS | vinext production build, `/` 및 `/api/skills` 생성 |
| `git diff --check` | PASS | 오류 0, Windows 줄바꿈 안내만 존재 |
| Cloudflare/D1 production preview | PASS | `dist/server/wrangler.json` 기반 local Worker, `GET /api/skills` 200, `storage=d1`, 13개 중 reviewed 9개, schemaVersion 2.0.0 |
| 데스크톱 | PASS | 1440×1000 단계 1, high, no_match 화면 캡처 |
| 모바일 | PASS | 390×844 단계 1, review 화면 캡처 |

스크린샷:

- `artifacts/v0.3/screenshots/desktop-analyzer-step1-1440x1000.png`
- `artifacts/v0.3/screenshots/desktop-rw018-high-1440x1000.png`
- `artifacts/v0.3/screenshots/desktop-no-match-1440x1000.png`
- `artifacts/v0.3/screenshots/mobile-analyzer-step1-390x844.png`
- `artifacts/v0.3/screenshots/mobile-rw011-review-390x844.png`

로컬 preview는 placeholder D1과 프로젝트 로컬 Miniflare 상태만 사용했다. 기존 private Sites, 운영 D1, 기존 URL과 접근 정책에는 쓰기·배포를 수행하지 않았다.
