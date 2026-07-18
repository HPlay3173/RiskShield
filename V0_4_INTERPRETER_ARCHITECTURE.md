# RiskShield v0.4 Interpreter 아키텍처

상태: 오프라인 프로토타입 구현 완료
운영 상태: 미연결·미배포

## 1. 범위와 경계

v0.4는 기존 규칙 엔진을 폐기하거나 보강하지 않는다. 기존 `analyzeText`는 위험 후보, 정책 도메인 후보, 원문 근거와 결정적 1차 점수를 제공한다. 별도 Interpreter가 같은 입력을 규칙 결과와 독립적으로 읽고 발화 목적과 문맥을 JSON으로 구조화한 뒤, 하이브리드 결합기가 두 결과를 비교한다.

이번 구현에서 변경하지 않은 표면:

- 기존 규칙 엔진과 스킬
- 운영 D1과 데이터 계약
- 운영 UI와 API
- Sites 프로젝트·배포 설정·비공개 URL
- 기존 평가 사례·라벨·결과

## 2. 오프라인 처리 흐름

```text
평가 입력
  ├─ 기존 analyzeText ──────────────── rules_only
  └─ 길이 제한 → 개인정보 마스킹 → Interpreter
                                      ├─ 엄격한 JSON 검증
                                      └─ interpreter_only
rules_only + 검증된 Interpreter JSON ── hybrid
```

규칙이 `no_match`여도 Interpreter를 실행한다. 프로토타입 정확도를 검증하기 전에는 호출 생략 최적화를 하지 않는다.

## 3. Interpreter 구현

공통 `RiskInterpreter` 인터페이스는 비동기 `interpret` 한 개만 공개한다.

| 구현 | 역할 | 외부 호출 |
|---|---|---:|
| `MockInterpreter` | 테스트용 결정적 의미 분류기 | 없음 |
| `RecordedInterpreter` | 입력 SHA-256으로 저장된 응답 재생 | 없음 |
| `LiveInterpreter` | 주입된 provider 호출, 타임아웃·오류 처리 | 있음 |

`LiveInterpreter`는 provider를 직접 알지 않는다. 현재 제공한 `OpenAiCompatibleProvider`만 환경 변수를 읽어 OpenAI-compatible JSON Schema endpoint를 호출한다. 다른 provider는 같은 `LiveProvider` 인터페이스를 구현하면 Analyzer나 결합기를 수정하지 않고 교체할 수 있다.

필수 환경 변수:

- `RISKSHIELD_INTERPRETER_ENDPOINT`
- `RISKSHIELD_INTERPRETER_API_KEY`
- `RISKSHIELD_INTERPRETER_MODEL`

선택 비용 변수:

- `RISKSHIELD_INTERPRETER_INPUT_USD_PER_MILLION`
- `RISKSHIELD_INTERPRETER_OUTPUT_USD_PER_MILLION`

비밀값은 코드, 결과 CSV, Recorded JSONL에 저장하지 않는다.

실행 명령:

```bash
npm run evaluate:v0.4
npm run evaluate:v0.4 -- --live
```

두 번째 명령은 364개 입력을 각 3회 Live 호출한다. 예상 비용과 호출량을 확인한 뒤에만 실행해야 하며, 세 실행의 원본 JSON·오류·timeout·결합 결과는 `artifacts/v0.4/live-interpreter-runs.jsonl`에 별도로 남긴다.

## 4. 개인정보 최소화

Interpreter 호출 전에 다음 패턴을 길이 보존 방식으로 `●` 마스킹한다.

- 이메일
- 한국 전화번호
- 연속 계좌번호 형태
- 주민·사업자 식별번호 형태
- `이름·성명·신청인·고객` 표식 뒤의 개인 이름
- `주소·거주지` 표식 뒤의 한국 주소

마스킹은 UTF-16 길이를 유지하므로 비민감 근거의 offset이 원문과 일치한다. evidence span이 마스킹 구간과 겹치면 응답 전체를 무효로 처리한다. 입력은 최대 2,000 UTF-16 code unit의 평가용 문장 범위로 제한한다.

