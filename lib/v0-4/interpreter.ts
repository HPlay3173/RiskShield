import { createHash } from "node:crypto";

import type { AnalysisResult } from "../riskshield.ts";
// @ts-expect-error Node 22 direct TypeScript execution requires the runtime extension.
import { RISK_FAMILIES, type RiskFamily } from "../risk-family.ts";

// @ts-expect-error Node 22 direct TypeScript execution requires the runtime extension.
export { RISK_FAMILIES } from "../risk-family.ts";
export type { RiskFamily } from "../risk-family";

export const INTERPRETER_SCHEMA_VERSION = "1.1.0" as const;
export const INTERPRETER_PROMPT_VERSION = "riskshield-interpreter-2026-07-21-multiaxis-r1" as const;
export const HIGH_CONFIDENCE_THRESHOLD = 0.82;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.55;
export const SAFE_NO_MATCH_CONFIDENCE_THRESHOLD = 0.5;
export const CONTEXT_SUPPRESSION_CONFIDENCE_THRESHOLD = 0.8;

export const RISK_INTENTS = ["direct_promotional", "direct_harmful", "contextual_only", "uncertain"] as const;
export const SPEECH_ACTS = ["claim", "quote", "warning", "criticism", "report", "definition", "condition"] as const;
export const CLAIM_TARGETS = ["individual", "protected_group", "regional_group", "community", "health", "finance", "education", "legal", "privacy", "general", "none"] as const;
export const CONTEXT_RELATIONS = ["supports", "negates", "warns_about", "reports", "defines", "conditions", "unclear"] as const;
export const ACTORS = ["advertiser", "speaker", "reporter", "regulator", "consumer", "unknown"] as const;
export const CLAIM_STRENGTHS = ["absolute", "strong", "limited", "none", "unclear"] as const;
export const POLICY_RELEVANCES = ["none", "substantiation", "potentially_high", "uncertain"] as const;
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
export type PolicyRelevance = typeof POLICY_RELEVANCES[number];
export type PolicyReason = typeof POLICY_REASONS[number];
export type HybridStatus = "no_match" | "review" | "attention" | "high";

export interface InterpreterCategoryAssessment {
  risk_family: Exclude<RiskFamily, "none">;
  relevance: 0 | 1 | 2 | 3 | 4;
  certainty: 0 | 1 | 2 | 3 | 4;
  harm: 0 | 1 | 2 | 3 | 4;
  deception: 0 | 1 | 2 | 3 | 4;
  vulnerability: 0 | 1 | 2 | 3 | 4;
  privacy_intrusion: 0 | 1 | 2 | 3 | 4;
  evidence_strength: 0 | 1 | 2 | 3 | 4;
}

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
  // Optional in the construction type so legacy fixtures can still compile; the strict
  // runtime validator and both JSON Schemas require and normalize these v0.4.1 fields.
  policy_relevance?: PolicyRelevance;
  risk_family?: RiskFamily;
  confidence: number;
  evidence_spans: EvidenceSpan[];
  policy_reason: PolicyReason;
  category_assessments?: InterpreterCategoryAssessment[];
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
  providerRequestMs: number;
  validationMs: number;
  timeoutStage: "provider_request" | "validation" | null;
  resourceExhausted?: boolean;
  retryAfterSeconds?: number | null;
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
  score: number | null;
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
  "policy_relevance",
  "risk_family",
  "confidence",
  "evidence_spans",
  "policy_reason",
] as const;

const PROVIDER_RESPONSE_KEYS = [
  "schema_version",
  "risk_intent",
  "speech_act",
  "claim_target",
  "context_relation",
  "actor",
  "claim_strength",
  "policy_relevance",
  "risk_family",
  "confidence",
  "evidence_quotes",
  "policy_reason",
] as const;

const OPTIONAL_RESPONSE_KEYS = ["category_assessments"] as const;
const ALLOWED_RESPONSE_KEYS = [...RESPONSE_KEYS, ...OPTIONAL_RESPONSE_KEYS] as const;
const OPTIONAL_PROVIDER_RESPONSE_KEYS = ["category_assessments"] as const;
const ALLOWED_PROVIDER_RESPONSE_KEYS = [...PROVIDER_RESPONSE_KEYS, ...OPTIONAL_PROVIDER_RESPONSE_KEYS] as const;

const CATEGORY_ASSESSMENT_PROPERTIES = {
  risk_family: { type: "string", enum: RISK_FAMILIES.filter((family) => family !== "none") },
  relevance: { type: "integer", minimum: 0, maximum: 4 },
  certainty: { type: "integer", minimum: 0, maximum: 4 },
  harm: { type: "integer", minimum: 0, maximum: 4 },
  deception: { type: "integer", minimum: 0, maximum: 4 },
  vulnerability: { type: "integer", minimum: 0, maximum: 4 },
  privacy_intrusion: { type: "integer", minimum: 0, maximum: 4 },
  evidence_strength: { type: "integer", minimum: 0, maximum: 4 },
} as const;

const CATEGORY_ASSESSMENT_KEYS = Object.keys(CATEGORY_ASSESSMENT_PROPERTIES);

