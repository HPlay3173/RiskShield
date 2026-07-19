import assert from "node:assert/strict";
import test from "node:test";

import {
  GoogleTrainingDraftProvider,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/training/google-draft-provider.ts";
import type {
  TrainingDraftBatchRequest,
} from "../lib/training/mvp.ts";

const request: TrainingDraftBatchRequest = {
  runId: "run-test",
  datasetVersionId: "dataset-v1",
  batchId: "batch-0001",
  candidates: [{
    candidateId: "candidate-1",
    representativeExpression: "100% 수익을 보장합니다.",
    category: "허위·과장 광고",
    nearestReviewedSkill: null,
    positiveTest: "100% 수익을 보장합니다.",
    negativeTest: "100% 수익 보장이라는 표현은 사용하지 마세요.",
  }],
};

function responseFor(candidateId = "candidate-1") {
  return new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          functionCall: {
            name: "save_training_drafts",
            args: {
              drafts: [{
                candidateId,
                title: "수익 보장 표현 검토안",
                riskSummary: "근거 없는 수익 보장 가능성을 사람 검토로 보냅니다.",
                triggerPatterns: ["100% 수익", "수익 보장"],
                contextPatterns: ["광고", "투자"],
                safeRewrite: ["수익은 보장되지 않으며 손실 가능성이 있습니다."],
              }],
            },
          },
        }],
      },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("Google training draft provider is explicitly unconfigured without an API key", async () => {
  const provider = new GoogleTrainingDraftProvider("   ");
  assert.equal(provider.configured, false);
  await assert.rejects(
    provider.generateBatch(request, new AbortController().signal),
    /training_draft_provider_not_configured/,
  );
});

test("Google training draft provider uses a forced function contract and returns only the requested drafts", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return responseFor();
  };

  try {
    const signal = new AbortController().signal;
    const provider = new GoogleTrainingDraftProvider("test-only-secret", "gemma-test-model");
    assert.equal(provider.configured, true);
    const result = await provider.generateBatch(request, signal);

    assert.match(capturedUrl, /gemma-test-model:generateContent$/);
    assert.equal(new Headers(capturedInit?.headers).get("x-goog-api-key"), "test-only-secret");
    assert.equal(capturedInit?.signal, signal);
    const body = JSON.parse(String(capturedInit?.body));
    assert.equal(body.toolConfig.functionCallingConfig.mode, "ANY");
    assert.deepEqual(body.toolConfig.functionCallingConfig.allowedFunctionNames, ["save_training_drafts"]);
    assert.equal(body.tools[0].functionDeclarations[0].name, "save_training_drafts");
    assert.match(body.systemInstruction.parts[0].text, /untrusted data/);
    assert.equal(result.drafts.length, 1);
    assert.equal(result.drafts[0]?.candidateId, "candidate-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google training draft provider rejects incomplete or unrelated function results", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseFor("unrelated-candidate");
  try {
    const provider = new GoogleTrainingDraftProvider("test-only-secret");
    await assert.rejects(
      provider.generateBatch(request, new AbortController().signal),
      /training_draft_provider_incomplete/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google training provider HTTP failures do not expose response bodies or API keys", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("provider secret diagnostic", { status: 429 });
  try {
    const provider = new GoogleTrainingDraftProvider("test-only-secret");
    await assert.rejects(
      provider.generateBatch(request, new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "training_draft_provider_http_error");
        assert.equal((error as Error & { code?: string }).code, "training_draft_provider_rate_limited");
        assert.doesNotMatch(String(error), /secret|diagnostic/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
