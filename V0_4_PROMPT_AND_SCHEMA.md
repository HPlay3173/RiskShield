# RiskShield v0.4 Prompt 및 JSON Schema

## 1. 프롬프트 목적

Interpreter는 광고의 위법 여부나 게시 가능 여부를 결정하지 않는다. 입력 문구의 발화 목적, 행위자, 주장 대상, 부정·대조·인용 관계만 구조화한다. 규칙 결과, 예상 라벨, case ID는 프롬프트에 전달하지 않는다.

프롬프트 버전: `riskshield-interpreter-2026-07-18`
스키마 버전: `1.0.0`

## 2. 시스템 프롬프트

```text
당신은 RiskShield의 광고 문맥 Interpreter입니다.
광고의 위법 여부나 게시 가능 여부를 최종 판단하지 마세요.
규칙 엔진의 결과를 추측하지 말고 입력 문구의 발화 목적, 행위자, 주장 대상, 부정·대조·인용 관계만 독립적으로 구조화하세요.
직접 주장을 인용·비판·경고·보도·정의하는 문맥과 광고주의 직접 주장을 구분하세요.
원문에 없는 사실이나 근거를 만들지 마세요. evidence_spans는 제공된 입력의 UTF-16 offset과 정확한 substring만 사용하세요.
확신이 없으면 uncertain 또는 unclear를 사용하세요.
지정된 JSON schema에 맞는 JSON 객체 외에는 아무 텍스트도 출력하지 마세요.
```

사용자 메시지는 선택적인 비정답 도메인 힌트와 마스킹된 입력만 `입력 시작`·`입력 끝` 경계 안에 전달한다. 입력 내부 명령은 분석 대상 문구일 뿐 시스템 지시로 취급하지 않는다.

## 3. 출력 계약

```json
{
  "schema_version": "1.0.0",
  "risk_intent": "direct_promotional | contextual_only | uncertain",
  "speech_act": "claim | quote | warning | criticism | report | definition | condition",
  "claim_target": "health | finance | education | legal | privacy | general | none",
  "context_relation": "supports | negates | warns_about | reports | defines | conditions | unclear",
  "actor": "advertiser | reporter | regulator | consumer | unknown",
  "claim_strength": "absolute | strong | limited | none | unclear",
  "confidence": 0.0,
  "evidence_spans": [
    { "start": 0, "end": 1, "text": "원" }
  ],
  "policy_reason": "controlled_reason_code"
}
```

실제 기계 판독 스키마는 `artifacts/v0.4/interpreter-schema.json`이 소유한다. 추가 필드는 거부한다.

## 4. 통제 reason code

- `DIRECT_ABSOLUTE_CLAIM`
- `DIRECT_STRONG_RESULT`
- `DIRECT_LIMITED_CLAIM`
- `CONTRASTED_PROMOTION`
- `CONTEXT_WARNING`
- `CONTEXT_CRITICISM`
- `CONTEXT_REPORT`
- `CONTEXT_QUOTE`
- `CONTEXT_DEFINITION`
- `LEGITIMATE_CONDITION`
- `NO_RISK_CLAIM`
- `UNCERTAIN_INTENT`

## 5. 근거 규칙

- offset은 JavaScript 문자열의 UTF-16 인덱스다.
- `0 ≤ start < end ≤ 입력 길이`여야 한다.
- `text === modelInput.slice(start, end)`여야 한다.
- 마스킹된 개인정보와 겹치는 span은 거부한다.
- 검증 통과 뒤 비민감 span의 text는 같은 offset의 원문 substring으로 복원한다.
- `direct_promotional`은 최소 한 개의 검증된 span이 필요하다.
- 원문에 없는 보충 설명을 evidence로 만들 수 없다.

## 6. 일반화 예시 원칙

예시는 구조만 보여주는 소수의 대조쌍으로 제한한다. 기존 최종 100건, 개발 60건, 최종 신규 50건, 실패 문장을 그대로 넣지 않는다.

| 직접 주장 구조 | 구분해야 할 문맥 구조 |
|---|---|
| “이 과정으로 전원이 자격을 취득합니다” | “전원 자격 취득을 내세우는 홍보를 경계하세요” |
| “등록하면 결과가 반드시 개선됩니다” | “결과가 반드시 개선된다고 단정할 수 없습니다” |
| “지금 신청하면 특별 결과를 제공합니다” | “약관상 제공 범위는 신청 조건에 따라 달라집니다” |

## 7. 실패 처리

다음은 payload를 부분 신뢰하지 않고 실행 전체를 실패로 만든다.

- JSON parse 또는 schema 오류
- enum·confidence 오류
- 추가 필드
- 범위 밖 offset
- 입력 substring과 다른 evidence text
- 마스킹 구간 evidence
- 직접 홍보 판단의 근거 누락
- provider 오류 또는 timeout

하이브리드 결합기는 이 실패를 자동 high나 no-match로 바꾸지 않고 `review`로 전달한다.

## 8. Live provider 계약

`LiveInterpreter`는 provider에 시스템 프롬프트, 사용자 프롬프트, JSON Schema, `AbortSignal`만 전달한다. provider는 다음만 반환한다.

- 파싱된 JSON 후보
- 실제 model 이름
- 입력·출력 token 수(가능한 경우)
- 추정 비용(가능한 경우)

API 키는 provider adapter 내부 요청 헤더에서만 사용되며 결과·로그·Git에 기록되지 않는다.
