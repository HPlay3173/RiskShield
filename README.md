# RiskShield Skill Builder v0.1

광고 문구의 사회적·윤리적·법적 PR 위험을 사람이 검토할 수 있도록 조합형 패턴 스킬을 만들고, Analyzer v4가 읽을 다섯 파일을 생성하는 한국어 관리자 웹앱입니다.

RiskShield는 문구를 자동 승인하거나 금지하지 않습니다. 최종 판단은 담당자에게 있으며, 앱의 `MockInterpreter`는 외부 AI가 아닌 교체 가능한 규칙 기반 후보 생성기입니다.

## 제공 기능

- 사례 문구, 설명, 분야, 시기, 출처, 메모 입력
- MockInterpreter 기반 패턴 후보 생성 후 사람의 전체 필드 편집
- `all_of`, `any_of`, `none_of`, 문장·문단 범위, 최대 거리 조건
- 카테고리, 적용 분야, `severity_floor`, `dominant_risk`, 판단 근거, 오탐 설명, 대체 문구, 출처 검증 상태 편집
- `draft`, `reviewed`, `rejected` 검토 상태
- 기존 legacy `sample_risk_skills.jsonl`을 `risk_skill_schema/2.0.0`으로 변환
- 다섯 파일 가져오기와 재출력
  - `risk_skills.jsonl`
  - `trend_context.json`
  - `severity_rules.json`
  - `rewrite_templates.json`
  - `source_index.json`
- 검토 완료 번들만 읽는 Analyzer v4 최소 어댑터
- 관리자 선택 CSV를 최대 50건의 검토 후보로 만들어 D1 검토 큐에 저장

10,000행 원본 CSV는 저장소나 공개 웹 번들에 포함하지 않습니다. 관리자가 직접 선택한 파일은 브라우저에서만 후보 자료로 처리하며 자동 승인되지 않습니다.

## 데이터와 점수 계약

스킬 레코드는 `schema_version: 2.0.0`과 `revision`을 가집니다. 조건은 다음 의미를 사용합니다.

- `conditions.all_of`: 모든 의미 그룹에서 한 패턴 이상 일치
- `conditions.any_of`: 값이 있으면 그중 한 패턴 이상 추가 일치
- `conditions.none_of`: 같은 적용 범위에 있으면 제외
- `conditions.scope`: `sentence` 또는 `paragraph`
- `conditions.max_distance`: 서로 다른 증거 구간 사이의 최대 문자 거리

점수 정책의 소유 표면은 `severity_rules.json`입니다. 최종 점수는 카테고리 평균이 아니라 가장 높은 카테고리와 dominant 하한을 중심으로 계산하며, 적용 가능한 dominant 스킬이 있으면 해당 `severity_floor` 아래로 내려가지 않습니다.

## 로컬 실행과 검증

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

## 영구 저장과 배포

RiskShield는 `.openai/hosting.json`의 Cloudflare D1 바인딩 `DB`를 유일한 스킬 저장소로 사용합니다. 브라우저 `localStorage`, 메모리 폴백, 세션 전용 성공 처리는 사용하지 않습니다. 초기 샘플은 D1의 `risk_skills` 테이블이 비어 있을 때만 한 번 삽입됩니다.

- `GET /api/skills`: 저장된 스킬과 공통 점수 정책을 불러옵니다.
- `POST /api/skills`: 단일 스킬을 검증해 upsert합니다. UI는 D1 성공 응답 후에만 저장 완료 상태를 반영합니다.
- `PUT /api/skills`: CSV·번들 가져오기를 원자적으로 적용합니다. 기본값은 병합/upsert이며 전체 교체는 명시적 확인이 필요합니다.
- 상태, 출처, schema v2 조건, 점수, Dominant Risk, ID, revision, 한국어 원문을 왕복 보존합니다.
- 선언된 미지원 스키마와 HTTP(S)가 아닌 출처 URL은 데이터 변경 전에 거부합니다.

로컬에서도 기존 vinext 개발/preview 명령으로 실행해 `DB` 바인딩이 있는 환경에서 저장을 검증해야 합니다. D1 연결 실패를 브라우저 저장으로 대체하지 않습니다. 운영 환경은 기존 Sites 프로젝트와 바인딩을 유지하며 `drizzle/0001_persistent_import.sql`을 적용합니다. API 시작 시에도 이전 review-status 제약을 방어적으로 승격합니다.

이 저장소는 자동 배포하지 않습니다. 아래 검증을 마친 뒤, 별도로 승인된 비공개 배포 절차에서만 게시합니다.

검증 명령:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test`는 production build 뒤 다음 계약을 함께 검사합니다.

- 전달 자료의 8개 필수 사례와 최소 점수
- 단일 일반 단어, 명시적 부정, 제외 문맥 등 negative cases
- 문장·문단 범위, 거리, all/any/none 조건
- legacy sample 변환과 다섯 파일 round-trip
- `severity_rules.json` 정책 적용
- Builder export → Analyzer v4 adapter import → 분석 경로
- 실제 서버 렌더링 표면

## 주요 코드

- `lib/riskshield.ts`: 스키마, migration codec, 공통 분석 엔진, scoring, bundle import/export, MockInterpreter
- `lib/analyzer-v4-adapter.ts`: Analyzer v4 최소 번들 어댑터
- `app/RiskShieldWorkbench.tsx`: Skill Builder와 Analyzer 검증 UI
- `tests/`: 필수 사례, negative, round-trip, adapter와 렌더링 검증
- `PLAN.md`: 구현 결정, 편집 경계와 완료 증거

## 현재 범위

v0.2는 외부 AI API, API 키, 로그인, 공동 편집 또는 유료 API를 요구하지 않습니다. 저장 API가 연결되지 않으면 읽기·저장·가져오기 성공을 표시하지 않습니다. 법률 판단이나 출처 사실을 앱이 임의로 생성하지 않으며, 외부 배포는 별도 승인 범위입니다.
