import { createHash } from "node:crypto";

import type { AnalysisResult } from "../riskshield.ts";

export const INTERPRETER_SCHEMA_VERSION = "1.0.0" as const;
export const INTERPRETER_PROMPT_VERSION = "riskshield-interpreter-2026-07-18" as const;
export const HIGH_CONFIDENCE_THRESHOLD = 0.82;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.55;

export const RISK_INTENTS = ["direct_promotional", "contextual_only", "uncertain"] as const;
export const SPEECH_ACTS = ["claim", "quote", "warning", "criticism", "report", "definition", "condition"] as const;
export const CLAIM_TARGETS = ["health", "finance", "education", "legal", "privacy", "general", "none"] as const;
export const CONTEXT_RELATIONS = ["supports", "negates", "warns_about", "reports", "defines", "conditions", "unclear"] as const;
export const ACTORS = ["advertiser", "reporter", "regulator", "consumer", "unknown"] as const;
export const CLAIM_STRENGTHS = ["absolute", "strong", "limited", "none", "unclear"] as const;
export const POLICY_REASONS = [
  "DIRECT_ABSOLUTE_CLAIM",
  "DIRECT_STRONG_RESULT",
  "DIRECT_LIMITED_CLAIM",
  "CONTRASTED_PROMOTION",
  "CONTEXT_WARNING",
  "CONTEXT_CRITICISM",
  "CONTEXT_REPORT",
  "CONTEXT_QUOTE",
  "CONTEXT_DEFINITION",
  "LEGITIMATE_CONDITION",
  "NO_RISK_CLAIM",
  "UNCERTAIN_INTENT",
] as const;

export type RiskIntent = typeof RISK_INTENTS[number];
export type InterpreterSpeechAct = typeof SPEECH_ACTS[number];
export type ClaimTarget = typeof CLAIM_TARGETS[number];
export type ContextRelation = typeof CONTEXT_RELATIONS[number];
export type Actor = typeof ACTORS[number];
export type ClaimStrength = typeof CLAIM_STRENGTHS[number];
export type PolicyReason = typeof POLICY_REASONS[number];
export type HybridStatus = "no_match" | "review" | "attention" | "high";

export interface EvidenceSpan {
  start: number;
  end: number;
  text: string;
}

export interface InterpreterPayload {
  schema_version: typeof INTERPRETER_SCHEMA_VERSION;
  risk_intent: RiskIntent;
  speech_act: InterpreterSpeechAct;
  claim_target: ClaimTarget;
  context_relation: ContextRelation;
  actor: Actor;
  claim_strength: ClaimStrength;
  confidence: number;
  evidence_spans: EvidenceSpan[];
  policy_reason: PolicyReason;
}

export interface MaskRange {
  start: number;
  end: number;
  kind: "email" | "phone" | "account" | "identifier" | "name" | "address";
}

export interface PreparedInterpreterInput {
  originalText: string;
  modelText: string;
  inputHash: string;
  masked: boolean;
  minimized: boolean;
  maskRanges: MaskRange[];
}

export interface InterpreterRequest {
  text: string;
  domainHint?: ClaimTarget;
}

export interface InterpreterRun {
  ok: boolean;
  payload: InterpreterPayload | null;
  schemaValid: boolean;
  errors: string[];
  inputHash: string;
  masked: boolean;
  minimized: boolean;
  mode: "mock" | "recorded" | "live";
  providerId: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  latencyMs: number;
  estimatedCost: number;
  tokenUsage: { input: number; output: number } | null;
  timedOut: boolean;
}

export interface RiskInterpreter {
  readonly id: string;
  readonly mode: InterpreterRun["mode"];
  interpret(request: InterpreterRequest): Promise<InterpreterRun>;
}

export interface LiveProviderResult {
  output: unknown;
  model: string;
  tokenUsage?: { input: number; output: number };
  estimatedCost?: number;
}

