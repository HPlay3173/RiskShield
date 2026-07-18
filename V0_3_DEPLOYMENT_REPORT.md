# RiskShield v0.3 운영 배포 보고서

## 배포 결과

RiskShield v0.3 배포 후보는 기존 비공개 Sites 프로젝트에 정상 배포되었다. 새 프로젝트나 새 도메인은 만들지 않았고 기존 URL, custom 접근 정책, 허용 사용자 1명, D1 `DB` 바인딩을 그대로 유지했다.

| 항목 | 결과 |
| --- | --- |
| Sites 프로젝트 | `appgprj_6a590e98034c8191af5393c355cbe739` |
| 기존/현재 URL | `https://riskshield-studio.horari.chatgpt.site` |
| 배포 전 버전 | 9 |
| 배포 버전 | 10 |
| 배포 소스 커밋 | `1e978059d6abdb97c1408e84dbb362399b132f22` |
| 저장 버전 ID | `appgprj_6a590e98034c8191af5393c355cbe739~appgver_0c45dc8c493c8191893682fdecbaf47f` |
| 배포 ID | `appgdep_6a5b373464208191b6503045161d9b02` |
| 배포 상태 | `succeeded` |
| 번들 SHA-256 | `adfef6a2e297d2e8f2ba08785add574dca4d7f8a455a8568faed5f1fb9a5641a` |
| D1 바인딩 | `DB` 유지 |
| 접근 정책 | `custom` 유지 |
| 허용 사용자 | Play H (`hplay142857@gmail.com`) 1명 유지 |
| 허용 그룹 | 없음 유지 |
| 공개 상태 | 비공개 유지 |

2026-07-18 최종 재조회에서도 프로젝트의 최신 버전은 10, 라이브 URL은 기존 URL, 배포 상태는 `succeeded`, 접근 정책은 `custom`이었다.

## 배포 전 검증

배포 후보 커밋에서 다음 검증을 모두 통과했다.

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm test`: 40/40 PASS
- `npm run build`: PASS
- `git diff --check`: PASS
- 저장소 및 배포 번들 내 원본 10,000행 CSV: 없음
- 외부 LLM/API 추가: 없음

## D1 사전 백업

배포 전 운영 D1은 총 14건이었다.

| 상태 | 건수 |
| --- | ---: |
| reviewed | 9 |
| draft | 4 |
| rejected | 1 |
| 합계 | 14 |

백업 파일은 `artifacts/v0.3-final/predeploy-d1-backup.json`이며 SHA-256은 `37c9ee1604dfc26acb5f896fc331e1295d94b353bcdf8a8beb49bf038ea78b8d`이다. 기존 ID 14개를 모두 기록했고, 병합 후에도 삭제되지 않았음을 확인했다.

## 승인 15건 병합

사람 승인 매니페스트에 따라 9개 high 가능 규칙과 6개 REVIEW 전용 규칙을 ID 기반 원자 upsert로 병합했다. 전체 교체나 기존 행 삭제는 수행하지 않았다.

| 미리보기/적용 항목 | 건수 |
| --- | ---: |
| 신규 | 15 |
| 갱신 | 0 |
| 동일 | 0 |
| 충돌 | 0 |
| 오류 | 0 |
| 적용 후 예상/실제 합계 | 29 |

병합 요청 파일은 `artifacts/v0.3-final/v0.3-approved-merge-request.json`, SHA-256은 `81603f3caec215cc5270be6e3805a83ff323e7dab1dfe4c3c0eb39416e876c61`이다.

적용 후 D1 상태는 다음과 같다.

| 상태 | 적용 전 | 적용 후 |
| --- | ---: | ---: |
| reviewed | 9 | 24 |
| draft | 4 | 4 |
| rejected | 1 | 1 |
| 합계 | 14 | 29 |

별도 GET 2회에서 29건과 상태별 건수가 일치했고, 승인 15개 ID는 모두 reviewed였다. REVIEW 전용 6개는 `dominantRisk=false`와 승인된 55–60점 하한을 유지했다. 적용 후 스냅샷은 `artifacts/v0.3-final/postmerge-d1-snapshot.json`, SHA-256은 `34b6100233089b3867cd4725fa2fc1c2181b909c3d50350a0e4b82bfcf061afd`이다.

## 실제 배포 URL Smoke

로그인된 실제 Edge 창에서 기존 비공개 URL을 열어 2단계 Analyzer를 검증했다.

- high 기대 9문장: 9/9 high, 의도한 지배 규칙 적용
- REVIEW 전용 6문장: 6/6 추가 검토, high 0건
- 안전·부정 6문장: 6/6 규칙 미일치, high 0건
- 미일치 1문장: `규칙 미일치 / 판단 불가 / 0`, 안전 판정으로 표시하지 않음
- 새로고침 후 reviewed 24개와 D1 연결 유지
- 새 탭에서도 동일한 UI와 데이터 유지
- API/UI 치명 오류: 0건

증거 화면은 `artifacts/v0.3-final/screenshots/`의 `smoke-high.png`, `smoke-review-only.png`, `smoke-no-match.png`, `persistence-refresh.png`, `persistence-new-tab.png`에 저장했다.

## 배포 한계

배포와 Smoke 성공은 최종 독립 블라인드 성능 통과를 의미하지 않는다. 최종 100건 블라인드 결과는 `V0_3_FINAL_VALIDATION_REPORT.md`에 별도로 기록했으며, 성능 게이트 미달로 v0.3.0 릴리스 승격과 Git 태그 생성을 수행하지 않았다.
