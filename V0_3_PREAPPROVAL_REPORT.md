# RiskShield v0.3.1 사전 승인 검증 보고서

검증일: 2026-07-18
목적: v0.3 draft 후보 15개를 사람 승인 가능한 v0.3.1 패킷으로 보강
운영 변경: 없음

## 결과 요약

| 항목 | 결과 |
|---|---:|
| 출처 검증 후보 | 15/15 |
| 필수 로직 수정 후보 | 7개 |
| 보조 정밀화 포함 규칙 수정 | 12개 |
| `APPROVE_REVIEWED` 권고 | 9개 |
| `APPROVE_REVIEW_ONLY` 권고 | 6개 |
| `REVISE` | 0개 |
| `REJECT` | 0개 |
| 적대 음성 | 120/120 통과 |
| 신규 high 양성 | 45/45 통과 |
| 신규 블라인드 | 80/80 판정 목표 통과 |
| 전체 자동 테스트 | 40/40 통과 |

## 변경 범위

기존 `candidateSkillsV03`과 기존 v0.3 JSONL·100건 감사자료·75건 일반화 자료는 보존했다. v0.3.1은 다음 별도 계층으로 추가했다.

- `lib/v0-3-1-candidate-skills.ts`
- `artifacts/v0.3/candidate-risk-skills-v0.3.1.jsonl`
- `scripts/build-v0-3-1-preapproval.mjs`
- `scripts/evaluate-v0-3-1-preapproval.mjs`
- `tests/v0-3-1-preapproval.test.ts`

필수 수정 7개는 `health_disease_effect`, `health_body_result`, `legal_outcome_promise`, income 2개, `education_outcome_promise`, `privacy_stealth_install`이다. 적대 검증 중 확인한 활용형·비판 문맥 정밀도를 위해 `health_safety_absolute`, `finance_return_recovery`, `general_substantiation`, `privacy_covert_surveillance`, `privacy_data_access_review`도 보조 조정했다.

## 독립 블라인드 절차

1. 작성 프로세스 `authoring-v0.3.1-pre-evaluation`에서 80개 문장, 기대 클래스, 이유, 제어 태그를 먼저 고정했다.
2. 기존 100건의 `original_text`와 기존 75건의 `input`을 비교해 완전 일치 중복이 없음을 빌드 단계에서 확인했다.
3. 동결 파일 SHA-256은 `bdb1acbbc877fc8fbb108b17b953bb332cdc7697227e06044ff812c5993d6002`다.
4. 별도 프로세스 `evaluation-v0.3.1-post-freeze`가 동결 CSV를 읽어 Analyzer를 실행하고 결과 CSV를 생성했다.
5. 평가 스크립트는 기대 라벨을 수정하지 않으며, 각 결과 행에 동결 해시와 평가 프로세스를 기록한다.

## 블라인드 80건 결과

| 지표 | 목표 | 실제 | 판정 |
|---|---:|---:|---|
| high-confidence risky 재현율 | ≥85% | **100% (30/30)** | PASS |
| safe 오탐률 | ≤5% | **0% (0/30)** | PASS |
| 금지·비판 문맥 오탐 | 0 | **0** | PASS |
| 단순 금액·과거 통계·아이콘 숨김 과도 high | 0 | **0** | PASS |
| ambiguous 과도 high | 0 권고 | **0/20** | PASS |
| 전체 기대 판정 실패 | 0 | **0/80** | PASS |

분포는 risky 30, safe 30, ambiguous 20이다. 결과 원본은 `artifacts/v0.3/preapproval-blind-results.csv`, 요약 수치는 `artifacts/v0.3/preapproval-blind-metrics.json`에 있다.

## 적대 검증

- 15개 후보마다 최소 8개 음성 문장을 코드에 고정했다.
- 근거 있는 사실, 과거 통계, 위험 표현 비판, 금지·불법 안내, 정상 급여, 동의 기반 데이터, 단순 일정·마감, 동일 키워드의 다른 의미를 후보별 세트에 포함했다.
- 총 120개 음성은 후보를 단독 활성화한 상태에서 모두 `no_match`였다.
- dominant 후보 9개마다 5개 신규 양성 변형을 추가했고 총 45개가 모두 각 floor의 `high`였다.

## 기존 회귀 및 빌드

| 검증 | 결과 |
|---|---|
| `npm test` | 40/40 통과; v0.1/v0.2/v0.3 및 v0.3.1 포함 |
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm run build` | 로컬 production build 통과 |
| 기존 v0.3 75건 일반화 | 기존 테스트 그대로 통과 |
| 기존 v0.3 핵심 실사용 7건 | 기존 테스트 그대로 통과 |

## 운영 보호 확인

- 운영 D1 스키마·데이터·마이그레이션을 변경하지 않았다.
- private Sites와 기존 URL을 변경하거나 배포하지 않았다.
- 앱의 운영 starter skill 목록에 v0.3.1을 연결하지 않았다.
- 후보 15개는 JSONL과 TypeScript 모두 `draft`다.
- test-only adapter에서만 검증을 위해 복제본을 `reviewed`로 활성화했다.

## 운영 승격 판단

**기술 검증 기준으로는 사람 승인 대기 상태까지 준비됐다. 현재는 운영 승격 불가다.**

사람이 패킷 v2의 9개 `APPROVE_REVIEWED`와 6개 `APPROVE_REVIEW_ONLY` 처분을 승인한 뒤, 별도의 운영 승격 작업에서 reviewed 상태 저장·번들 갱신·D1 반영·배포 여부를 다시 결정해야 한다. 이번 작업은 그 변경을 수행하지 않았다.