export interface LiveProvider {
  readonly id: string;
  complete(request: {
    systemPrompt: string;
    userPrompt: string;
    schema: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<LiveProviderResult>;
}

export interface RecordedInterpreterRecord {
  input_hash: string;
  masked: boolean;
  model: string;
  provider_id: string;
  prompt_version: string;
  schema_version: string;
  latency_ms: number;
  estimated_cost: number;
  token_usage: { input: number; output: number } | null;
  response: InterpreterPayload;
}

export interface HybridDecision {
  status: HybridStatus;
  score: number;
  conflict: boolean;
  conflictReasons: string[];
  recoveredByInterpreter: boolean;
  suppressedHigh: boolean;
  reason: string;
}

const RESPONSE_KEYS = [
  "schema_version",
  "risk_intent",
  "speech_act",
  "claim_target",
  "context_relation",
  "actor",
  "claim_strength",
  "confidence",
  "evidence_spans",
  "policy_reason",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includesValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

export function hashInterpreterInput(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function collectRegexRanges(
  text: string,
  expression: RegExp,
  kind: MaskRange["kind"],
  ranges: MaskRange[],
) {
  expression.lastIndex = 0;
  for (let match = expression.exec(text); match; match = expression.exec(text)) {
    if (!match[0]) {
      expression.lastIndex += 1;
      continue;
    }
    ranges.push({ start: match.index, end: match.index + match[0].length, kind });
  }
}

function collectCapturedRanges(
  text: string,
  expression: RegExp,
  groupIndex: number,
  kind: MaskRange["kind"],
  ranges: MaskRange[],
) {
  expression.lastIndex = 0;
  for (let match = expression.exec(text); match; match = expression.exec(text)) {
    const captured = match[groupIndex];
    if (!captured) continue;
    const relativeStart = match[0].lastIndexOf(captured);
    ranges.push({
      start: match.index + relativeStart,
      end: match.index + relativeStart + captured.length,
      kind,
    });
  }
}

export function maskSensitiveText(text: string): {
  maskedText: string;
  ranges: MaskRange[];
} {
  const ranges: MaskRange[] = [];
  collectRegexRanges(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "email", ranges);
  collectRegexRanges(text, /(?<!\d)(?:\+?82[- .]?)?0?1[016789](?:[- .]?\d){7,8}(?!\d)/gu, "phone", ranges);
  collectRegexRanges(text, /(?<!\d)(?:\d[- ]?){10,16}(?!\d)/gu, "account", ranges);
  collectRegexRanges(text, /(?<!\d)(?:\d{6}[- ]?[1-4]\d{6}|\d{3}[- ]?\d{2}[- ]?\d{5})(?!\d)/gu, "identifier", ranges);
  collectCapturedRanges(text, /(?:성명|이름|신청인|고객)\s*[:：]?\s*([가-힣]{2,4})/gu, 1, "name", ranges);
  collectCapturedRanges(text, /([가-힣]{2,4})\s*(?:고객님|대표님|원장님|씨|님)/gu, 1, "name", ranges);
  collectCapturedRanges(
    text,
    /(?:주소|거주지)\s*[:：]?\s*((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n,]{4,60})/gu,
    1,
    "address",
    ranges,
  );
  collectRegexRanges(
    text,
    /(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s+(?:[가-힣]+(?:시|군|구)\s+)?[가-힣0-9]+(?:로|길|동)\s*\d+(?:-\d+)?/gu,
    "address",
    ranges,
  );

  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: MaskRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start < previous.end) {
      if (range.end > previous.end) previous.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }

  let maskedText = text;
  for (const range of [...merged].reverse()) {
    maskedText = `${maskedText.slice(0, range.start)}${"●".repeat(range.end - range.start)}${maskedText.slice(range.end)}`;
  }
  return { maskedText, ranges: merged };
}

export function prepareInterpreterInput(text: string, maxChars = 2_000): PreparedInterpreterInput {
  const originalText = text.slice(0, maxChars);
  const { maskedText, ranges } = maskSensitiveText(originalText);
  return {
    originalText,
    modelText: maskedText,
    inputHash: hashInterpreterInput(text),
    masked: ranges.length > 0,
    minimized: text.length > maxChars,
    maskRanges: ranges,
  };
}

function overlapsMaskedRange(span: EvidenceSpan, ranges: readonly MaskRange[]) {
  return ranges.some((range) => span.start < range.end && range.start < span.end);
}

export function validateInterpreterPayload(
  value: unknown,
  prepared: PreparedInterpreterInput,
): { success: true; payload: InterpreterPayload } | { success: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { success: false, errors: ["응답은 JSON 객체여야 합니다."] };

  const keys = Object.keys(value);
  for (const key of RESPONSE_KEYS) {
    if (!keys.includes(key)) errors.push(`필수 필드 누락: ${key}`);
  }
  for (const key of keys) {
    if (!(RESPONSE_KEYS as readonly string[]).includes(key)) errors.push(`허용되지 않은 필드: ${key}`);
  }
  if (value.schema_version !== INTERPRETER_SCHEMA_VERSION) errors.push("schema_version이 1.0.0이 아닙니다.");
  if (!includesValue(RISK_INTENTS, value.risk_intent)) errors.push("risk_intent enum 오류");
  if (!includesValue(SPEECH_ACTS, value.speech_act)) errors.push("speech_act enum 오류");
  if (!includesValue(CLAIM_TARGETS, value.claim_target)) errors.push("claim_target enum 오류");
  if (!includesValue(CONTEXT_RELATIONS, value.context_relation)) errors.push("context_relation enum 오류");
  if (!includesValue(ACTORS, value.actor)) errors.push("actor enum 오류");
  if (!includesValue(CLAIM_STRENGTHS, value.claim_strength)) errors.push("claim_strength enum 오류");
  if (!includesValue(POLICY_REASONS, value.policy_reason)) errors.push("policy_reason enum 오류");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1) {
    errors.push("confidence는 0~1의 유한한 숫자여야 합니다.");
  }

  const normalizedSpans: EvidenceSpan[] = [];
  if (!Array.isArray(value.evidence_spans)) {
    errors.push("evidence_spans는 배열이어야 합니다.");
  } else {
    for (const [index, rawSpan] of value.evidence_spans.entries()) {
      if (!isRecord(rawSpan)) {
        errors.push(`evidence_spans[${index}]는 객체여야 합니다.`);
        continue;
      }
      const spanKeys = Object.keys(rawSpan);
      if (spanKeys.length !== 3 || !["start", "end", "text"].every((key) => spanKeys.includes(key))) {
        errors.push(`evidence_spans[${index}] 필드 오류`);
        continue;
      }
      const start = rawSpan.start;
      const end = rawSpan.end;
      const text = rawSpan.text;
      if (!Number.isInteger(start) || !Number.isInteger(end)
        || (start as number) < 0 || (end as number) <= (start as number)
        || (end as number) > prepared.modelText.length) {
        errors.push(`evidence_spans[${index}] offset 범위 오류`);
        continue;
      }
      if (typeof text !== "string" || prepared.modelText.slice(start as number, end as number) !== text) {
        errors.push(`evidence_spans[${index}] text가 모델 입력 substring과 일치하지 않습니다.`);
        continue;
      }
      const span = { start: start as number, end: end as number, text };
      if (overlapsMaskedRange(span, prepared.maskRanges)) {
        errors.push(`evidence_spans[${index}]가 마스킹된 개인정보와 겹칩니다.`);
        continue;
      }
      normalizedSpans.push({
        start: span.start,
        end: span.end,
        text: prepared.originalText.slice(span.start, span.end),
      });
    }
  }
  if (value.risk_intent === "direct_promotional" && normalizedSpans.length === 0) {
    errors.push("직접 홍보 판단에는 검증 가능한 evidence span이 필요합니다.");
  }

  if (errors.length > 0) return { success: false, errors };
  return {
    success: true,
    payload: {
      schema_version: INTERPRETER_SCHEMA_VERSION,
      risk_intent: value.risk_intent as RiskIntent,
      speech_act: value.speech_act as InterpreterSpeechAct,
      claim_target: value.claim_target as ClaimTarget,
      context_relation: value.context_relation as ContextRelation,
      actor: value.actor as Actor,
      claim_strength: value.claim_strength as ClaimStrength,
      confidence: value.confidence as number,
      evidence_spans: normalizedSpans,
      policy_reason: value.policy_reason as PolicyReason,
    },
  };
}

export const INTERPRETER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [...RESPONSE_KEYS],
  properties: {
    schema_version: { const: INTERPRETER_SCHEMA_VERSION },
    risk_intent: { type: "string", enum: [...RISK_INTENTS] },
    speech_act: { type: "string", enum: [...SPEECH_ACTS] },
    claim_target: { type: "string", enum: [...CLAIM_TARGETS] },
    context_relation: { type: "string", enum: [...CONTEXT_RELATIONS] },
    actor: { type: "string", enum: [...ACTORS] },
    claim_strength: { type: "string", enum: [...CLAIM_STRENGTHS] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence_spans: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "text"],
        properties: {
          start: { type: "integer", minimum: 0 },
          end: { type: "integer", minimum: 1 },
          text: { type: "string" },
        },
      },
    },
    policy_reason: { type: "string", enum: [...POLICY_REASONS] },
  },
};

