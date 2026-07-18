# RiskShield v0.3.1 로컬 단기 보정 보고서

- 판정: **PASS — 기존 비공개 Sites 갱신 가능**
- 평가 시각: `2026-07-18T11:04:52.003Z`
- 동결 100건 SHA-256: `49b9316293815832965d29d9f52f4b52976d2307e7d66e827f62edd450c49659`
- 운영 Sites·D1 변경: **없음**

## 수정 범위

최종 독립 블라인드에서 확인된 실패 군집만 보정했다.

1. 모든 legacy 및 v0.3 규칙의 후보 match 뒤에 적용되는 공통 부정·경고·비판·인용 guard
2. 한국어 활용형과 의미 조합을 재사용하는 pattern variant 계층
3. 동일 문단 안에서 최대 인접 2문장까지만 허용하는 scope window
4. 건강·교육·법률·개인정보·금융 경고 오탐의 실패 군집 보정
5. 보험 비용 보장, 설치 미술, 정상 사용자 설정의 분야 경계

동결 100개 문장 전체 문자열 예외, 기대 라벨 변경, REVIEW 전용 규칙의 high 승격은 사용하지 않았다.

## 보호 조건 확인

- `artifacts/v0.3-final/final-blind-cases.csv`: 수정 없음
- `artifacts/v0.3-final/final-blind-results.csv`: 수정 없음
- `artifacts/v0.3-final/postmerge-d1-snapshot.json`: 수정 없음
- `artifacts/v0.3/candidate-risk-skills-v0.3.1.jsonl`: 수정 없음
- 원본 10,000행 CSV: 저장소·배포 미포함
- 운영 D1 계약: 전체 29개, reviewed 24개 유지
- REVIEW 전용 6개: non-dominant, severity floor 55~60 유지

## 동결 100건 로컬 재평가

| 지표 | 결과 | 기준 | 판정 |
|---|---:|---:|---|
| 고신뢰 risky 재현율 | 31/31, 100% | 85% 이상 | PASS |
| safe 오탐률 | 0/20, 0% | 5% 이하 | PASS |
| 금지·비판·경고 high 오탐 | 0 | 0 | PASS |
| 반복 불일치 | 0 | 0 | PASS |
| REVIEW 전용 primary high | 0 | 0 | PASS |

핵심 분야 risky 탐지율:

| 분야 | 탐지 | 탐지율 |
|---|---:|---:|
| 건강 | 6/7 | 85.7% |
| 금융 | 7/10 | 70.0% |
| 교육 | 8/9 | 88.9% |
| 법률 | 4/5 | 80.0% |
| 일반 | 8/9 | 88.9% |
| 개인정보 | 8/11 | 72.7% |

모든 핵심 분야가 60% 기준을 통과했다.

## 신규 개발 60건

- 위험 변형 30건
- 안전·부정·경고 20건
- 경계 10건
- 실패 군집 10개, 군집별 위험 변형 3건
- 동결 100건과 완전 일치 0건
- 명확 사례 50/50 통과, 100%
- 전체 60/60 통과

원본과 결과는 각각 다음에 기록했다.

- `artifacts/v0.3.1/development-cases.csv`
- `artifacts/v0.3.1/development-results.csv`
- `artifacts/v0.3.1/local-gate-metrics.json`

## 자동 검증

| 검증 | 결과 |
|---|---|
| 기존 전체 회귀 | PASS |
| 동결 최종 100건 | PASS |
| 신규 개발 60건 | PASS |
| 후보별 적대 음성 | PASS |
| 저장·Import·Export·D1 계약 | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS, 46/46 |
| `npm run build` | PASS |
| `git diff --check` | PASS |
| CSV 구조·오류 검사 | PASS |

## 배포 전 결정

로컬 종료 기준을 모두 충족했으므로 기존 비공개 Sites의 v0.3.1 갱신과 배포 후 신규 블라인드 50건 평가를 진행할 수 있다. 신규 블라인드가 최종 기준을 통과하기 전에는 v0.3.1 태그와 기능 동결을 확정하지 않는다.
