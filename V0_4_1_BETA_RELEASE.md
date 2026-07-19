# RiskShield v0.4.1 AI-assisted private beta

## 릴리스 식별 정보

- 제품명: RiskShield v0.4.1 AI-assisted private beta
- 비공개 URL: https://riskshield-studio.horari.chatgpt.site/
- Sites 배포 버전: 15
- Sites 프로젝트: `appgprj_6a590e98034c8191af5393c355cbe739`
- 배포 커밋: `f96cab5356d63b77cb0b82b3531c44dbf34a1b0e`
- Interpreter 모델: `gemma-4-26b-a4b-it`
- Interpreter Schema: `1.1.0`
- 릴리스 단계: private beta

## 운영 데이터 스냅샷

마지막 정상 확인은 2026-07-19 10:29 KST의 배포 후 운영 UI 검증이다.

| 상태 | 개수 |
|---|---:|
| 전체 | 29 |
| reviewed | 24 |
| draft | 4 |
| rejected | 1 |

이번 릴리스 정리에서는 D1 조회·쓰기·migration을 수행하지 않았다. 위 수치는 마지막 정상 운영 스냅샷을 기록한 것이며, 이번 작업에서 새로 갱신한 값이 아니다.

## Schema 버전 계약

- Schema 1.0.0 fixture와 기존 v0.4 schema·recording 산출물은 legacy compatibility fixture로 보존한다.
- 현행 strict validator는 Schema 1.0.0 입력을 자동 마이그레이션하지 않으며 명시적으로 거부한다.
- Schema 1.1.0은 `policy_relevance`와 `risk_family`를 필수 필드로 검증한다.
- 1.0.0 버전에 1.1.0 필드를 섞거나, 1.1.0 버전에 1.0.0 형식을 사용하는 혼합 응답은 거부한다.
- provider 계약은 `evidence_quotes`를 받고, 검증된 내부 결과는 결정적으로 계산한 UTF-16 `evidence_spans`를 유지한다.

## 주요 결합 정책

- 규칙이 `no_match`이고 검증된 AI 결과가 `policy_relevance=none`이며 confidence 기준을 충족하면 `no_match`다. 광고성 발화 자체만으로 review로 올리지 않는다.
- 규칙이 `no_match`여도 AI-only `substantiation` 또는 `potentially_high` 후보는 담당자 `review`로 보낸다.
- `high`는 구체적인 규칙 증거, 직접 홍보 claim, `potentially_high`, 동일한 위험 분야, `supports`, absolute/strong, confidence 기준을 모두 충족해야 한다. AI-only 결과는 `high`가 되지 않는다.
- 경고·비판·보도·정의 문맥이 엄격한 억제 조건을 충족하고 CTA 또는 역전 홍보 절이 없으면 규칙 high를 `no_match`로 억제할 수 있다.
- JSON·evidence 검증 실패, provider timeout·429·오류, 낮은 confidence와 규칙·AI 위험 분야 충돌은 `review`로 전환한다.

## BETA_OK 근거

- 기존 beta 30건의 review가 28건에서 22건으로 감소했다.
- unnecessary review가 6건에서 1건으로 감소했다.
- BETA027과 BETA028은 목표대로 `no_match`였다.
- 일반화 20건은 20/20 PASS였고 일반·절차·과거 정보의 불필요 review는 0/14였다.
- 직접 고위험 3건은 모두 review 이상이었고 안전 문구의 false high는 0건이었다.
- 배포 후 기존 비공개 URL의 11개 운영 UI 시나리오는 모두 목표 범위에 들어왔다.
- 릴리스 정리 검증은 typecheck, lint, 67개 전체 테스트, production build, `git diff --check`를 모두 통과했다.

## 현재 제한 사항

- 이 버전은 소규모 private beta 결과에 기반하며 시장 전체 성능을 대표하지 않는다.
- 입력 자체에 과거 사례임을 알 수 있는 문맥이 부족한 BETA019는 안전하게 review에 남는다.
- provider 지연이 전체 처리 시간의 대부분을 차지하며, 15초 provider 요청 단계에서 timeout이 발생할 수 있다.
- provider timeout·429·오류와 JSON/evidence validation 실패는 결과를 숨기거나 high로 승격하지 않고 review fallback으로 처리한다.
- 모델 판단에는 변동성과 문맥 오해 가능성이 있으므로 담당자의 최종 확인이 필요하다.

## 사용 고지

RiskShield는 자동 승인·자동 차단 도구가 아니다. 광고 문구의 위험 후보와 검토 근거를 정리하는 AI 보조 도구이며, 최종 판단과 조치는 담당자가 수행해야 한다.

## 이번 정리 작업의 변경 보호

- Interpreter 프롬프트와 결합 정책: 변경 없음
- 제품 코드와 스킬: 변경 없음
- D1 데이터와 schema: 변경 없음
- Sites 배포와 접근 정책: 변경 없음
- API secret: 변경 없음