function categoryAssessments(value: unknown, errors: string[]): InterpreterCategoryAssessment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) {
    errors.push("category_assessments must be an array with at most 5 items");
    return [];
  }
  const seen = new Set<string>();
  const assessments: InterpreterCategoryAssessment[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      errors.push(`category_assessments[${index}] must be an object`);
      continue;
    }
    const keys = Object.keys(raw);
    if (keys.length !== CATEGORY_ASSESSMENT_KEYS.length || !CATEGORY_ASSESSMENT_KEYS.every((key) => keys.includes(key))) {
      errors.push(`category_assessments[${index}] fields are invalid`);
      continue;
    }
    if (!includesValue(RISK_FAMILIES, raw.risk_family) || raw.risk_family === "none") {
      errors.push(`category_assessments[${index}].risk_family is invalid`);
      continue;
    }
    if (seen.has(raw.risk_family)) {
      errors.push(`category_assessments contains duplicate risk_family: ${raw.risk_family}`);
      continue;
    }
    const axes = CATEGORY_ASSESSMENT_KEYS.filter((key) => key !== "risk_family");
    if (!axes.every((key) => Number.isInteger(raw[key]) && Number(raw[key]) >= 0 && Number(raw[key]) <= 4)) {
      errors.push(`category_assessments[${index}] axes must be integers from 0 to 4`);
      continue;
    }
    seen.add(raw.risk_family);
    assessments.push(raw as unknown as InterpreterCategoryAssessment);
  }
  return assessments;
}

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
    if (!(ALLOWED_RESPONSE_KEYS as readonly string[]).includes(key)) errors.push(`허용되지 않은 필드: ${key}`);
  }
  if (value.schema_version !== INTERPRETER_SCHEMA_VERSION) {
    errors.push(`schema_version이 ${INTERPRETER_SCHEMA_VERSION}이 아닙니다.`);
  }
  if (!includesValue(RISK_INTENTS, value.risk_intent)) errors.push("risk_intent enum 오류");
  if (!includesValue(SPEECH_ACTS, value.speech_act)) errors.push("speech_act enum 오류");
  if (!includesValue(CLAIM_TARGETS, value.claim_target)) errors.push("claim_target enum 오류");
  if (!includesValue(CONTEXT_RELATIONS, value.context_relation)) errors.push("context_relation enum 오류");
  if (!includesValue(ACTORS, value.actor)) errors.push("actor enum 오류");
  if (!includesValue(CLAIM_STRENGTHS, value.claim_strength)) errors.push("claim_strength enum 오류");
  if (!includesValue(POLICY_RELEVANCES, value.policy_relevance)) errors.push("policy_relevance enum 오류");
  if (!includesValue(RISK_FAMILIES, value.risk_family)) errors.push("risk_family enum 오류");
  if (!includesValue(POLICY_REASONS, value.policy_reason)) errors.push("policy_reason enum 오류");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1) {
    errors.push("confidence는 0~1의 유한한 숫자여야 합니다.");
  }

  const normalizedSpans: EvidenceSpan[] = [];
  const normalizedAssessments = categoryAssessments(value.category_assessments, errors);
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
  if (["direct_promotional", "direct_harmful"].includes(String(value.risk_intent)) && normalizedSpans.length === 0) {
    errors.push("직접 위험 판단에는 검증 가능한 evidence span이 필요합니다.");
  }
  if (["direct_promotional", "direct_harmful"].includes(String(value.risk_intent)) && value.speech_act !== "claim") {
    errors.push("직접 위험 판단은 speech_act=claim이어야 합니다.");
  }
  if (["direct_promotional", "direct_harmful"].includes(String(value.risk_intent)) && value.context_relation !== "supports") {
    errors.push("직접 위험 판단은 context_relation=supports여야 합니다.");
  }
  if (["warning", "criticism", "report"].includes(String(value.speech_act))
    && value.context_relation === "supports") {
    errors.push("warning/criticism/report는 context_relation=supports일 수 없습니다.");
  }
  if (value.policy_relevance === "none" && value.risk_family !== "none") {
    errors.push("policy_relevance=none이면 risk_family=none이어야 합니다.");
  }
  if (["substantiation", "potentially_high"].includes(String(value.policy_relevance))
    && value.risk_family === "none") {
    errors.push("정책 관련 주장은 구체적인 risk_family가 필요합니다.");
  }
  if (value.risk_intent === "contextual_only"
    && ["warning", "criticism", "report", "definition"].includes(String(value.speech_act))
    && value.policy_relevance !== "none") {
    errors.push("경고·비판·보도·정의 문맥은 policy_relevance=none이어야 합니다.");
  }
  if (value.policy_relevance === "none" && normalizedAssessments.length > 0) {
    errors.push("policy_relevance=none이면 category_assessments는 비어 있어야 합니다.");
  }
  if (normalizedAssessments.length > 0 && normalizedSpans.length === 0) {
    errors.push("category_assessments에는 검증 가능한 evidence span이 필요합니다.");
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
      policy_relevance: value.policy_relevance as PolicyRelevance,
      risk_family: value.risk_family as RiskFamily,
      confidence: value.confidence as number,
      evidence_spans: normalizedSpans,
      policy_reason: value.policy_reason as PolicyReason,
      category_assessments: normalizedAssessments,
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
    policy_relevance: { type: "string", enum: [...POLICY_RELEVANCES] },
    risk_family: { type: "string", enum: [...RISK_FAMILIES] },
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
    category_assessments: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: [...CATEGORY_ASSESSMENT_KEYS],
        properties: CATEGORY_ASSESSMENT_PROPERTIES,
      },
    },
  },
};

export const INTERPRETER_PROVIDER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [...PROVIDER_RESPONSE_KEYS],
  properties: {
    schema_version: { const: INTERPRETER_SCHEMA_VERSION },
    risk_intent: { type: "string", enum: [...RISK_INTENTS] },
    speech_act: { type: "string", enum: [...SPEECH_ACTS] },
    claim_target: { type: "string", enum: [...CLAIM_TARGETS] },
    context_relation: { type: "string", enum: [...CONTEXT_RELATIONS] },
    actor: { type: "string", enum: [...ACTORS] },
    claim_strength: { type: "string", enum: [...CLAIM_STRENGTHS] },
    policy_relevance: { type: "string", enum: [...POLICY_RELEVANCES] },
    risk_family: { type: "string", enum: [...RISK_FAMILIES] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence_quotes: {
      type: "array",
      maxItems: 5,
      items: { type: "string", minLength: 1 },
    },
    policy_reason: { type: "string", enum: [...POLICY_REASONS] },
    category_assessments: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: [...CATEGORY_ASSESSMENT_KEYS],
        properties: CATEGORY_ASSESSMENT_PROPERTIES,
      },
    },
  },
};