export const INTERPRETER_SYSTEM_PROMPT = `당신은 RiskShield의 광고 문맥 Interpreter입니다.
광고의 위법 여부나 게시 가능 여부를 최종 판단하지 마세요.
규칙 엔진의 결과를 추측하지 말고 입력 문구의 발화 목적, 행위자, 주장 대상, 부정·대조·인용 관계만 독립적으로 구조화하세요.
직접 주장을 인용·비판·경고·보도·정의하는 문맥과 광고주의 직접 주장을 구분하세요.
원문에 없는 사실이나 근거를 만들지 마세요. evidence_spans는 제공된 입력의 UTF-16 offset과 정확한 substring만 사용하세요.
확신이 없으면 uncertain 또는 unclear를 사용하세요.
지정된 JSON schema에 맞는 JSON 객체 외에는 아무 텍스트도 출력하지 마세요.`;

export function buildInterpreterUserPrompt(prepared: PreparedInterpreterInput, domainHint?: ClaimTarget) {
  const hint = domainHint && domainHint !== "none"
    ? `도메인 힌트(판정 정답이 아님): ${domainHint}`
    : "도메인 힌트: 없음";
  return `${hint}\n입력 시작\n${prepared.modelText}\n입력 끝`;
}

function firstEvidenceSpan(prepared: PreparedInterpreterInput, expression?: RegExp): EvidenceSpan[] {
  if (expression) {
    expression.lastIndex = 0;
    const match = expression.exec(prepared.modelText);
    if (match && match[0]) {
      const span = { start: match.index, end: match.index + match[0].length, text: match[0] };
      if (!overlapsMaskedRange(span, prepared.maskRanges)) return [span];
    }
  }
  const leading = /^\s*/u.exec(prepared.modelText)?.[0].length ?? 0;
  const trailing = /\s*$/u.exec(prepared.modelText)?.[0].length ?? 0;
  const end = prepared.modelText.length - trailing;
  if (end <= leading) return [];
  const span = { start: leading, end, text: prepared.modelText.slice(leading, end) };
  return overlapsMaskedRange(span, prepared.maskRanges) ? [] : [span];
}

