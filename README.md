# RiskShield Studio v0.5 Alpha

RiskShield는 한국어 문장과 글에서 과장·기만, 혐오·차별, 욕설·공격, 숨은 커뮤니티 은어, 폭력·위협, 개인정보 침해 등 검토가 필요한 표현을 맥락과 함께 찾는 위험 분석 도구입니다.

현재 버전은 **검증 중인 알파 제품**입니다. 출력 점수는 법률 판단이나 위법성 확정이 아니며, 규칙 결과와 AI 문맥 해석을 사람이 검토하기 위한 보조 신호입니다. `no_match` 역시 안전을 보장하지 않습니다.

- 라이브 사이트: https://riskshield-studio.horari.chatgpt.site
- 제품 브랜치: `riskshield/v0.5-product`
- 상태: `v0.5.0-alpha.1`

## 제품 구조

### 공개 Analyzer

`/`와 `POST /api/analyze`는 로그인 없이 사용할 수 있습니다.

- D1의 `reviewed` 스킬만 사용하는 규칙 분석
- 문장·문단 범위, 거리, 제외 조건과 문맥 억제
- 선택적 Google Gemma 문맥 해석
- 규칙·AI 충돌 또는 AI 단독 고위험 결과의 사람 검토 전환
- 최대 20개 문장·주장 구간의 전체 규칙 분석과 위험도가 높은 최대 6개 구간의 AI 문맥 분석
- AI 선택 구간 수와 실제 성공 수를 분리하고 일부 실패는 `partial`로 표시
- 가장 위험한 독립 주장 하나를 최종 점수로 사용하고 나머지 위험 주장은 별도 목록으로 표시
- 정확한 evidence 구간, 대체 문구, 불확실성 및 fallback 표시
- 요청 취소·재시도, 키보드와 모바일 접근성
- 내부 스킬 전체, matcher 패턴, prompt와 provider 원문은 공개 응답에서 제외

호환 API인 `/api/skills`는 모든 메서드에서 `410 Gone`을 반환합니다.

### 통합 관리 콘솔

`/manage/*`는 Google OIDC로 보호됩니다. 현재 운영은 서버 환경에 등록된 단일 관리자 이메일만 허용합니다.

기본 메뉴는 학교 프로젝트의 핵심 흐름 다섯 개만 제공합니다.

- `/manage`: 현재 상태와 다음 작업
- `/manage/review`: 검증된 후보 검토
- `/manage/skills`: 활성 위험 규칙과 초안
- `/manage/materials`: CSV·공개 글 자료 등록과 후보 생성 연결
- `/manage/test`: 규칙 엔진 탐지·오탐 테스트

자동 커뮤니티 관찰·모델·추세는 `/manage/labs`, 팀원·권한과 변경 기록은 `/manage/settings`로 분리합니다. 공개 글 직접 등록은 `/manage/materials/public`, 자동 관찰 설정은 `/manage/labs/collect`에서 서로 섞이지 않게 제공합니다.

기존 `/admin/*`, `/dev/*`, `/owner/*` 경로는 호환 경로이며 제품의 기준 namespace는 `/manage/*`입니다.

## 분석 흐름

```text
입력 문구
  ├─ reviewed 규칙 엔진
  └─ 선택적 Gemma Interpreter
          ↓
claim·문맥·evidence 계약 검증
          ↓
모든 구간 규칙 분석 + 상위 6개 구간 AI 분석
          ↓
최고 위험 주장 점수 + 다른 위험 주장 목록
```

현재 0–100 계산은 서버에서 결정론적으로 수행되지만, AI가 평가한 축은 모델 판단입니다. 공개 Analyzer는 규칙 전용 평가에서 만든 calibration을 적용하지 않습니다. 따라서 숫자를 경험적으로 보정된 확률이나 법률적 위험도로 해석하면 안 됩니다.

## 로컬 실행

요구 환경:

- Node.js 22.13 이상
- npm

```bash
npm ci
npm run dev
```

기본 주소는 실행 로그를 따릅니다. 로컬 관리 fixture는 개발 환경·loopback host·명시적 환경 설정이 모두 충족될 때만 활성화됩니다.

주요 운영 환경 변수:

- `RISKSHIELD_INTERPRETER_API_KEY`: 선택적 Gemma Interpreter
- `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET`: Google 로그인
- `RISKSHIELD_SESSION_SIGNING_KEY`: 관리 세션 서명
- `RISKSHIELD_CANONICAL_ORIGIN`: OAuth 기준 origin
- `RISKSHIELD_MANAGER_EMAILS`: 쉼표로 구분한 관리자 이메일 허용목록

비밀값은 저장소나 `.openai/hosting.json`에 기록하지 않습니다.

## 데이터와 저장소

- D1: 운영 스킬, 설정, 후보, 수집 관찰, 검색 검증 쿨다운 및 관리 데이터
- CSV: 브라우저에서 byte 단위 검사와 staging preview
- R2: Dataset Version 원본을 SHA-256 content-addressed object로 불변 저장
- Vector/embedding: 아직 연결되지 않음

원본 10,000행 CSV는 공개 번들이나 저장소에 포함하지 않습니다. Dataset Version은 서버 계산 SHA-256과 R2 object key를 저장하며, 선택한 과거 버전도 동일 원본으로 재현 학습할 수 있습니다.

## 검증

```bash
npm run typecheck
npm run lint
npm run build
npm test
git diff --check
```

GitHub Actions는 pull request에서 위 검사와 production dependency audit를 실행합니다.

## 현재 제한 사항

- 점수 가중치와 임계값은 외부 held-out 데이터로 보정되지 않았습니다.
- 현재 공개 점수 정책 `4.1.0`은 최고 위험 주장 하나만 사용하며 다른 주장 가산은 적용하지 않습니다.
- 일부 위험 패턴은 코드의 compatibility matcher에 남아 있어 스킬 payload만으로 완전히 재현되지 않습니다.
- Dataset 원본은 immutable R2 저장과 서버 기준 SHA 계보를 사용합니다. 운영 R2 binding과 migration이 필수입니다.
- 학습 파이프라인의 일부 단계는 휴리스틱 또는 `not_configured` 상태입니다.
- 후보의 `approve_with_edits`와 merge revision 제안은 구현됐지만, release candidate와 active의 최종 배포 단계는 아직 분리 작업이 남아 있습니다.
- Analyzer와 공개 후보 제출 제한 및 provider budget은 D1 원자적 카운터를 사용합니다. 공개 후보는 30일 기한 후 조회에서 제외되고 다음 제출 시 물리 삭제됩니다.
- 단일 관리자 허용목록 세션은 운영 D1 기반 다중 사용자 RBAC의 임시 단계입니다.
- 테스트 화면은 규칙 엔진만 평가합니다. AI를 포함한 전체 시스템의 품질·latency·비용과 calibration 결과는 아직 없습니다.

## 릴리스 원칙

- 운영 Analyzer는 `reviewed` 스킬만 사용합니다.
- 후보는 자동으로 active 정책에 편입하지 않습니다.
- AI-only high는 사람 검토 없이 확정하지 않습니다.
- 기능이 연결되지 않은 경우 가짜 성공이나 가짜 지표 대신 `unavailable` 또는 `configuration_required`를 표시합니다.
- production D1 migration, 모델 배포와 접근 정책 변경은 별도 검증 후 수행합니다.

## 라이선스

현재 저장소에 별도 오픈소스 라이선스가 선언되어 있지 않습니다. 외부 사용·배포 조건은 저장소 소유자와 확인해야 합니다.