function exactQuoteOccurrences(text: string, quote: string): EvidenceSpan[] {
  const occurrences: EvidenceSpan[] = [];
  for (let start = text.indexOf(quote); start >= 0; start = text.indexOf(quote, start + 1)) {
    occurrences.push({ start, end: start + quote.length, text: quote });
  }
  return occurrences;
}

function spanGap(left: EvidenceSpan, right: EvidenceSpan) {
  if (left.end < right.start) return right.start - left.end;
  if (right.end < left.start) return left.start - right.end;
  return 0;
}

function resolveEvidenceQuotes(
  quotes: readonly string[],
  prepared: PreparedInterpreterInput,
): { success: true; spans: EvidenceSpan[] } | { success: false; errors: string[] } {
  const errors: string[] = [];
  if (new Set(quotes).size !== quotes.length) {
    return { success: false, errors: ["evidence_quotes에 중복 quote가 있습니다."] };
  }
  const candidates = quotes.map((quote, index) => {
    if (!quote) {
      errors.push(`evidence_quotes[${index}]는 빈 문자열일 수 없습니다.`);
      return [];
    }
    const occurrences = exactQuoteOccurrences(prepared.modelText, quote);
    if (occurrences.length === 0) {
      errors.push(`evidence_quotes[${index}]가 입력의 정확한 substring이 아닙니다.`);
    }
    return occurrences;
  });
  if (errors.length > 0) return { success: false, errors };
  if (candidates.length === 0) return { success: true, spans: [] };
  if (candidates.every((items) => items.length === 1)) {
    return { success: true, spans: candidates.map((items) => items[0]) };
  }
  if (candidates.length === 1) {
    return { success: false, errors: ["evidence quote가 여러 위치에 있어 offset을 확정할 수 없습니다."] };
  }

  const combinations: EvidenceSpan[][] = [];
  const limit = 10_000;
  function visit(index: number, chosen: EvidenceSpan[]) {
    if (combinations.length > limit) return;
    if (index === candidates.length) {
      combinations.push([...chosen]);
      return;
    }
    for (const candidate of candidates[index]) {
      chosen.push(candidate);
      visit(index + 1, chosen);
      chosen.pop();
      if (combinations.length > limit) return;
    }
  }
  visit(0, []);
  if (combinations.length > limit) {
    return { success: false, errors: ["evidence quote 위치 조합이 너무 많아 offset을 확정할 수 없습니다."] };
  }

  const ranked = combinations.map((spans) => {
    let totalGap = 0;
    for (let left = 0; left < spans.length; left += 1) {
      for (let right = left + 1; right < spans.length; right += 1) {
        totalGap += spanGap(spans[left], spans[right]);
      }
    }
    const width = Math.max(...spans.map((span) => span.end)) - Math.min(...spans.map((span) => span.start));
    return { spans, totalGap, width };
  }).sort((left, right) => left.totalGap - right.totalGap || left.width - right.width);
  const best = ranked[0];
  const tied = ranked.filter((item) => item.totalGap === best.totalGap && item.width === best.width);
  if (tied.length !== 1) {
    return { success: false, errors: ["evidence quote의 가장 가까운 위치 조합이 둘 이상입니다."] };
  }
  return { success: true, spans: best.spans };
}

export function validateProviderInterpreterPayload(
  value: unknown,
  prepared: PreparedInterpreterInput,
): { success: true; payload: InterpreterPayload } | { success: false; errors: string[] } {
  if (!isRecord(value)) return { success: false, errors: ["provider 응답은 JSON 객체여야 합니다."] };
  const errors: string[] = [];
  const keys = Object.keys(value);
  for (const key of PROVIDER_RESPONSE_KEYS) {
    if (!keys.includes(key)) errors.push(`provider 필수 필드 누락: ${key}`);
  }
  for (const key of keys) {
    if (!(ALLOWED_PROVIDER_RESPONSE_KEYS as readonly string[]).includes(key)) {
      errors.push(`provider에 허용되지 않은 필드: ${key}`);
    }
  }
  if (!Array.isArray(value.evidence_quotes)
    || !value.evidence_quotes.every((quote) => typeof quote === "string")) {
    errors.push("evidence_quotes는 문자열 배열이어야 합니다.");
  }
  if (errors.length > 0) return { success: false, errors };
  const resolved = resolveEvidenceQuotes(value.evidence_quotes as string[], prepared);
  if (!resolved.success) return resolved;
  const internalValue = { ...value };
  delete internalValue.evidence_quotes;
  internalValue.evidence_spans = resolved.spans;
  return validateInterpreterPayload(internalValue, prepared);
}

