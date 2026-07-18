# RiskShield v0.3.1 후보 출처 검증

검증 기준일: 2026-07-18 (Asia/Seoul)

## 결론

- 후보 15개 모두 공식 기관, 국가법령정보센터의 법령·조문 또는 공공기관 1차 조사자료에 연결했다.
- 모든 후보의 `source.url`은 실제 `https://` URL이며 `provenance_status`는 `verified`다.
- 내부 RiskShield 평가 보고서는 후보 발굴 근거로만 남기고, 어느 후보에서도 유일한 승인 근거로 사용하지 않았다.
- 출처는 규칙의 심사 필요성을 뒷받침하지만 개별 광고의 위법성을 자동 확정하지 않는다. REVIEW 후보는 입증자료·권한·실제 조건을 사람이 확인해야 한다.

## 공식 자료 레지스트리

| 코드 | 공식 자료 | 확인한 핵심 기준 |
|---|---|---|
| H1 | [의료법 제56조](https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1032849723) | 치료효과 오인, 거짓, 중요한 부작용 누락, 객관적 사실 과장 의료광고 금지 |
| H2 | [식품 등의 표시ㆍ광고에 관한 법률 제8조](https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1029093705) | 질병 예방·치료 효능 오인, 의약품 오인, 거짓·과장·기만 표시광고 금지 |
| G1 | [표시ㆍ광고법 시행령 제3조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=65001) | 사실과 다른·지나치게 부풀린 광고, 중요 사실 은폐·축소, 근거 없는 비교 기준 |
| G2 | [표시ㆍ광고법 제5조](https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900553850) | 사실 관련 표시·광고 내용에 대한 실증 의무 |
| G3 | [공정거래위원회 부당 표시·광고 시정 안내](https://www.ftc.go.kr/www/contents.do?key=700) | 거짓·과장, 기만, 부당 비교, 비방 유형과 학원 실적 과장 사례 |
| F1 | [금융소비자보호법 제22조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025059417) | 투자 위험 고지와 과거 실적이 미래 수익률을 보장하지 않는다는 안내 요구 |
| L1 | [변호사법 제23조](https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900175869) | 거짓·과장·오도 및 업무수행 결과에 부당한 기대를 주는 광고 금지 |
| E1 | [한국소비자원 2026 민간자격증 광고 실태조사](https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1004003291&searchKeyword=%EB%AF%BC%EA%B0%84%EC%9E%90%EA%B2%A9&searchKeywordType=1) | `취업 100%`, `수익 보장` 광고의 근거 부재를 조사한 공공기관 1차 자료 |
| I1 | [한국소비자원 부업 광고 피해 사례](https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1000064447&page=176) | 월 소득 보장 부업광고와 실제 소득 간 차이를 확인한 공식 사례자료 |
| P1 | [개인정보 보호법 제15조](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398929) | 동의, 법령, 계약 등 개인정보 수집·이용의 적법 근거 |
| P2 | [위치정보법 제15조](https://law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0015&lsiSeq=277359&urlMode=lsScJoRltInfoR) | 동의 없는 개인위치정보 수집·이용·제공 금지 및 위치수집장치 고지 |
| P3 | [통신비밀보호법 제3조 관련 조문체계](https://law.go.kr/joStmdInfoP.do?joBrNo=00&joNo=0003&lsiSeq=160962) | 통신 감청과 공개되지 않은 타인 간 대화의 녹음·청취 제한 |

## 후보별 연결 결과

| 후보 | 분야 | 주 출처 | 연결 이유 | 결과 |
|---|---|---|---|---|
| `risk_v03_health_safety_absolute` | 의료·건강 | H1 | 부작용 누락·객관적 과장 기준이 절대 안전 주장 검토를 직접 뒷받침 | VERIFIED |
| `risk_v03_health_disease_effect` | 의료·식품 | H2 | 질병 치료 효능 오인과 거짓·과장 기준에 직접 해당 | VERIFIED |
| `risk_v03_health_body_result` | 건강·뷰티 | G1 | 정량 신체 결과의 사실성·과장 여부를 판단할 일반 기준 | VERIFIED |
| `risk_v03_legal_outcome_promise` | 법률 광고 | L1 | 업무수행 결과에 부당한 기대를 주는 광고를 직접 규율 | VERIFIED |
| `risk_v03_legal_substantiation` | 법률 광고 | L1 | 경력·실적 광고의 거짓·과장·오도 가능성을 검토할 직접 기준 | VERIFIED |
| `risk_v03_general_substantiation` | 일반 상거래 | G2 | 사실 주장에 대한 실증자료 확인을 직접 요구 | VERIFIED |
| `risk_v03_general_urgency` | 일반 상거래 | G3, G1 | 실제 재고·마감 조건을 숨기거나 부풀리는 기만 가능성 검토 | VERIFIED |
| `risk_v03_finance_return_recovery` | 금융·투자 | F1 | 투자 위험 및 미래 수익 비보장 고지를 직접 요구 | VERIFIED |
| `risk_v03_income_guarantee` | 구인·부업 | E1, I1 | 예상 수입·과거 실적과 보장형 광고를 분리할 공식 사례근거 | VERIFIED |
| `risk_v03_income_universal_guarantee` | 구인·부업 | E1, I1 | 누구나·무조건형 수익 보장의 근거 부재와 소비자 피해 가능성 확인 | VERIFIED |
| `risk_v03_education_outcome_promise` | 교육·취업 | E1 | 취업 100% 결과 약속의 근거 부재를 직접 조사 | VERIFIED |
| `risk_v03_education_substantiation` | 교육 광고 | G2, G3 | 합격자 수·성적 향상·최상급 광고의 실증 필요성 확인 | VERIFIED |
| `risk_v03_privacy_covert_surveillance` | 위치·통신 | P2, P3 | 비동의 위치추적·감청·녹음의 동의와 적법 근거 확인 | VERIFIED |
| `risk_v03_privacy_stealth_install` | 위치·감시 앱 | P2 | 위치수집장치 고지와 비동의 수집 금지 기준이 설치 은폐 검토를 뒷받침 | VERIFIED |
| `risk_v03_privacy_data_access_review` | 개인정보 | P1 | 데이터 열람·저장·전송의 동의·계약·법령 근거 확인 | VERIFIED |

## 승인 해석

- 출처 검증 완료: **15/15**
- 출처 부족으로 `REVISE` 또는 `REJECT` 처리한 후보: **0**
- `verified`는 출처의 존재·적합성을 뜻하며, 운영 `reviewed` 상태를 뜻하지 않는다.
- 후보 JSONL의 실제 상태는 전부 `draft`이고 사람 승인 전 운영 분석에 포함되지 않는다.
