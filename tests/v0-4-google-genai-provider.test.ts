import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERPRETER_JSON_SCHEMA,
  INTERPRETER_PROVIDER_JSON_SCHEMA,
  prepareInterpreterInput,
  validateInterpreterPayload,
  validateProviderInterpreterPayload,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-4/interpreter.ts";
import {
  GEMMA_LIVE_PILOT_MODEL,
  GoogleGenAiHttpError,
  GoogleGenAiProvider,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-4/google-genai-provider.ts";

const validArgs = {
  schema_version: "1.1.0",
  risk_intent: "contextual_only",
  speech_act: "warning",
  claim_target: "finance",
  context_relation: "warns_about",
  actor: "regulator",
  claim_strength: "none",
  policy_relevance: "none",
  risk_family: "none",
  confidence: 0.95,
  evidence_quotes: [],
  policy_reason: "CONTEXT_WARNING",
};

test("Google GenAI provider requires only the dedicated API-key environment variable", () => {
  assert.throws(() => GoogleGenAiProvider.fromEnvironment({}), /RISKSHIELD_INTERPRETER_API_KEY/u);
  assert.doesNotThrow(() => GoogleGenAiProvider.fromEnvironment({
    RISKSHIELD_INTERPRETER_API_KEY: "test-only-secret",
  }));
});

test("Schema 1.1.0 Google GenAI native REST uses forced function arguments without responseSchema", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedHeaders = new Headers();
  let capturedBody: {
    store?: boolean;
    toolConfig?: { functionCallingConfig?: { mode?: string } };
    tools?: Array<{ functionDeclarations?: Array<{
      parameters?: unknown;
      parametersJsonSchema?: Record<string, unknown>;
    }> }>;
    systemInstruction?: { parts?: Array<{ text?: string }> };
  } = {};
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      modelVersion: GEMMA_LIVE_PILOT_MODEL,
      candidates: [{ content: { parts: [{
        functionCall: { name: "submit_riskshield_interpretation", args: validArgs },
      }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = GoogleGenAiProvider.fromEnvironment({
      RISKSHIELD_INTERPRETER_API_KEY: "test-only-secret",
    });
    const result = await provider.complete({
      systemPrompt: "system",
      userPrompt: "user",
      schema: INTERPRETER_PROVIDER_JSON_SCHEMA,
      signal: new AbortController().signal,
    });
    assert.match(capturedUrl, /models\/gemma-4-26b-a4b-it:generateContent$/u);
    assert.equal(capturedHeaders.get("x-goog-api-key"), "test-only-secret");
    assert.equal(capturedHeaders.get("authorization"), null);
    assert.equal("responseSchema" in capturedBody, false);
    assert.equal(capturedBody.store, false);
    assert.equal(capturedBody.toolConfig?.functionCallingConfig?.mode, "ANY");
    const declaration = capturedBody.tools?.[0]?.functionDeclarations?.[0];
    assert.equal(declaration?.parameters, undefined);
    assert.equal(declaration?.parametersJsonSchema?.additionalProperties, false);
    assert.ok("evidence_quotes" in (declaration?.parametersJsonSchema?.properties as object));
    assert.equal("evidence_spans" in (declaration?.parametersJsonSchema?.properties as object), false);
    assert.match(capturedBody.systemInstruction?.parts?.[0]?.text ?? "", /UTF-16 길이는 0/u);
    assert.match(capturedBody.systemInstruction?.parts?.[0]?.text ?? "", /반드시 contextual_only/u);
    assert.deepEqual(result.output, validArgs);
    assert.deepEqual(result.tokenUsage, { input: 12, output: 7 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Schema 1.1.0 provider evidence quotes become exact UTF-16 spans without fuzzy correction", () => {
  const text = "😀근거입니다";
  const prepared = prepareInterpreterInput(text);
  const direct = {
    ...validArgs,
    risk_intent: "direct_promotional",
    speech_act: "claim",
    context_relation: "supports",
    actor: "advertiser",
    claim_strength: "strong",
    policy_relevance: "potentially_high",
    risk_family: "general_substantiation",
    evidence_quotes: ["근거"],
    policy_reason: "DIRECT_STRONG_RESULT",
  };
  const valid = validateProviderInterpreterPayload(direct, prepared);
  assert.equal(valid.success, true);
  if (valid.success) assert.deepEqual(valid.payload.evidence_spans, [{ start: 2, end: 4, text: "근거" }]);

  const changedWhitespace = validateProviderInterpreterPayload(
    { ...direct, evidence_quotes: ["근거 입니다"] },
    prepared,
  );
  assert.equal(changedWhitespace.success, false);
  if (!changedWhitespace.success) assert.match(changedWhitespace.errors.join(" "), /정확한 substring/u);
});

test("Schema 1.1.0 duplicate quote positions use a unique closest evidence combination or fail review-safe", () => {
  const anchoredText = "위험 문구가 멀리 있습니다. 위험 문구와 광고 근거";
  const anchored = validateProviderInterpreterPayload({
    ...validArgs,
    evidence_quotes: ["위험 문구", "광고 근거"],
  }, prepareInterpreterInput(anchoredText));
  assert.equal(anchored.success, true);
  if (anchored.success) {
    assert.equal(anchored.payload.evidence_spans[0].start, anchoredText.lastIndexOf("위험 문구"));
  }

  const ambiguous = validateProviderInterpreterPayload({
    ...validArgs,
    evidence_quotes: ["근거", "기준"],
  }, prepareInterpreterInput("근거 x 기준 x 근거"));
  assert.equal(ambiguous.success, false);
  if (!ambiguous.success) assert.match(ambiguous.errors.join(" "), /둘 이상/u);

  const unanchored = validateProviderInterpreterPayload({
    ...validArgs,
    evidence_quotes: ["근거"],
  }, prepareInterpreterInput("근거 그리고 근거"));
  assert.equal(unanchored.success, false);
  if (!unanchored.success) assert.match(unanchored.errors.join(" "), /확정할 수 없습니다/u);
});

test("Schema 1.1.0 semantic contradictions are rejected before they can become high", () => {
  const text = "광고 정의";
  const prepared = prepareInterpreterInput(text);
  const base = {
    schema_version: "1.1.0",
    risk_intent: "direct_promotional",
    speech_act: "definition",
    claim_target: "general",
    context_relation: "defines",
    actor: "advertiser",
    claim_strength: "strong",
    policy_relevance: "potentially_high",
    risk_family: "general_substantiation",
    confidence: 0.95,
    evidence_spans: [{ start: 0, end: text.length, text }],
    policy_reason: "DIRECT_STRONG_RESULT",
  };
  const directDefinition = validateInterpreterPayload(base, prepared);
  assert.equal(directDefinition.success, false);
  if (!directDefinition.success) assert.match(directDefinition.errors.join(" "), /speech_act=claim|context_relation=supports/u);

  const warningSupports = validateInterpreterPayload({
    ...base,
    risk_intent: "contextual_only",
    speech_act: "warning",
    context_relation: "supports",
    claim_strength: "none",
    policy_relevance: "none",
    risk_family: "none",
    evidence_spans: [],
    policy_reason: "CONTEXT_WARNING",
  }, prepared);
  assert.equal(warningSupports.success, false);
  if (!warningSupports.success) assert.match(warningSupports.errors.join(" "), /supports일 수 없습니다/u);
});

test("Google GenAI HTTP errors expose only status, Retry-After, and the 429 stop signal", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("secret response body", {
    status: 429,
    headers: { "retry-after": "17" },
  });
  try {
    const provider = new GoogleGenAiProvider("test-only-secret");
    await assert.rejects(
      provider.complete({
        systemPrompt: "system",
        userPrompt: "user",
        schema: INTERPRETER_JSON_SCHEMA,
        signal: new AbortController().signal,
      }),
      (error) => {
        assert.ok(error instanceof GoogleGenAiHttpError);
        assert.equal(error.status, 429);
        assert.equal(error.resourceExhausted, true);
        assert.equal(error.retryAfterSeconds, 17);
        assert.equal(error.message, "Google GenAI RESOURCE_EXHAUSTED (429); retry_after_seconds=17");
        assert.doesNotMatch(error.message, /secret/u);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
