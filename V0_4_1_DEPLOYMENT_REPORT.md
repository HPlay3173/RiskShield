# RiskShield v0.4.1 배포 및 운영 확인 보고서

## 1. 배포 결과

- 배포 상태: 성공
- 운영 URL: https://riskshield-studio.horari.chatgpt.site/
- 기존 URL 유지: 예
- 기존 Sites 프로젝트 유지: 예
- private custom 접근 정책 유지: 예
- 허용 사용자: 1명 유지
- 허용 그룹: 0개 유지
- API secret: `RISKSHIELD_INTERPRETER_API_KEY` secret 설정과 revision 유지

## 2. D1 보존 확인

배포 후 운영 스킬 라이브러리 화면에서 다음 수량을 확인했다.

- 전체 29
- reviewed 24
- draft 4
- rejected 1

D1 migration과 쓰기 작업은 수행하지 않았다. 배포 전 검증 스냅샷과 배포 후 운영 UI 수량이 일치한다.

## 3. 운영 UI 실사용 결과

| ID | 구분 | 입력 요약 | 결과 | 판정 |
|---|---|---|---|---|
| POST001 | 정상 CTA | 무료 디자인 도구 시작 | no_match | PASS |
| POST002 | 정상 CTA | 여름 컬렉션 둘러보기 | no_match | PASS |
| POST003 | 기능 안내 | 설정·알림 메뉴 선택 | no_match | PASS |
| POST004 | 기능 안내 | 추가 기능에서 달력 선택 | no_match | PASS |
| POST005 | 입증 필요 | 업계 최고 배터리 성능 | review | PASS |
| POST006 | 입증 필요 | 정상가 대비 30% 할인 | review | PASS |
| POST007 | 직접 고위험 | 부작용 없는 감량 보장 | high | PASS |
| POST008 | 직접 고위험 | 비동의 메시지·위치 확인 | review | PASS |
| POST009 | 정의·비판 | 부작용 없음 표현 설명 | no_match | PASS |
| POST010 | 경고·정의 | 100% 수익 보장 패턴 설명 | no_match | PASS |
| POST011 | 강제 fallback | 입증 문구의 provider 응답 실패 | review fallback | PASS |

11개 운영 시나리오가 모두 목표 범위에 들어왔다. POST011에서는 “AI 서비스 오류로 담당자 검토로 전환했습니다.”와 구체적인 검토 사유가 표시됐다.

## 4. UI 표시 확인

배포 화면에서 다음 사용자 친화적 항목을 확인했다.

- AI 문맥 상태
- 발화 구분
- 문맥 관계
- 정책 관련성
- 위험 분야
- AI 제공 상태
- 하이브리드 최종
- 규칙·AI 충돌 이유
- 전체·AI 처리 시간
- cache 상태
- 구체적인 검토 사유

경고·정의 사례에서 빈 evidence를 오류로 표시하지 않고 “이 문구는 위험 표현을 설명하거나 경고하는 문맥으로 해석되었습니다.”라고 표시했다. provider fallback은 기술 enum 대신 담당자 검토 전환 문장으로 표시했다.

## 5. 도구 제한

요청된 데스크톱 Computer Use 런타임은 실행되어 있지 않아 사용할 수 없었다. 동일한 로그인 세션의 Codex 인앱 브라우저 제어로 11개 UI 시나리오, 결과 문구, 레이아웃과 D1 카운트를 검증했다.

## 6. 최종 판정

**배포 완료 · BETA_OK (private beta)**

기존 URL, custom 비공개 정책, 허용 사용자, D1 29개 상태, API secret을 보존했다.
