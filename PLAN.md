# RiskShield Skill Builder v0.1 실행 계획

## 기준과 결정

- Analyzer 기준은 전달 패키지의 v4이며 `06_deprecated_reference_only`의 v7/v8은 수정하거나 구현 기반으로 복사하지 않는다.
- 현재 vinext/React/TypeScript 구조와 한국어 관리자 UI를 유지한다. 서버·로그인·외부 AI API는 추가하지 않으며 기존 저장 API가 없을 때도 브라우저 세션에서 모든 핵심 흐름이 작동해야 한다.
- 공개 데이터 계약은 `risk_skill_schema/2.0.0`으로 올린다. 기존 trigger/context 배열은 안전하게 마이그레이션하고, 정규화된 조건은 `all_of`, `any_of`, `none_of`, `scope(sentence|paragraph)`, `max_distance`를 가진다.
- 점수는 `severity_rules.json`에서 읽는 Dominant Risk 정책으로 계산한다. 평균은 사용하지 않고 적용 가능한 dominant 스킬의 `severity_floor`를 최종 하한으로 유지한다.
- Analyzer v4 경로는 별도 어댑터가 검토 완료된 번들과 점수 정책을 읽어 공통 엔진을 호출하는 최소 통합으로 만든다. Builder 미리보기만 초안을 포함할 수 있다.
- MockInterpreter는 규칙 기반 후보 생성기이며 자동 승인·금지·법률 판단으로 표현하지 않는다. `draft`, `reviewed`, `rejected`를 사람의 검토 상태로 관리한다.
- 10,000행 CSV 3개는 브라우저에서 관리자가 선택한 후보 자료로만 읽고 공개 번들 또는 저장소에 복사하지 않는다. 민감 원문은 목록에 대량 노출하지 않는다.
- Sites는 로컬 빌드와 실제 브라우저 검증 뒤 비공개 프리뷰까지만 준비하며 공개/프로덕션 배포는 하지 않는다.

## 구현 순서

1. 스키마 v2, legacy 변환기, 설정 기반 scoring, five-file bundle parser/serializer와 Analyzer v4 어댑터를 구현한다.
2. 기존 8개 대표 스킬을 데이터로 유지하되 테스트 입력별 결과 분기는 만들지 않는다.
3. 관리자 UI에 메모, all/any/none 조건, 범위, 거리, 분야·태그, 출처·검증 상태, 전체 해석 필드, rejected 상태, JSONL/JSON 번들 재가져오기를 추가한다.
4. import → edit → export → re-import 정보 보존, 기존 sample JSONL 변환, 8개 필수 사례, 부정·경계 사례, severity 정책과 Analyzer 어댑터를 단위 테스트한다.
5. typecheck, lint, unit tests, production build를 통과시킨 뒤 데스크톱·모바일에서 입력, Mock 해석, 편집, 상태 변경, 번들 가져오기/내보내기, Analyzer 분석, 빈 상태·오류·긴 값 흐름을 직접 검수한다.

## 편집 경계

`EDIT_PATHS`

- `PLAN.md`
- `package.json`
- `README.md`
- `lib/riskshield.ts`
- `lib/analyzer-v4-adapter.ts`
- `app/RiskShieldWorkbench.tsx`
- `app/globals.css`
- `app/api/skills/route.ts` (스키마 호환이 필요할 때만)
- `tests/risk-engine.test.ts`
- `tests/bundle-roundtrip.test.ts`
- `tests/analyzer-v4-adapter.test.ts`
- `tests/fixtures/sample_risk_skills.jsonl`
- `tests/fixtures/test_cases_expected_behavior.csv`
- `types/cloudflare.d.ts`

`PROTECTED_PATHS`

- 전달 ZIP, 첨부 DOCX, 원본 CSV 3개와 그 상위 폴더
- `06_deprecated_reference_only/**`
- `.git/**`, `node_modules/**`, `.vinext/**`, `.wrangler/**`
- 생성 산출물 `dist/**`, `build/**`, `outputs/**`, `work/**`
- 위 `EDIT_PATHS`에 명시하지 않은 기존 파일

## 완료 증거

- 데이터 계약과 UI를 통한 다섯 파일의 생성·가져오기·수정·재출력
- 고정 기대값 분기 없이 공통 엔진으로 계산한 8개 필수 사례 통과
- 일반 단어, 명시적 부정, 문장·문단·거리·제외 조건 경계에서 고위험 오탐이 없는 테스트
- 현재 소스에서 typecheck, lint, unit tests, production build 통과
- 실제 렌더러에서 데스크톱·모바일 주요 흐름과 오류/빈/긴 값 상태 확인
- Analyzer v4 어댑터가 내보낸 검토 완료 번들을 다시 읽어 분석하는 통합 테스트 통과
