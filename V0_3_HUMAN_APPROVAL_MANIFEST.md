# RiskShield v0.3 사람 승인 매니페스트

- 승인 적용 시각: 2026-07-18T17:15:01+09:00
- 승인 근거: 사용자가 명시적으로 승인한 v0.3.1 후보 15건
- 적용 방식: 기존 운영 D1에 ID 기준 원자적 merge/upsert
- 공통 최종 상태: `reviewed`
- 비승인 draft 처리: 승격하지 않음

## 승인 처분

| ID | 처분 | 출처 | 검증 | 하한 | dominant | 최종 상태 |
|---|---|---|---|---:|:---:|---|
| `risk_v03_health_safety_absolute` | 운영 검토완료 · high 가능 | [의료법 제56조(의료광고의 금지 등)](https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1032849723) | verified | 88 | true | reviewed |
| `risk_v03_health_disease_effect` | 운영 검토완료 · high 가능 | [식품 등의 표시ㆍ광고에 관한 법률 제8조](https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1029093705) | verified | 82 | true | reviewed |
| `risk_v03_health_body_result` | 운영 검토완료 · high 가능 | [표시ㆍ광고의 공정화에 관한 법률 시행령 제3조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=65001) | verified | 82 | true | reviewed |
| `risk_v03_legal_outcome_promise` | 운영 검토완료 · high 가능 | [변호사법 제23조(광고)](https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900175869) | verified | 85 | true | reviewed |
| `risk_v03_legal_substantiation` | 운영 검토완료 · REVIEW 전용 | [변호사법 제23조(광고)](https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900175869) | verified | 58 | false | reviewed |
| `risk_v03_general_substantiation` | 운영 검토완료 · REVIEW 전용 | [표시ㆍ광고의 공정화에 관한 법률 제5조(실증)](https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900553850) | verified | 58 | false | reviewed |
| `risk_v03_general_urgency` | 운영 검토완료 · REVIEW 전용 | [부당한 표시ㆍ광고 시정 제도 안내](https://www.ftc.go.kr/www/contents.do?key=700) | verified | 55 | false | reviewed |
| `risk_v03_finance_return_recovery` | 운영 검토완료 · high 가능 | [금융소비자 보호에 관한 법률 제22조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025059417) | verified | 85 | true | reviewed |
| `risk_v03_income_guarantee` | 운영 검토완료 · REVIEW 전용 | [한국소비자원 민간자격증 광고 실태조사](https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1004003291&searchKeyword=%EB%AF%BC%EA%B0%84%EC%9E%90%EA%B2%A9&searchKeywordType=1) | verified | 60 | false | reviewed |
| `risk_v03_income_universal_guarantee` | 운영 검토완료 · high 가능 | [한국소비자원 민간자격증 광고 실태조사](https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1004003291&searchKeyword=%EB%AF%BC%EA%B0%84%EC%9E%90%EA%B2%A9&searchKeywordType=1) | verified | 82 | true | reviewed |
| `risk_v03_education_outcome_promise` | 운영 검토완료 · high 가능 | [한국소비자원 민간자격증 광고 실태조사](https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1004003291&searchKeyword=%EB%AF%BC%EA%B0%84%EC%9E%90%EA%B2%A9&searchKeywordType=1) | verified | 84 | true | reviewed |
| `risk_v03_education_substantiation` | 운영 검토완료 · REVIEW 전용 | [표시ㆍ광고의 공정화에 관한 법률 제5조(실증)](https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900553850) | verified | 58 | false | reviewed |
| `risk_v03_privacy_covert_surveillance` | 운영 검토완료 · high 가능 | [위치정보의 보호 및 이용 등에 관한 법률 제15조](https://law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0015&lsiSeq=277359&urlMode=lsScJoRltInfoR) | verified | 86 | true | reviewed |
| `risk_v03_privacy_stealth_install` | 운영 검토완료 · high 가능 | [위치정보의 보호 및 이용 등에 관한 법률 제15조](https://law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0015&lsiSeq=277359&urlMode=lsScJoRltInfoR) | verified | 84 | true | reviewed |
| `risk_v03_privacy_data_access_review` | 운영 검토완료 · REVIEW 전용 | [개인정보 보호법 제15조(개인정보의 수집ㆍ이용)](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398929) | verified | 55 | false | reviewed |

## 무결성

| 파일 | SHA-256 |
|---|---|
| `V0_3_SKILL_REVIEW_PACKET_V2.md` | `393a051ae14bb303cfff8bb0b57923a9cd8111ff67064e6e10906cc48e20b78f` |
| `artifacts/v0.3/candidate-risk-skills-v0.3.1.jsonl` | `7e7f40094d781e652e0b7dfe40cc24b25e09fc95f11a4877bc6a06b4d05add98` |
| 사전 D1 백업 `artifacts/v0.3-final/predeploy-d1-backup.json` | `37c9ee1604dfc26acb5f896fc331e1295d94b353bcdf8a8beb49bf038ea78b8d` |
| 운영 병합 요청 `artifacts/v0.3-final/v0.3-approved-merge-request.json` | `81603f3caec215cc5270be6e3805a83ff323e7dab1dfe4c3c0eb39416e876c61` |

## 고지

이 승인은 규칙 후보를 RiskShield의 운영 검토 상태로 승격하는 제품 운영 결정이다. 개별 문구에 대한 법률 자문, 규제기관 판단 또는 위법성 확정을 대신하지 않으며, 분석 결과는 사람의 최종 검토를 지원하는 참고 신호로 사용한다. REVIEW 전용 6건은 `dominant_risk=false`와 승인된 하한 55–60을 유지하며 어떤 경우에도 해당 규칙 단독으로 high 판정을 만들지 않는다.