export const INTERPRETER_SYSTEM_PROMPT = `당신은 RiskShield의 한국어 텍스트 위험 문맥 Interpreter입니다.
게시 가능 여부나 법률 위반 여부를 최종 판단하지 마세요.
규칙 엔진의 결과를 추측하지 말고 입력 문구의 발화 목적, 행위자, 대상, 부정·대조·인용 관계와 RiskShield 정책 관련성만 독립적으로 구조화하세요.
과장·기만 광고뿐 아니라 혐오·차별, 직접 모욕, 숨은 커뮤니티 은어, 폭력적 위협을 분석하세요.
위험 표현을 인용·비판·경고·보도·정의하는 문맥과 화자의 직접 유해 발화를 구분하세요.
직접 혐오·모욕·은어 공격·위협은 direct_harmful, claim, supports로 분류하고 정확한 evidence를 제공하세요.
광고성 표현이라는 이유만으로 위험 관련이라고 판정하지 마세요. 직접 광고와 위험 광고는 다릅니다.
CTA, 상품 소개, 기능 안내, 사용 절차, 과거 사건 제목은 구체적인 위험 요소가 없으면 policy_relevance=none일 수 있습니다.
비교·실적·최상급·할인 조건처럼 근거 확인이 필요한 경우에만 substantiation을 사용하세요.
결과 보장, 효능 확정, 금융·수익 보장, 교육·법률 결과 약속, 비동의 감시처럼 고위험 가능성이 있을 때만 potentially_high를 사용하세요.
문맥이 부족하거나 판단할 수 없으면 policy_relevance=uncertain을 사용하세요.
policy_relevance=none이면 risk_family=none이어야 하며, substantiation 또는 potentially_high이면 가장 구체적인 risk_family를 선택하세요.
대조 예시:
- “너는 정말 느개미다” → direct_harmful, claim, supports, claim_target=individual, risk_family=coded_expression
- “특정 지역 사람은 원래 열등하다” → direct_harmful, claim, supports, claim_target=regional_group, risk_family=hate_discrimination
- “'느개미'라는 표현은 쓰지 마세요” → contextual_only, warning, warns_about, policy_relevance=none, evidence_quotes=[]
- “느개미는 온라인 비하 은어를 뜻합니다” → contextual_only, definition, defines, policy_relevance=none, evidence_quotes=[]
- “지금 무료로 시작해 보세요” → direct_promotional, claim, supports일 수 있지만 policy_relevance=none, risk_family=none
- “앱에서 메뉴를 검색한 뒤 추가를 클릭합니다” → contextual_only, condition, conditions, policy_relevance=none, risk_family=none, evidence_quotes=[]
- “강의 자료를 제공합니다” → policy_relevance=none, risk_family=none
- “과거 사건 사례를 소개합니다” → contextual_only, report, reports, policy_relevance=none, risk_family=none, evidence_quotes=[]
- “상위권 기준 월 450만 원 미만의 부수입을 올리는 판매자도 있습니다”처럼 정보성 가이드에서 일부 판매자 사례를 설명하고 독자 수익을 보장하지 않는 문장 → contextual_only, report, reports, policy_relevance=none
- “수익화 실전 강의”, “고수익 중개 시스템”처럼 수익 기회를 직접 홍보하는 상품 제목 → policy_relevance=substantiation, risk_family=income_claim
- 구체적인 비교·성과·결과 약속이 없는 “프리미엄 원스톱 서비스” 같은 일반 포지셔닝 문구 → policy_relevance=none
- 과거 완료 사건의 결과를 제목으로 소개할 뿐 미래 결과 약속이나 CTA가 없는 문구 → contextual_only, report, reports, policy_relevance=none
- 이미 실패한 환불 약속을 가정하고 소비자의 대응을 묻는 문구 → contextual_only, warning, warns_about, policy_relevance=none
- 기술 수준과 무관하게 누구나 도구로 뛰어난 결과물을 만들 수 있다고 직접 홍보하는 문구 → policy_relevance=substantiation, risk_family=general_substantiation
- “업계 최고 수준”, “지난해 성공률 95%”, “지금 25% 할인 중” → 문맥에 따라 substantiation 또는 none
- “누구나 월 300만원을 보장합니다”, “부작용이 전혀 없습니다”, “전원 합격을 약속합니다”, “상대방 몰래 메시지를 확인합니다” → potentially_high
원문에 없는 사실이나 근거를 만들지 마세요. evidence_quotes에는 제공된 입력에서 그대로 복사한 정확한 연속 substring만 사용하고 offset은 만들지 마세요.
confidence는 위험 점수가 아니라 문맥 해석의 확실성입니다. 명백한 일반 CTA·절차·과거 사례·경고를 policy_relevance=none으로 분류했더라도 해석이 명확하면 confidence를 불필요하게 낮추지 마세요.
category_assessments는 위험 점수를 직접 쓰는 곳이 아닙니다. 입력에서 evidence_quotes로 뒷받침되는 위험 분야마다 relevance, certainty, harm, deception, vulnerability, privacy_intrusion, evidence_strength를 0~4 정수로 평가하세요. 여러 분야가 동시에 존재하면 최대 5개까지 각각 반환하고, policy_relevance=none이면 빈 배열을 반환하세요. 점수 계산은 서버의 고정 공식이 수행합니다.
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
    ["regional_group", /(?:전라도|경상도|지역\s*사람|홍어)/u],
    ["protected_group", /(?:여자는|남자는|한남|한녀|김치녀|장애인|외국인|종교|인종)/u],
    ["community", /(?:일베충|노알라|운지|커뮤니티|도그휘슬)/u],
    ["individual", /(?:느개미|느금마|느금|병신|개새끼|씨발|꺼져|닥쳐|멍청이|쓰레기|죽여|죽인다|패버려)/u],
    ["privacy", /(?:위치|gps|추적|메시지|문자|대화|채팅|감시|몰래|상대방|배우자|아내|아이콘|스토커웨어|통화|녹음|오디오)/u],
    ["legal", /(?:승소|형량|무죄|기각|법률|변호사|손해배상|전관|합의금|불기소|감형|집행유예)/u],
    ["education", /(?:합격|진학|취업|특채|수강|학원|교육|자격증|수능|대학|로드맵)/u],
    ["health", /(?:부작용|안전성|자극|피부|콜라겐|시술|의료|치료|완치|질환|효능|키\s|성장|cm|kg|감량|체지방|건강)/u],
    ["finance", /(?:투자|수익|원금|고수익|마진|손실|손해|예금|배당|펀드|주식)/u],
    ["general", /(?:한정|마감|지금\s*구매|특별\s*혜택|소득|수입|부업|재택|월\s*\d+\s*만\s*원|\d+(?:[.]\d+)?\s*%|할인|업계\s*최고|만족도|조회수|절반|누구나|품질|상품|서비스|무료|개선|효과|결과)/u],
  ];
  const found = candidates.find(([, expression]) => expression.test(text));
  return found?.[0] ?? hint ?? "none";
}

function riskFamilyForText(text: string, target: ClaimTarget): RiskFamily {
  if (/(?:죽여|죽인다|패버려|때려죽|칼로|폭행|살해|불을\s*지르)/u.test(text)) return "violent_threat";
  if (/(?:운지|노알라|일베충|느개미|느금마|느금|숨은\s*은어|코드\s*표현|도그휘슬)/u.test(text)) return "coded_expression";
  if (/(?:한남|한녀|김치녀|맘충|틀딱|홍어|장애인|외국인|여자는|남자는)[^.!?\n]{0,40}(?:원래|다|혐오|꺼져|열등|문제|답이\s*없)/u.test(text)) return "hate_discrimination";
  if (/(?:병신|개새끼|씨발|꺼져|닥쳐|멍청이|쓰레기)[^.!?\n]{0,30}(?:너|새끼|놈|년|인간)?/u.test(text)) return "abusive_language";
  if (target === "health") return "health_claim";
  if (target === "privacy") return "privacy_intrusion";
  if (target === "education") return "education_outcome";
  if (target === "legal") return "legal_outcome";
  if (target === "finance") {
    return /(?:부업|수입|소득|월\s*\d+|고수익|수익화|판매자|수강생)/u.test(text)
      ? "income_claim"
      : "financial_guarantee";
  }
  if (/(?:마감|한정|지금\s*(?:구매|신청)|오늘만|서두르)/u.test(text)) return "urgency";
  return "general_substantiation";
}

function classifyMock(prepared: PreparedInterpreterInput, hint?: ClaimTarget): InterpreterPayload {
  const text = prepared.modelText.toLocaleLowerCase("ko-KR");
  const hasContrastPromotion = /(?:하지만|그러나|그럼에도|그래도|이지만|불법이지만|사기라고\s*의심받지만)[^\n]{0,100}(?:지금|구매|신청|가입|투자|제공|해\s*드립니다|가능|보장|추적)/u.test(text);
  const report = /(?:보도|기사|보도입니다|보도했다|보도했습니다|편취|검거|기소|적발|피해가\s*발생|밝혔|판결|내용이다|사례로\s*소개)/u.test(text);
  const quote = /[“”「」『』"]/u.test(text) && /(?:문구|표현|주장|내용|기사|인용|광고|말했|소개)/u.test(text);
  const criticism = /(?:과장(?:된|될|입니다|광고)?|허위|장담하는\s*광고|문제(?:가|점|인)|오인|비판|지나치게\s*장담)/u.test(text);
  const warning = /(?:주의|경계|피하|사기|불법|형사처벌|처벌\s*대상|금지|불가|위험|피해\s*예방|사용하지\s*마세요|쓰지\s*마세요|경고등|동의\s*없이[^\n]{0,40}(?:안\s*됩|처벌|불법|위반))/u.test(text);
  const definition = /(?:이란|란)\s|(?:뜻|의미)(?:합니다|입니다|한다)|정의(?:는|입니다)|(?:교육|분석)\s*자료에서[^\n]{0,30}(?:분석|설명)|정책[^\n]{0,24}설명/u.test(text);
  const procedure = /(?:메뉴|설정|패널|앱|페이지)[^\n]{0,60}(?:열고|선택|검색|클릭|추가)|(?:검색|선택|입력)한\s*(?:뒤|다음)|단계별|사용\s*(?:방법|절차)/u.test(text);
  const reviewClaim = /(?:자극\s*없이|콜라겐[^\n]{0,24}촉진|뛰어난[^\n]{0,24}(?:개선|효과)|가장\s*완벽|과정\s*전체[^\n]{0,20}책임|결과(?:는|가)?\s*180도|제한\s*없음|어플리케이션을\s*열지\s*않아도|가장\s*쉽고\s*안전|모든\s*통화를\s*녹음)/u.test(text);
  const condition = procedure || /(?:에\s*따라|계약상|근로계약|약관|한도(?:까지|는)|동의를\s*받아|동의한\s*경우|본인\s*(?:계정|기기)|기본급|제도상|보호됩니다|지급됩니다|보상\s*범위|현재\s*측정|과거[^\n]{0,30}(?:기록|실적|검사)|일정\s*안내|참고용|상담(?:하세요|하시기|이\s*필요)|가능성을\s*높이기|손실\s*가능성|개인차|심사(?:로|를\s*통해)\s*결정|성과에\s*따라|달라질\s*수|정보를\s*제공|개인정보\s*보호)/u.test(text);
  const negates = /(?:보장할\s*수(?:\s*있는[^\n]{0,30})?\s*없|보장되지\s*않|보장하지(?:는|도)?\s*않|보장하는[^\n]{0,30}(?:아니|없)|아닙니다|아니다|불가능|없다고[^\n]{0,30}(?:말|단정)할\s*수\s*없|사용하면\s*안|해서는\s*안|사용하지\s*마세요|쓰지\s*마세요)/u.test(text);

  const speechAct: InterpreterSpeechAct = hasContrastPromotion
    ? "claim"
    : report ? "report"
      : quote ? "quote"
        : warning ? "warning"
          : criticism ? "criticism"
            : reviewClaim ? "claim"
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
      policy_relevance: "none",
      risk_family: "none",
      confidence: 0.96,
      evidence_spans: [],
      policy_reason: reason[speechAct as Exclude<InterpreterSpeechAct, "claim">],
    };
  }

  const target = targetForText(text, hint);
  const ambiguousFragment = /^(?:단\s*1회,?\s*6분\s*사용으로|합격하는\s*프로젝트)$/u.test(text.trim());
  if (ambiguousFragment) {
    return {
      schema_version: INTERPRETER_SCHEMA_VERSION,
      risk_intent: "uncertain",
      speech_act: "claim",
      claim_target: target,
      context_relation: "unclear",
      actor: "unknown",
      claim_strength: "unclear",
      policy_relevance: "uncertain",
      risk_family: "none",
      confidence: 0.45,
      evidence_spans: [],
      policy_reason: "UNCERTAIN_INTENT",
    };
  }

  const ordinaryInformation = /(?:지금\s*온라인\s*비즈니스를\s*시작하세요[^\n]*무료|판매자도\s*있습니다|강의자료[^\n]*(?:공개|제공)|프리미엄\s*원스톱\s*토탈케어\s*로펌|(?:전부|모두)\s*승소$|과거[^\n]*(?:사례|결과|기록)|사례를\s*소개|운영\s*결과\s*보고서|faq|주요\s*질문\s*모음)/u.test(text);
  const ordinaryProduct = /(?:새\s*컬렉션을\s*둘러보|원하는\s*요금제를\s*선택|서비스를\s*이용할\s*수\s*있|가볍고\s*휴대하기\s*편|상품을\s*소개)/u.test(text);
  if (procedure || ordinaryInformation || ordinaryProduct) {
    const isReport = /(?:승소|과거|사례|보고서|판매자도\s*있습니다)/u.test(text);
    return {
      schema_version: INTERPRETER_SCHEMA_VERSION,
      risk_intent: isReport || procedure ? "contextual_only" : "direct_promotional",
      speech_act: isReport ? "report" : procedure ? "condition" : "claim",
      claim_target: target,
      context_relation: isReport ? "reports" : procedure ? "conditions" : "supports",
      actor: isReport ? "reporter" : "advertiser",
      claim_strength: "none",
      policy_relevance: "none",
      risk_family: "none",
      confidence: 0.94,
      evidence_spans: isReport || procedure ? [] : firstEvidenceSpan(prepared),
      policy_reason: isReport ? "CONTEXT_REPORT" : procedure ? "LEGITIMATE_CONDITION" : "NO_RISK_CLAIM",
    };
  }

  const absolute = /(?:100\s*%|무조건|반드시|절대|하나도|전혀|누구나|모두|전원|보장|확정|책임(?:집|지)|단\s*\d+\s*시간|\d+\s*시간\s*한정)/u.test(text);
  const strong = /(?:\d+(?:[.]\d+)?\s*(?:cm|kg|%|만원)|볼\s*수\s*있|읽을\s*수\s*있|확인할\s*수\s*있|추적|숨기|표시되지|합격시켜|특채|고수익|고소득|수익|성장|효과|환불|회수|마감|지금\s*구매|한정\s*특별\s*혜택)/u.test(text);
  const limited = /(?:가능성|예상|평균|최대|약\s*\d|일정\s*수준|도움)/u.test(text);
  const potentiallyHigh = /(?:누구나|모두|전원|100\s*%|무조건|반드시|절대|전혀)[^\n]{0,60}(?:보장|약속|합격|수익|부작용|효과)|(?:부작용|자극)[^\n]{0,30}(?:전혀|없음|없이)|(?:상대방|배우자|타인)[^\n]{0,30}(?:몰래|동의\s*없이|추적|확인)|(?:몰래|동의\s*없이)[^\n]{0,30}(?:메시지|통화|위치|사진)/u.test(text);
  const substantiation = reviewClaim || /(?:업계\s*최고|가장\s*(?:완벽|안전|쉽)|\d+(?:[.]\d+)?\s*%|\d+명의|절반|고수익|뛰어난|촉진|개선\s*효과|본연의\s*톤|결과는\s*180도|책임져야|합격할\s*수|수익화)/u.test(text);
  const harmfulFamily = riskFamilyForText(text, target);
  const directHarmful = ["hate_discrimination", "abusive_language", "coded_expression", "violent_threat"].includes(harmfulFamily);
  const direct = directHarmful || (target !== "none" && (absolute || strong || limited || hasContrastPromotion || substantiation));

  if (direct) {
    const strength: ClaimStrength = absolute ? "absolute" : strong ? "strong" : "limited";
    const policyReason: PolicyReason = hasContrastPromotion
      ? "CONTRASTED_PROMOTION"
      : strength === "absolute" ? "DIRECT_ABSOLUTE_CLAIM"
        : strength === "strong" ? "DIRECT_STRONG_RESULT"
          : "DIRECT_LIMITED_CLAIM";
    const confidence = strength === "limited" ? 0.74 : 0.94;
    const evidenceExpression = /(?:느개미|느금마|느금|운지|노알라|일베충|한남|한녀|김치녀|맘충|틀딱|홍어|병신|개새끼|씨발|꺼져|닥쳐|멍청이|쓰레기|죽여|죽인다|패버려|때려죽|100\s*%|무조건|반드시|절대|하나도|전혀|누구나|모두|전원|보장|확정|\d+(?:[.]\d+)?\s*(?:cm|kg|%|만원)|볼\s*수\s*있|읽을\s*수\s*있|확인할\s*수\s*있|추적|숨기|표시되지|합격시켜|고수익|고소득|수익|성장|효과|환불|마감|한정)/u;
    return {
      schema_version: INTERPRETER_SCHEMA_VERSION,
      risk_intent: directHarmful ? "direct_harmful" : "direct_promotional",
      speech_act: "claim",
      claim_target: target,
      context_relation: "supports",
      actor: directHarmful ? "speaker" : "advertiser",
      claim_strength: strength,
      policy_relevance: potentiallyHigh ? "potentially_high" : "substantiation",
      risk_family: harmfulFamily,
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
    policy_relevance: "none",
    risk_family: "none",
    confidence: 0.92,
    evidence_spans: [],
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
    const validationStart = performance.now();
    const validated = validateInterpreterPayload(raw, prepared);
    const validationMs = elapsedMs(validationStart);
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
      providerRequestMs: 0,
      validationMs,
      timeoutStage: null,
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
        providerRequestMs: 0,
        validationMs: 0,
        timeoutStage: null,
      };
    }
    const validationStart = performance.now();
    const validated = validateInterpreterPayload(record.response, prepared);
    const validationMs = elapsedMs(validationStart);
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
      providerRequestMs: 0,
      validationMs,
      timeoutStage: null,
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
    const providerStart = performance.now();
    try {
      const result = await this.provider.complete({
        systemPrompt: INTERPRETER_SYSTEM_PROMPT,
        userPrompt: buildInterpreterUserPrompt(prepared, request.domainHint),
        schema: INTERPRETER_PROVIDER_JSON_SCHEMA,
        signal: controller.signal,
      });
      const providerRequestMs = elapsedMs(providerStart);
      const validationStart = performance.now();
      const validated = validateProviderInterpreterPayload(result.output, prepared);
      const validationMs = elapsedMs(validationStart);
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
        providerRequestMs,
        validationMs,
        timeoutStage: null,
      };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      const resourceExhausted = !timedOut && isRecord(error) && error.resourceExhausted === true;
      const retryAfterSeconds = resourceExhausted && typeof error.retryAfterSeconds === "number"
        ? error.retryAfterSeconds
        : null;
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
        providerRequestMs: elapsedMs(providerStart),
        validationMs: 0,
        timeoutStage: timedOut ? "provider_request" : null,
        resourceExhausted,
        retryAfterSeconds,
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
  if (payload.risk_intent === "uncertain"
    || payload.policy_relevance === "uncertain") return "review";
  if (payload.policy_relevance === "none"
    && payload.confidence >= SAFE_NO_MATCH_CONFIDENCE_THRESHOLD) return "no_match";
  if (payload.confidence < MEDIUM_CONFIDENCE_THRESHOLD) return "review";
  // AI-only 판단은 high로 승격하지 않는다. 규칙 증거와의 결합은 combineHybrid가 담당한다.
  return "review";
}

function riskFamilyFromRules(rules: AnalysisResult): RiskFamily {
  const primary = rules.primaryMatch?.skill;
  if (!primary) return "none";
  const value = `${primary.id} ${primary.category} ${primary.riskDomain}`.toLocaleLowerCase("ko-KR");
  if (/(privacy|개인정보|위치정보|사생활|감시)/u.test(value)) return "privacy_intrusion";
  if (/(legal|법률|행정|전문서비스)/u.test(value)) return "legal_outcome";
  if (/(education|교육|입시|합격|취업)/u.test(value)) return "education_outcome";
  if (/(medical|health|의료|치료|건강|효능|뷰티)/u.test(value)) return "health_claim";
  if (/(income|부업|수익|월급)/u.test(value)) return "income_claim";
  if (/(finance|금융|투자|원금|이자)/u.test(value)) return "financial_guarantee";
  if (/(urgency|긴급|마감|한정)/u.test(value)) return "urgency";
  return "general_substantiation";
}

function hasPromotionalCtaOrReversal(input: string): boolean {
  const normalized = input.replace(/\s+/g, " ").trim();
  const cta = /(?:지금\s*)?(?:신청|구매|가입|등록|예약|문의|상담|다운로드)(?:하세요|해\s*보세요|하기|하러|할인)?/u;
  const reversal = /(?:하지만|그러나|그렇지만|반면)[\s\S]{0,140}(?:지금|신청|구매|가입|등록|예약|문의|상담)/u;
  return cta.test(normalized) || reversal.test(normalized);
}

function reviewDecision(
  rules: AnalysisResult,
  reason: string,
  conflictReasons: string[],
  conflict = conflictReasons.length > 0,
): HybridDecision {
  return {
    status: "review",
    // A review state is a routing decision, not a synthetic risk score.
    // Preserve a real rule score when evidence exists; otherwise expose the
    // absence of a score instead of inventing the old 55-point floor.
    score: rules.finalScore > 0 ? rules.finalScore : null,
    conflict,
    conflictReasons,
    recoveredByInterpreter: false,
    suppressedHigh: rules.status === "high",
    reason,
  };
}

export function combineHybrid(rules: AnalysisResult, run: InterpreterRun): HybridDecision {
  if (!run.ok || !run.payload) {
    const conflictReasons = run.timedOut
      ? ["interpreter_timeout"]
      : run.resourceExhausted
        ? ["interpreter_resource_exhausted"]
        : run.validationMs > 0
          ? ["interpreter_validation_failed"]
          : ["interpreter_provider_failed"];
    return reviewDecision(
      rules,
      run.timedOut
        ? "AI 문맥 분석이 시간 안에 완료되지 않아 담당자 검토로 전환했습니다."
        : "AI 문맥 분석 결과를 안전하게 검증할 수 없어 담당자 검토로 전환했습니다.",
      conflictReasons,
      true,
    );
  }

  const ai = run.payload;
  const hasRulesEvidence = rules.matches.length > 0;
  const rulesFamily = riskFamilyFromRules(rules);
  const familyConflict = hasRulesEvidence
    && ai.policy_relevance !== "none"
    && ai.risk_family !== "none"
    && rulesFamily !== "none"
    && ai.risk_family !== rulesFamily;
  const exactContextSuppression = ai.risk_intent === "contextual_only"
    && ["warning", "criticism", "report", "definition"].includes(ai.speech_act)
    && ["negates", "warns_about", "reports", "defines"].includes(ai.context_relation)
    && ai.policy_relevance === "none"
    && ai.confidence >= CONTEXT_SUPPRESSION_CONFIDENCE_THRESHOLD
    && !hasPromotionalCtaOrReversal(rules.input);

  if (exactContextSuppression) {
    return {
      status: "no_match",
      score: 0,
      conflict: rules.status !== "no_match",
      conflictReasons: rules.status !== "no_match" ? ["context_policy_suppression"] : [],
      recoveredByInterpreter: false,
      suppressedHigh: rules.status === "high",
      reason: "이 문구는 위험 표현을 설명하거나 경고하는 문맥으로 해석되었습니다.",
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
      reason: "명시된 조건이나 정상적인 안내 문맥으로 해석되었습니다.",
    };
  }

  if (familyConflict) {
    return reviewDecision(
      rules,
      "규칙과 AI가 서로 다른 위험 분야를 가리켜 담당자 확인이 필요합니다.",
      ["risk_family_mismatch"],
    );
  }

  const confidentSafeNoMatch = rules.status === "no_match"
    && ai.policy_relevance === "none"
    && ai.confidence >= SAFE_NO_MATCH_CONFIDENCE_THRESHOLD;
  if (ai.risk_intent === "uncertain"
    || ai.policy_relevance === "uncertain"
    || (ai.confidence < MEDIUM_CONFIDENCE_THRESHOLD && !confidentSafeNoMatch)) {
    const lowConfidence = ai.confidence < MEDIUM_CONFIDENCE_THRESHOLD;
    return reviewDecision(
      rules,
      lowConfidence
        ? "AI 문맥 분석의 확신도가 기준보다 낮아 담당자 검토가 필요합니다."
        : "문맥이 부족하거나 정책 관련성을 확정할 수 없어 담당자 검토가 필요합니다.",
      [lowConfidence ? "interpreter_low_confidence" : "interpreter_uncertain"],
      rules.status !== "review",
    );
  }

  if (rules.status === "no_match") {
    if (ai.policy_relevance === "none") {
      return {
        status: "no_match",
        score: 0,
        conflict: false,
        conflictReasons: [],
        recoveredByInterpreter: false,
        suppressedHigh: false,
        reason: "일반적인 광고·기능·절차 안내로, 현재 위험 정책과 직접 관련된 표현이 확인되지 않았습니다.",
      };
    }
    return reviewDecision(
      rules,
      ai.policy_relevance === "substantiation"
        ? "규칙에는 없지만 비교·실적·조건의 근거 확인이 필요해 담당자 검토로 전환했습니다."
        : "규칙에는 없지만 고위험 가능성이 있는 직접 주장으로 해석되어 담당자 검토가 필요합니다.",
      [ai.policy_relevance === "substantiation" ? "ai_only_substantiation" : "ai_only_potentially_high"],
      false,
    );
  }

  if (["direct_promotional", "direct_harmful"].includes(ai.risk_intent)
    && ai.speech_act === "claim"
    && ai.context_relation === "supports"
    && ai.policy_relevance === "potentially_high"
    && ai.risk_family === rulesFamily
    && ["absolute", "strong"].includes(ai.claim_strength)
    && ai.confidence >= HIGH_CONFIDENCE_THRESHOLD
    && ai.evidence_spans.length > 0) {
    return {
      status: "high",
      score: Math.max(80, rules.finalScore),
      conflict: false,
      conflictReasons: [],
      recoveredByInterpreter: false,
      suppressedHigh: false,
      reason: "구체적인 규칙 증거와 고신뢰 직접 고위험 주장이 같은 위험 분야에서 확인되었습니다.",
    };
  }

  if (ai.policy_relevance === "none") {
    return reviewDecision(
      rules,
      "AI는 정책과 무관한 문맥으로 보았지만 경고·정의 억제 조건을 모두 충족하지 않아 담당자 확인이 필요합니다.",
      ["rules_interpreter_disagreement"],
    );
  }

  return reviewDecision(
    rules,
    ai.policy_relevance === "substantiation"
      ? "비교·실적·조건의 근거를 확인해야 하므로 담당자 검토가 필요합니다."
      : "위험 관련 주장이 감지되었지만 자동 high 조건을 모두 충족하지 않아 담당자 검토가 필요합니다.",
    [],
    false,
  );
}

export function combinePrivateBetaHybrid(
  rules: AnalysisResult,
  run: InterpreterRun,
): HybridDecision {
  const decision = combineHybrid(rules, run);
  if (decision.status !== "no_match" || !decision.conflict) return decision;
  if (decision.conflictReasons.includes("context_policy_suppression")) return decision;
  return {
    ...decision,
    status: "review",
    score: rules.finalScore > 0 ? rules.finalScore : null,
    reason: "규칙과 AI의 위험 해석이 충돌해 자동 결론 대신 담당자 검토로 전환했습니다.",
  };
}
