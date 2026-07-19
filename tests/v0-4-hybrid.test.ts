import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeText,
  parseCsv,
  starterSkills,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";
import {
  INTERPRETER_JSON_SCHEMA,
  INTERPRETER_SCHEMA_VERSION,
  LiveInterpreter,
  MockInterpreter,
  RecordedInterpreter,
  combineHybrid,
  maskSensitiveText,
  prepareInterpreterInput,
  toRecordedInterpreterRecord,
  validateInterpreterPayload,
  type InterpreterPayload,
  type LiveProvider,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-4/interpreter.ts";
import {
  OpenAiCompatibleProvider,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-4/openai-compatible-provider.ts";

function payloadFor(text: string, overrides: Partial<InterpreterPayload> = {}): InterpreterPayload {
  return {
    schema_version: INTERPRETER_SCHEMA_VERSION,
    risk_intent: "direct_promotional",
    speech_act: "claim",
    claim_target: "general",
    context_relation: "supports",
    actor: "advertiser",
    claim_strength: "strong",
    policy_relevance: "potentially_high",
    risk_family: "general_substantiation",
    confidence: 0.93,
    evidence_spans: [{ start: 0, end: text.length, text }],
    policy_reason: "DIRECT_STRONG_RESULT",
    ...overrides,
  };
}

test("Schema 1.1.0 strict validator accepts grounded JSON and rejects extra fields or fabricated spans", () => {
  const text = "지금 신청하면 결과가 크게 개선됩니다";
  const prepared = prepareInterpreterInput(text);
  const valid = validateInterpreterPayload(payloadFor(text), prepared);
  assert.equal(valid.success, true);

  const extra = validateInterpreterPayload({ ...payloadFor(text), explanation: "free text" }, prepared);
  assert.equal(extra.success, false);
  if (!extra.success) assert.match(extra.errors.join(" "), /허용되지 않은 필드/u);

  const fabricated = validateInterpreterPayload({
    ...payloadFor(text),
    evidence_spans: [{ start: 0, end: 2, text: "없는 근거" }],
  }, prepared);
  assert.equal(fabricated.success, false);
  if (!fabricated.success) assert.match(fabricated.errors.join(" "), /substring/u);

  const outside = validateInterpreterPayload({
    ...payloadFor(text),
    evidence_spans: [{ start: 0, end: text.length + 1, text }],
  }, prepared);
  assert.equal(outside.success, false);
});

test("privacy preparation masks identifiers without changing UTF-16 offsets", () => {
  const source = "홍길동 님, 이메일 test@example.com, 전화 010-1234-5678, 서울 강남구 테헤란로 1";
  const masked = maskSensitiveText(source);
  assert.equal(masked.maskedText.length, source.length);
  assert.ok(masked.ranges.length >= 4);
  assert.doesNotMatch(masked.maskedText, /홍길동|test@example[.]com|010-1234-5678|테헤란로/u);

  const prepared = prepareInterpreterInput(source);
  const overlap = validateInterpreterPayload(payloadFor(prepared.modelText), prepared);
  assert.equal(overlap.success, false);
  if (!overlap.success) assert.match(overlap.errors.join(" "), /마스킹/u);
});

test("MockInterpreter is deterministic, schema-valid, and independent from rule results", async () => {
  const interpreter = new MockInterpreter();
  const input = "이 프로그램을 쓰면 배우자의 사진을 원격으로 볼 수 있습니다";
  const runs = await Promise.all([0, 1, 2].map(() => interpreter.interpret({ text: input })));
  assert.ok(runs.every((run) => run.ok && run.schemaValid));
  assert.ok(runs.every((run) => JSON.stringify(run.payload) === JSON.stringify(runs[0].payload)));
  assert.equal(runs[0].payload?.risk_intent, "direct_promotional");
  assert.equal(runs[0].payload?.claim_target, "privacy");
});

test("RecordedInterpreter replays by input hash and fails closed when a record is absent", async () => {
  const input = "단 48시간 동안만 신청할 수 있습니다";
  const mockRun = await new MockInterpreter().interpret({ text: input });
  const record = toRecordedInterpreterRecord(mockRun);
  const interpreter = new RecordedInterpreter([record]);
  const first = await interpreter.interpret({ text: input });
  const second = await interpreter.interpret({ text: input });
  assert.equal(first.ok, true);
  assert.deepEqual(first.payload, second.payload);
  assert.equal(first.mode, "recorded");

  const missing = await interpreter.interpret({ text: "기록되지 않은 입력" });
  assert.equal(missing.ok, false);
  assert.equal(missing.schemaValid, false);
});

test("LiveInterpreter validates provider JSON and converts provider errors to review-safe failures", async () => {
  const text = "한 번만 등록하면 큰 성과를 얻습니다";
  const provider: LiveProvider = {
    id: "fake-live-provider",
    async complete() {
      const output: Record<string, unknown> = { ...payloadFor(text), evidence_quotes: [text] };
      delete output.evidence_spans;
      return { output, model: "fake-model", estimatedCost: 0.001 };
    },
  };
  const run = await new LiveInterpreter(provider).interpret({ text });
  assert.equal(run.ok, true);
  assert.equal(run.mode, "live");
  assert.equal(run.estimatedCost, 0.001);

  const failingProvider: LiveProvider = {
    id: "failing-live-provider",
    async complete() {
      throw new Error("provider unavailable");
    },
  };
  const failure = await new LiveInterpreter(failingProvider).interpret({ text });
  assert.equal(failure.ok, false);
  assert.match(failure.errors.join(" "), /provider unavailable/u);

  const timeoutProvider: LiveProvider = {
    id: "timeout-live-provider",
    async complete(request) {
      return await new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  };
  const timeout = await new LiveInterpreter(timeoutProvider, 5).interpret({ text });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.timedOut, true);
});

test("OpenAI-compatible provider is environment-configured and requests strict JSON schema", async () => {
  assert.throws(() => OpenAiCompatibleProvider.fromEnvironment({}), /RISKSHIELD_INTERPRETER_ENDPOINT/u);
  let requestBody: Record<string, unknown> | null = null;
  let authorization = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({
      model: "provider-model",
      choices: [{ message: { content: JSON.stringify(payloadFor("테스트")) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = OpenAiCompatibleProvider.fromEnvironment({
      RISKSHIELD_INTERPRETER_ENDPOINT: "https://provider.example/v1/chat/completions",
      RISKSHIELD_INTERPRETER_API_KEY: "test-secret",
      RISKSHIELD_INTERPRETER_MODEL: "provider-model",
      RISKSHIELD_INTERPRETER_INPUT_USD_PER_MILLION: "1",
      RISKSHIELD_INTERPRETER_OUTPUT_USD_PER_MILLION: "2",
    });
    const result = await provider.complete({
      systemPrompt: "system",
      userPrompt: "user",
      schema: INTERPRETER_JSON_SCHEMA,
      signal: new AbortController().signal,
    });
    assert.equal(result.model, "provider-model");
    assert.equal(result.estimatedCost, 0.0002);
    assert.equal(authorization, "Bearer test-secret");
    const capturedBody = requestBody as unknown as Record<string, unknown>;
    assert.equal((capturedBody.response_format as { type?: string }).type, "json_schema");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hybrid fusion requires rule evidence for high and suppresses contextual warnings", async () => {
  const directInput = "합격을 100% 보장합니다";
  const directRules = analyzeText(directInput, starterSkills);
  const directRun = await new MockInterpreter().interpret({ text: directInput });
  assert.equal(combineHybrid(directRules, directRun).status, "high");

  const aiOnlyInput = "이 프로그램으로 배우자의 사진을 원격으로 볼 수 있습니다";
  const aiOnlyRules = analyzeText(aiOnlyInput, []);
  const aiOnlyRun = await new MockInterpreter().interpret({ text: aiOnlyInput });
  const recovered = combineHybrid(aiOnlyRules, aiOnlyRun);
  assert.equal(recovered.status, "review");
  assert.equal(recovered.recoveredByInterpreter, false);
  assert.ok(recovered.conflictReasons.includes("ai_only_substantiation"));

  const warningRun = await new MockInterpreter().interpret({ text: "전원 합격을 내세우는 광고를 주의하세요" });
  const suppressed = combineHybrid(directRules, warningRun);
  assert.equal(suppressed.status, "no_match");
  assert.equal(suppressed.suppressedHigh, true);
});

test("Schema 1.1.0 invalid Interpreter output and risk-family conflict always route to review", async () => {
  const rules = analyzeText("15초만에 형량 분석", starterSkills);
  const invalidRun = {
    ...(await new MockInterpreter().interpret({ text: "15초만에 형량 분석" })),
    ok: false,
    payload: null,
    schemaValid: false,
    errors: ["schema failure"],
  };
  assert.equal(combineHybrid(rules, invalidRun).status, "review");

  const privacyRun = await new MockInterpreter().interpret({ text: "상대방의 위치를 몰래 추적해 드립니다" });
  const conflict = combineHybrid(rules, privacyRun);
  assert.equal(conflict.status, "review");
  assert.equal(conflict.conflict, true);
  assert.ok(conflict.conflictReasons.includes("risk_family_mismatch"));
});

test("Schema 1.0.0 legacy artifacts, recordings, comparison CSV, and metrics remain preserved", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../artifacts/v0.4/interpreter-schema.json", import.meta.url),
    "utf8",
  )) as { $id: string; required: string[]; properties: Record<string, { const?: string }> };
  assert.match(schema.$id, /interpreter-1[.]0[.]0[.]json$/u);
  assert.equal(schema.properties.schema_version.const, "1.0.0");
  assert.equal(schema.required.includes("policy_relevance"), false);
  assert.equal(schema.required.includes("risk_family"), false);

  const recordingLines = readFileSync(
    new URL("../artifacts/v0.4/recorded-interpreter-responses.jsonl", import.meta.url),
    "utf8",
  ).trim().split(/\r?\n/u);
  assert.equal(recordingLines.length, 364);
  for (const line of recordingLines) {
    const record = JSON.parse(line) as Record<string, unknown>;
    assert.equal("input" in record, false);
    assert.equal("model_text" in record, false);
    assert.equal(record.prompt_version, "riskshield-interpreter-2026-07-18");
    assert.equal(record.schema_version, "1.0.0");
  }

  const [headers, ...rows] = parseCsv(readFileSync(
    new URL("../artifacts/v0.4/hybrid-evaluation-results.csv", import.meta.url),
    "utf8",
  ));
  assert.equal(rows.length, 364);
  assert.deepEqual(headers, [
    "case_id", "expected_class", "rules_status", "rules_score", "rules_skill_ids",
    "interpreter_risk_intent", "interpreter_speech_act", "interpreter_context_relation",
    "interpreter_claim_target", "interpreter_confidence", "interpreter_schema_valid",
    "hybrid_status", "hybrid_score", "verdict", "latency_ms", "estimated_cost", "notes",
  ]);

  const metrics = JSON.parse(readFileSync(
    new URL("../artifacts/v0.4/hybrid-metrics.json", import.meta.url),
    "utf8",
  )) as {
    sourceMode: string;
    liveInterpreterExecuted: boolean;
    offlineEngineeringGate: string;
    liveSemanticGate: string;
    gates: Record<string, boolean>;
    repetition: { runsPerInput: number; inconsistentFinalStatuses: number };
  };
  assert.equal(metrics.sourceMode, "recorded_from_deterministic_mock");
  assert.equal(metrics.liveInterpreterExecuted, false);
  assert.equal(metrics.offlineEngineeringGate, "PASS");
  assert.equal(metrics.liveSemanticGate, "NOT_RUN");
  assert.ok(Object.values(metrics.gates).every(Boolean));
  assert.equal(metrics.repetition.runsPerInput, 3);
  assert.equal(metrics.repetition.inconsistentFinalStatuses, 0);
});