function targetForText(text: string, hint?: ClaimTarget): ClaimTarget {
  const candidates: Array<[ClaimTarget, RegExp]> = [
    ["privacy", /(?:위치|gps|추적|메시지|문자|대화|채팅|감시|몰래|상대방|배우자|아내|아이콘|스토커웨어|통화\s*모니터링)/u],
    ["legal", /(?:승소|형량|무죄|기각|법률|변호사|손해배상|전관|합의금|불기소|감형|집행유예)/u],
    ["education", /(?:합격|진학|취업|특채|수강|학원|교육|자격증|수능|대학)/u],
    ["health", /(?:부작용|안전성|시술|의료|치료|완치|질환|효능|키\s|성장|cm|kg|감량|체지방|건강)/u],
    ["finance", /(?:투자|수익|원금|고수익|마진|손실|손해|예금|배당|펀드|주식)/u],
    ["general", /(?:한정|마감|지금\s*구매|특별\s*혜택|소득|수입|부업|재택|월\s*\d+\s*만\s*원)/u],
  ];
  const found = candidates.find(([, expression]) => expression.test(text));
  return found?.[0] ?? hint ?? "none";
}

function classifyMock(prepared: PreparedInterpreterInput, hint?: ClaimTarget): InterpreterPayload {
  const text = prepared.modelText.toLocaleLowerCase("ko-KR");
  const hasContrastPromotion = /(?:하지만|그러나|그럼에도|그래도|이지만|불법이지만|사기라고\s*의심받지만)[^\n]{0,100}(?:지금|구매|신청|가입|투자|제공|해\s*드립니다|가능|보장|추적)/u.test(text);
  const report = /(?:보도|기사|보도입니다|보도했다|보도했습니다|편취|검거|기소|적발|피해가\s*발생|밝혔|판결|내용이다|사례로\s*소개)/u.test(text);
  const quote = /[“”「」『』"]/u.test(text) && /(?:문구|표현|주장|내용|기사|인용|광고|말했|소개)/u.test(text);
  const criticism = /(?:과장(?:된|될|입니다|광고)?|허위|장담하는\s*광고|문제(?:가|점|인)|오인|비판|지나치게\s*장담)/u.test(text);
  const warning = /(?:주의|경계|피하|사기|불법|형사처벌|처벌\s*대상|금지|위험|피해\s*예방|경고등|동의\s*없이[^\n]{0,40}(?:안\s*됩|처벌|불법|위반))/u.test(text);
  const definition = /(?:이란|란)\s|(?:뜻|의미)합니다|정의(?:는|입니다)|(?:교육|분석)\s*자료에서[^\n]{0,30}(?:분석|설명)|정책[^\n]{0,24}설명/u.test(text);
  const condition = /(?:에\s*따라|계약상|근로계약|약관|한도(?:까지|는)|동의를\s*받아|동의한\s*경우|본인\s*(?:계정|기기)|기본급|제도상|보호됩니다|지급됩니다|보상\s*범위|현재\s*측정|과거[^\n]{0,30}(?:기록|실적|검사)|일정\s*안내|참고용|상담(?:하세요|하시기|이\s*필요)|가능성을\s*높이기|손실\s*가능성|개인차|심사(?:로|를\s*통해)\s*결정|성과에\s*따라|달라질\s*수|정보를\s*제공|개인정보\s*보호)/u.test(text);
  const negates = /(?:보장할\s*수(?:\s*있는[^\n]{0,30})?\s*없|보장되지\s*않|보장하지(?:는|도)?\s*않|보장하는[^\n]{0,30}(?:아니|없)|아닙니다|아니다|불가능|없다고[^\n]{0,30}(?:말|단정)할\s*수\s*없|사용하면\s*안|해서는\s*안)/u.test(text);

  const speechAct: InterpreterSpeechAct = hasContrastPromotion
    ? "claim"
    : report ? "report"
      : quote ? "quote"
        : warning ? "warning"
          : criticism ? "criticism"
            : definition ? "definition"
              : condition || negates ? "condition"
                : "claim";

  if (!hasContrastPromotion && ["report", "quote", "warning", "criticism", "definition", "condition"].includes(speechAct)) {
    const relation: Record<Exclude<InterpreterSpeechAct, "claim">, ContextRelation> = {
      report: "reports",
      quote: "reports",
      warning: negates ? "negates" : "warns_about",
      criticism: "negates",
      definition: "defines",
      condition: "conditions",
    };
    const reason: Record<Exclude<InterpreterSpeechAct, "claim">, PolicyReason> = {
      report: "CONTEXT_REPORT",
      quote: "CONTEXT_QUOTE",
      warning: "CONTEXT_WARNING",
      criticism: "CONTEXT_CRITICISM",
      definition: "CONTEXT_DEFINITION",
      condition: "LEGITIMATE_CONDITION",
    };
    const actor: Actor = speechAct === "report" || speechAct === "quote"
      ? "reporter"
      : speechAct === "warning" || speechAct === "criticism" || speechAct === "definition" || speechAct === "condition"
        ? "regulator"
        : "unknown";
    return {
      schema_version: INTERPRETER_SCHEMA_VERSION,
      risk_intent: "contextual_only",
      speech_act: speechAct,
      claim_target: targetForText(text, hint),
      context_relation: relation[speechAct as Exclude<InterpreterSpeechAct, "claim">],
      actor,
      claim_strength: "none",
      confidence: 0.96,
      evidence_spans: firstEvidenceSpan(prepared),
      policy_reason: reason[speechAct as Exclude<InterpreterSpeechAct, "claim">],
    };
  }

  const target = targetForText(text, hint);
  const absolute = /(?:100\s*%|무조건|반드시|절대|하나도|전혀|누구나|모두|전원|보장|확정|책임(?:집|지)|단\s*\d+\s*시간|\d+\s*시간\s*한정)/u.test(text);
  const strong = /(?:\d+(?:[.]\d+)?\s*(?:cm|kg|%|만원)|볼\s*수\s*있|읽을\s*수\s*있|확인할\s*수\s*있|추적|숨기|표시되지|합격시켜|특채|고수익|고소득|수익|성장|효과|환불|회수|마감|지금\s*구매|한정\s*특별\s*혜택)/u.test(text);
  const limited = /(?:가능성|예상|평균|최대|약\s*\d|일정\s*수준|도움)/u.test(text);
  const direct = target !== "none" && (absolute || strong || limited || hasContrastPromotion);

  if (direct) {
    const strength: ClaimStrength = absolute ? "absolute" : strong ? "strong" : "limited";
    const policyReason: PolicyReason = hasContrastPromotion
      ? "CONTRASTED_PROMOTION"
      : strength === "absolute" ? "DIRECT_ABSOLUTE_CLAIM"
        : strength === "strong" ? "DIRECT_STRONG_RESULT"
          : "DIRECT_LIMITED_CLAIM";
    const confidence = strength === "limited" ? 0.74 : 0.94;
    const evidenceExpression = /(?:100\s*%|무조건|반드시|절대|하나도|전혀|누구나|모두|전원|보장|확정|\d+(?:[.]\d+)?\s*(?:cm|kg|%|만원)|볼\s*수\s*있|읽을\s*수\s*있|확인할\s*수\s*있|추적|숨기|표시되지|합격시켜|고수익|고소득|수익|성장|효과|환불|마감|한정)/u;
    return {
      schema_version: INTERPRETER_SCHEMA_VERSION,
      risk_intent: "direct_promotional",
      speech_act: "claim",
      claim_target: target,
      context_relation: "supports",
      actor: "advertiser",
      claim_strength: strength,
      confidence,
      evidence_spans: firstEvidenceSpan(prepared, evidenceExpression),
      policy_reason: policyReason,
    };
  }

  return {
    schema_version: INTERPRETER_SCHEMA_VERSION,
    risk_intent: "contextual_only",
    speech_act: "claim",
    claim_target: target,
    context_relation: "unclear",
    actor: "unknown",
    claim_strength: "none",
    confidence: 0.92,
    evidence_spans: firstEvidenceSpan(prepared),
    policy_reason: "NO_RISK_CLAIM",
  };
}

function elapsedMs(start: number) {
  return Math.max(0, performance.now() - start);
}

export class MockInterpreter implements RiskInterpreter {
  readonly id = "riskshield.mock-interpreter.v0.4";
  readonly mode = "mock" as const;

  async interpret(request: InterpreterRequest): Promise<InterpreterRun> {
    const start = performance.now();
    const prepared = prepareInterpreterInput(request.text);
    const raw = classifyMock(prepared, request.domainHint);
    const validated = validateInterpreterPayload(raw, prepared);
    return {
      ok: validated.success,
      payload: validated.success ? validated.payload : null,
      schemaValid: validated.success,
      errors: validated.success ? [] : validated.errors,
      inputHash: prepared.inputHash,
      masked: prepared.masked,
      minimized: prepared.minimized,
      mode: this.mode,
      providerId: this.id,
      model: "deterministic-semantic-mock-v0.4",
      promptVersion: INTERPRETER_PROMPT_VERSION,
      schemaVersion: INTERPRETER_SCHEMA_VERSION,
      latencyMs: elapsedMs(start),
      estimatedCost: 0,
      tokenUsage: null,
      timedOut: false,
    };
  }
}

export class RecordedInterpreter implements RiskInterpreter {
  readonly id = "riskshield.recorded-interpreter.v0.4";
  readonly mode = "recorded" as const;
  readonly #records: Map<string, RecordedInterpreterRecord>;

  constructor(records: readonly RecordedInterpreterRecord[]) {
    this.#records = new Map(records.map((record) => [record.input_hash, record]));
  }

  static fromJsonl(jsonl: string) {
    const records = jsonl.split(/\r?\n/u).filter(Boolean).map((line, index) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || typeof parsed.input_hash !== "string" || !isRecord(parsed.response)) {
        throw new Error(`RecordedInterpreter ${index + 1}행 형식 오류`);
      }
      return parsed as unknown as RecordedInterpreterRecord;
    });
    return new RecordedInterpreter(records);
  }

  async interpret(request: InterpreterRequest): Promise<InterpreterRun> {
    const start = performance.now();
    const prepared = prepareInterpreterInput(request.text);
    const record = this.#records.get(prepared.inputHash);
    if (!record) {
      return {
        ok: false,
        payload: null,
        schemaValid: false,
        errors: ["저장된 Interpreter 응답이 없습니다."],
        inputHash: prepared.inputHash,
        masked: prepared.masked,
        minimized: prepared.minimized,
        mode: this.mode,
        providerId: this.id,
        model: "record-missing",
        promptVersion: INTERPRETER_PROMPT_VERSION,
        schemaVersion: INTERPRETER_SCHEMA_VERSION,
        latencyMs: elapsedMs(start),
        estimatedCost: 0,
        tokenUsage: null,
        timedOut: false,
      };
    }
    const validated = validateInterpreterPayload(record.response, prepared);
    return {
      ok: validated.success,
      payload: validated.success ? validated.payload : null,
      schemaValid: validated.success,
      errors: validated.success ? [] : validated.errors,
      inputHash: prepared.inputHash,
      masked: record.masked,
      minimized: prepared.minimized,
      mode: this.mode,
      providerId: record.provider_id,
      model: record.model,
      promptVersion: record.prompt_version,
      schemaVersion: record.schema_version,
      latencyMs: record.latency_ms,
      estimatedCost: record.estimated_cost,
      tokenUsage: record.token_usage,
      timedOut: false,
    };
  }
}