영구 평가 로그에는 원문이나 마스킹된 전체 입력을 별도 필드로 저장하지 않는다. 다음만 남긴다.

- 입력 SHA-256
- 마스킹 여부
- provider·model·prompt·schema 버전
- 지연시간·토큰·추정 비용
- 검증된 Interpreter JSON
- 결합 결과

## 5. JSON 검증과 실패 처리

검증기는 다음을 모두 확인한다.

- 필수 10개 필드와 enum
- 추가 필드 부재
- `confidence` 0~1
- evidence UTF-16 offset의 입력 범위
- evidence text와 실제 모델 입력 substring의 일치
- evidence가 마스킹 구간과 겹치지 않음
- 직접 홍보 판단에 최소 1개의 검증된 evidence 존재

JSON 오류, 추가 필드, 근거 조작, timeout, provider 오류는 모두 실패 실행으로 반환하며 하이브리드 결합기에서 `review`로 보낸다.

## 6. 하이브리드 상태 결정

| 조건 | 결과 |
|---|---|
| 규칙 근거 + 직접 홍보 claim + supports + absolute/strong + confidence ≥ 0.82 | `high` |
| 규칙 no-match + AI 직접 홍보 | `review` |
| 규칙·AI 도메인 불일치 | `review` |
| JSON 오류·timeout·confidence < 0.55 | `review` |
| 제한적 직접 주장과 충분한 신뢰도 | `attention` |
| 경고·비판·보도·정의·인용의 contextual-only | `no_match` |
| 명시적 부정·정상 계약 조건의 고신뢰 contextual-only | `no_match` |
| 규칙과 직접 위험 주장 모두 없음 | `no_match` |

`no_match`는 안전 승인이나 게시 허가가 아니다. “현재 두 분석 계층에서 직접 위험 주장이 확인되지 않았다”는 검토 상태만 의미한다.

## 7. 오프라인 평가 자산

평가 파이프라인은 다음 364개 행을 읽기 전용 회귀 자산으로 사용한다.

| 자산 | 행 |
|---|---:|
| 기존 최종 세트 | 100 |
| v0.3.1 개발 세트 | 60 |
| v0.3.1 최종 신규 세트 | 50 |
| v0.1 fixture | 8 |
| v0.2 fixture | 71 |
| v0.3 fixture | 75 |

이들은 더 이상 블라인드 성능으로 부르지 않는다. 결과 CSV에는 원문 대신 데이터셋 접두사가 붙은 case ID와 분석 결과만 기록한다.

## 8. 현재 판정과 다음 홀드아웃

Recorded/Mock 기반 엔지니어링 게이트는 통과했지만 Live provider는 실행하지 않았다. 따라서 현재 통과는 스키마·결합·회귀 파이프라인의 동작성만 증명하며 실제 LLM 의미 품질, 지연시간, 비용을 증명하지 않는다.

다음 홀드아웃 설계는 다음과 같이 고정하되 Live pilot과 운영 상한 확정 전에는 수집·평가하지 않는다.

- 총 60건: 위험 24, 안전 24, 모호 12
- 6개 핵심 도메인마다 위험 최소 4건
- 공개 URL 최소 30개
- 경고·비판·보도·인용·정당한 조건 안전 사례를 합계 최소 18건
- 기존 모든 입력과 완전 일치 0건
- label과 평가 SHA-256을 실행 전에 동결
- LiveInterpreter를 같은 입력에 최소 3회 실행해 변동을 그대로 기록

Recorded 모드의 현재 회귀 상한은 P95 1ms, 평균 비용 USD 0으로 고정한다. Live 모드 상한은 실제 pilot 측정 뒤, 새 홀드아웃 실행 전에 별도로 고정해야 한다.

## 9. 운영 금지

현재 코드는 `app`, `/api/skills`, D1, Sites에 import되지 않는다. 로컬 평가 스크립트와 테스트에서만 실행된다. Live 의미 게이트와 신규 홀드아웃을 통과하기 전까지 운영 연결·배포를 허용하지 않는다.
