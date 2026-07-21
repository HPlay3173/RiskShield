# RiskShield Studio v0.5 Alpha

RiskShield는 한국어 광고·홍보 문구에서 과장된 보장, 의료 효능, 금융 수익, 교육 성과, 개인정보 침해 등 검토가 필요한 표현을 찾는 위험 분석 도구입니다.

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
- 정확한 evidence 구간, 대체 문구, 불확실성 및 fallback 표시
- 요청 취소·재시도, 키보드와 모바일 접근성
- 내부 스킬 전체, matcher 패턴, prompt와 provider 원문은 공개 응답에서 제외

호환 API인 `/api/skills`는 모든 메서드에서 `410 Gone`을 반환합니다.

### 통합 관리 콘솔

`/manage/*`는 Google OIDC로 보호됩니다. 현재 운영은 서버 환경에 등록된 단일 관리자 이메일만 허용합니다.

- `/manage/review`: AI·사용자 제보 후보 검토
- `/manage/skills`: 스킬 라이브러리와 revision 제안
- `/manage/datasets`: CSV 검사, 열 매핑, SHA-256 및 staging 등록
- `/manage/training`: 개발용 학습 MVP와 단계별 상태
- `/manage/evaluation`: 현재 존재하는 회귀 검증 결과
- `/manage/models`: 모델·prompt·schema 설정 상태
- `/manage/trends`: 트렌드 데이터 준비 상태
- `/manage/audit`: 실제 저장된 감사 이벤트
- `/manage/access`: 로그인 주체와 접근 저장소 상태

기존 `/admin/*`, `/dev/*`, `/owner/*` 경로는 호환 경로이며 제품의 기준 namespace는 `/manage/*`입니다.

## 분석 흐름

```text
입력 문구
  ├─ reviewed 규칙 엔진
  └─ 선택적 Gemma Interpreter
          ↓
claim·문맥·evidence 계약 검증
          ↓
서버 점수 계산 및 검토 상태 결정
          ↓
공개 결과 projection
```

현재 0–100 계산은 서버에서 결정론적으로 수행되지만, AI가 평가한 축은 모델 판단입니다. 따라서 숫자를 경험적으로 보정된 확률이나 법률적 위험도로 해석하면 안 됩니다.

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

- D1: 운영 스킬, 설정, 후보 및 준비된 관리 데이터
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
- 일부 위험 패턴은 코드의 compatibility matcher에 남아 있어 스킬 payload만으로 완전히 재현되지 않습니다.
- Dataset 원본은 immutable R2 저장과 서버 기준 SHA 계보를 사용합니다. 운영 R2 binding과 migration이 필수입니다.
- 학습 파이프라인의 일부 단계는 휴리스틱 또는 `not_configured` 상태입니다.
- 후보의 `approve_with_edits`와 merge revision 제안은 구현됐지만, release candidate와 active의 최종 배포 단계는 아직 분리 작업이 남아 있습니다.
- Analyzer와 공개 후보 제출 제한 및 provider budget은 D1 원자적 카운터를 사용합니다. 공개 후보는 30일 기한 후 조회에서 제외되고 다음 제출 시 물리 삭제됩니다.
- 단일 관리자 허용목록 세션은 운영 D1 기반 다중 사용자 RBAC의 임시 단계입니다.
- 품질·latency·비용의 실제 운영 지표와 calibration 결과가 아직 없습니다.

## 릴리스 원칙

- 운영 Analyzer는 `reviewed` 스킬만 사용합니다.
- 후보는 자동으로 active 정책에 편입하지 않습니다.
- AI-only high는 사람 검토 없이 확정하지 않습니다.
- 기능이 연결되지 않은 경우 가짜 성공이나 가짜 지표 대신 `unavailable` 또는 `configuration_required`를 표시합니다.
- production D1 migration, 모델 배포와 접근 정책 변경은 별도 검증 후 수행합니다.

## 라이선스

현재 저장소에 별도 오픈소스 라이선스가 선언되어 있지 않습니다. 외부 사용·배포 조건은 저장소 소유자와 확인해야 합니다.