export class LiveInterpreter implements RiskInterpreter {
  readonly id = "riskshield.live-interpreter.v0.4";
  readonly mode = "live" as const;
  private readonly provider: LiveProvider;
  private readonly timeoutMs: number;

  constructor(provider: LiveProvider, timeoutMs = 15_000) {
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }

  async interpret(request: InterpreterRequest): Promise<InterpreterRun> {
    const start = performance.now();
    const prepared = prepareInterpreterInput(request.text);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const result = await this.provider.complete({
        systemPrompt: INTERPRETER_SYSTEM_PROMPT,
        userPrompt: buildInterpreterUserPrompt(prepared, request.domainHint),
        schema: INTERPRETER_JSON_SCHEMA,
        signal: controller.signal,
      });
      const validated = validateInterpreterPayload(result.output, prepared);
      return {
        ok: validated.success,
        payload: validated.success ? validated.payload : null,
        schemaValid: validated.success,
        errors: validated.success ? [] : validated.errors,
        inputHash: prepared.inputHash,
        masked: prepared.masked,
        minimized: prepared.minimized,
        mode: this.mode,
        providerId: this.provider.id,
        model: result.model,
        promptVersion: INTERPRETER_PROMPT_VERSION,
        schemaVersion: INTERPRETER_SCHEMA_VERSION,
        latencyMs: elapsedMs(start),
        estimatedCost: result.estimatedCost ?? 0,
        tokenUsage: result.tokenUsage ?? null,
        timedOut: false,
      };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      return {
        ok: false,
        payload: null,
        schemaValid: false,
        errors: [timedOut ? "Interpreter 호출 시간 초과" : error instanceof Error ? error.message : "Interpreter 호출 실패"],
        inputHash: prepared.inputHash,
        masked: prepared.masked,
        minimized: prepared.minimized,
        mode: this.mode,
        providerId: this.provider.id,
        model: "unavailable",
        promptVersion: INTERPRETER_PROMPT_VERSION,
        schemaVersion: INTERPRETER_SCHEMA_VERSION,
        latencyMs: elapsedMs(start),
        estimatedCost: 0,
        tokenUsage: null,
        timedOut,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function toRecordedInterpreterRecord(run: InterpreterRun): RecordedInterpreterRecord {
  if (!run.ok || !run.payload) throw new Error("유효한 Interpreter 실행만 기록할 수 있습니다.");
  return {
    input_hash: run.inputHash,
    masked: run.masked,
    model: run.model,
    provider_id: run.providerId,
    prompt_version: run.promptVersion,
    schema_version: run.schemaVersion,
    latency_ms: run.latencyMs,
    estimated_cost: run.estimatedCost,
    token_usage: run.tokenUsage,
    response: run.payload,
  };
}

export function interpreterOnlyStatus(run: InterpreterRun): HybridStatus {
  const payload = run.payload;
  if (!run.ok || !payload) return "review";
  if (payload.risk_intent === "contextual_only") return "no_match";
  if (payload.risk_intent === "uncertain" || payload.confidence < MEDIUM_CONFIDENCE_THRESHOLD) return "review";
  if (payload.risk_intent === "direct_promotional"
    && payload.speech_act === "claim"
    && payload.context_relation === "supports") {
    if (["absolute", "strong"].includes(payload.claim_strength)
      && payload.confidence >= HIGH_CONFIDENCE_THRESHOLD) return "high";
    if (payload.claim_strength === "limited" && payload.confidence >= HIGH_CONFIDENCE_THRESHOLD) return "attention";
    return "review";
  }
  return "review";
}

function domainFromRules(rules: AnalysisResult): ClaimTarget {
  const primary = rules.primaryMatch?.skill;
  if (!primary) return "none";
  const value = `${primary.id} ${primary.category} ${primary.riskDomain}`.toLocaleLowerCase("ko-KR");
  if (/(privacy|개인정보|위치정보|사생활)/u.test(value)) return "privacy";
  if (/(legal|법률|전문서비스)/u.test(value)) return "legal";
  if (/(education|교육|입시)/u.test(value)) return "education";
  if (/(medical|health|의료|건강)/u.test(value)) return "health";
  if (/(finance|금융|투자)/u.test(value)) return "finance";
  return "general";
}

export function combineHybrid(rules: AnalysisResult, run: InterpreterRun): HybridDecision {
  if (!run.ok || !run.payload) {
    return {
      status: "review",
      score: Math.max(55, Math.min(69, rules.finalScore || 55)),
      conflict: true,
      conflictReasons: run.timedOut ? ["interpreter_timeout"] : ["interpreter_invalid"],
      recoveredByInterpreter: false,
      suppressedHigh: false,
      reason: "Interpreter 오류는 자동 결론 대신 사람 검토로 전달합니다.",
    };
  }

  const ai = run.payload;
  const rulesDomain = domainFromRules(rules);
  const hasRulesEvidence = rules.matches.length > 0;
  const domainConflict = hasRulesEvidence && ai.risk_intent === "direct_promotional"
    && ai.claim_target !== "none" && rulesDomain !== "none" && ai.claim_target !== rulesDomain;
  const suppression = ["warning", "criticism", "report", "definition", "quote"].includes(ai.speech_act)
    || ["negates", "warns_about", "reports", "defines"].includes(ai.context_relation);

  if (suppression && ai.risk_intent === "contextual_only") {
    return {
      status: "no_match",
      score: 0,
      conflict: rules.status !== "no_match",
      conflictReasons: rules.status !== "no_match" ? ["context_suppresses_rules"] : [],
      recoveredByInterpreter: false,
      suppressedHigh: rules.status === "high",
      reason: "경고·비판·보도·인용·정의 문맥이 직접 광고 주장을 억제합니다.",
    };
  }

  if (ai.risk_intent === "contextual_only"
    && ai.speech_act === "condition"
    && ["conditions", "negates"].includes(ai.context_relation)
    && ai.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return {
      status: "no_match",
      score: 0,
      conflict: rules.status !== "no_match",
      conflictReasons: rules.status !== "no_match" ? ["legitimate_condition_suppresses_rules"] : [],
      recoveredByInterpreter: false,
      suppressedHigh: rules.status === "high",
      reason: "명시적 부정·계약 조건·정상 안내 문맥이 직접 광고 주장을 억제합니다.",
    };
  }

  if (domainConflict) {
    return {
      status: "review",
      score: Math.max(55, Math.min(69, rules.finalScore || 60)),
      conflict: true,
      conflictReasons: ["domain_mismatch"],
      recoveredByInterpreter: false,
      suppressedHigh: rules.status === "high",
      reason: "규칙과 Interpreter의 정책 도메인이 달라 사람 검토가 필요합니다.",
    };
  }

  if (ai.risk_intent === "uncertain" || ai.confidence < MEDIUM_CONFIDENCE_THRESHOLD) {
    return {
      status: "review",
      score: Math.max(55, Math.min(69, rules.finalScore || 55)),
      conflict: rules.status !== "review",
      conflictReasons: ["interpreter_uncertain"],
      recoveredByInterpreter: false,
      suppressedHigh: rules.status === "high",
      reason: "Interpreter 확신이 낮아 자동 판정을 하지 않습니다.",
    };
  }

  if (ai.risk_intent === "direct_promotional"
    && ai.speech_act === "claim"
    && ai.context_relation === "supports") {
    if (!hasRulesEvidence) {
      return {
        status: "review",
        score: 60,
        conflict: false,
        conflictReasons: [],
        recoveredByInterpreter: true,
        suppressedHigh: false,
        reason: "AI가 직접 위험 주장을 찾았지만 규칙 증거가 없어 review로 회수합니다.",
      };
    }
    if (["absolute", "strong"].includes(ai.claim_strength)
      && ai.confidence >= HIGH_CONFIDENCE_THRESHOLD
      && ai.evidence_spans.length > 0) {
      return {
        status: "high",
        score: Math.max(80, rules.finalScore),
        conflict: false,
        conflictReasons: [],
        recoveredByInterpreter: false,
        suppressedHigh: false,
        reason: "규칙 근거와 고신뢰 직접 홍보 주장이 함께 확인됐습니다.",
      };
    }
    if (ai.claim_strength === "limited" && ai.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      return {
        status: "attention",
        score: Math.max(70, Math.min(79, rules.finalScore || 70)),
        conflict: false,
        conflictReasons: [],
        recoveredByInterpreter: false,
        suppressedHigh: rules.status === "high",
        reason: "직접 주장이지만 제한적 표현이므로 attention으로 제한합니다.",
      };
    }
    return {
      status: "review",
      score: Math.max(55, Math.min(69, rules.finalScore || 60)),
      conflict: false,
      conflictReasons: [],
      recoveredByInterpreter: false,
      suppressedHigh: rules.status === "high",
      reason: "직접 주장 신호는 있으나 자동 high 조건을 모두 충족하지 않습니다.",
    };
  }

  if (ai.risk_intent === "contextual_only" && !hasRulesEvidence) {
    return {
      status: "no_match",
      score: 0,
      conflict: false,
      conflictReasons: [],
      recoveredByInterpreter: false,
      suppressedHigh: false,
      reason: "규칙 증거와 직접 위험 주장 모두 확인되지 않았습니다.",
    };
  }

  return {
    status: "review",
    score: Math.max(55, Math.min(69, rules.finalScore || 55)),
    conflict: true,
    conflictReasons: ["rules_interpreter_disagreement"],
    recoveredByInterpreter: false,
    suppressedHigh: rules.status === "high",
    reason: "규칙과 Interpreter 결론이 달라 사람 검토가 필요합니다.",
  };
}
