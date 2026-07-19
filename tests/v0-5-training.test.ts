import assert from "node:assert/strict";
import test from "node:test";

import {
  RetryableTrainingError,
  TRAINING_STAGE_IDS,
  runTrainingMvp,
  type TrainingDraftBatchRequest,
  type TrainingDraftProvider,
  type TrainingRunResult,
  type WaitingReviewRepository,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/training/mvp.ts";

function stage(result: TrainingRunResult, id: (typeof TRAINING_STAGE_IDS)[number]) {
  const found = result.stages.find((entry) => entry.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

function draftsFor(request: TrainingDraftBatchRequest) {
  return request.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    title: `${candidate.representativeExpression} 검토안`,
    riskSummary: "사람 검토가 필요한 표현 후보입니다.",
    triggerPatterns: [candidate.representativeExpression],
    contextPatterns: [candidate.category ?? "맥락 검토"],
    safeRewrite: ["검증 가능한 조건과 근거를 함께 안내합니다."],
  }));
}

function savingRepository(saved: string[][]): WaitingReviewRepository {
  return {
    configured: true,
    async saveWaitingReview(candidates) {
      const ids = candidates.map((candidate) => candidate.id);
      saved.push(ids);
      return { savedCandidateIds: ids };
    },
  };
}

const baseRows = [
  { id: "row-1", expression: "위험 문구", root: "위험", category: "광고" },
  { id: "row-2", expression: "위험 문구", root: "위험", category: "광고" },
  { id: "row-3", expression: "위험   문구", root: "위험", category: "광고" },
  { id: "row-4", expression: "다른 표현", root: "다른", category: "일반" },
  { id: "row-5", expression: "010-1234-5678", flags: ["pii_candidate"] },
] as const;

test("the executable MVP deduplicates, groups, calls a configured provider, and stores only waiting-review candidates", async () => {
  const requests: TrainingDraftBatchRequest[] = [];
  const provider: TrainingDraftProvider = {
    id: "test-provider",
    configured: true,
    async generateBatch(request) {
      requests.push(request);
      return { drafts: draftsFor(request) };
    },
  };
  const saves: string[][] = [];
  const result = await runTrainingMvp({
    datasetVersionId: "dataset-v1",
    sourceSha256: "abc123",
    rows: baseRows,
    skills: [
      { id: "skill-reviewed", reviewStatus: "reviewed", triggerPatterns: ["위험 문구"] },
      { id: "skill-draft", reviewStatus: "draft", triggerPatterns: ["위험 문구"] },
      { id: "skill-rejected", reviewStatus: "rejected", triggerPatterns: ["다른 표현"] },
    ],
  }, {
    batchSize: 1,
    draftProvider: provider,
    waitingReviewRepository: savingRepository(saves),
  });

  assert.equal(result.status, "waiting_review");
  assert.equal(result.stages.length, 9);
  assert.deepEqual(result.stages.map((entry) => entry.id), [...TRAINING_STAGE_IDS]);
  assert.equal(result.metrics.inputRows, 5);
  assert.equal(result.metrics.quarantinedRows, 1);
  assert.equal(result.metrics.exactDuplicates, 1);
  assert.equal(result.metrics.normalizedDuplicates, 1);
  assert.equal(result.metrics.cleanedExpressions, 2);
  assert.equal(result.batches.length, 2);
  assert.equal(requests.length, 2, "the configured provider must receive actual batch calls");
  assert.equal(stage(result, "skill_generator").state, "succeeded");
  assert.equal(stage(result, "confidence_router").state, "waiting_review");
  assert.equal(stage(result, "collector").state, "not_configured");
  assert.equal(stage(result, "feedback_learner").state, "not_configured");
  assert.equal(saves.length, 1);
  assert.deepEqual(result.persistedCandidateIds, [...saves[0]].sort((a, b) => a.localeCompare(b, "ko-KR")));
  assert.ok(result.candidates.every((candidate) => candidate.status === "pending_review"));
  assert.ok(result.candidates.every((candidate) => candidate.draft));
  assert.ok(result.candidates.every((candidate) => candidate.tests.map((entry) => entry.type).join() === "positive,negative"));

  const similar = result.candidates.find((candidate) => candidate.representativeExpression.includes("위험"));
  assert.equal(similar?.nearestReviewedSkill?.skillId, "skill-reviewed");
});

test("missing provider and storage adapters are explicit not-configured states, never fake success", async () => {
  const result = await runTrainingMvp({
    datasetVersionId: "dataset-v1",
    sourceSha256: "abc123",
    rows: [{ id: "row-1", expression: "검토 표현", category: "일반" }],
  });

  assert.equal(result.status, "degraded");
  assert.equal(stage(result, "skill_generator").state, "not_configured");
  assert.equal(stage(result, "confidence_router").state, "not_configured");
  assert.equal(result.metrics.draftedCandidates, 0);
  assert.equal(result.metrics.savedCandidates, 0);
  assert.equal(result.candidates[0].draft, null);
  assert.ok(result.candidates[0].warnings.includes("llm_draft_not_configured"));
  assert.deepEqual(result.persistedCandidateIds, []);
});

test("dedupe, grouping, batches, and candidate identifiers are deterministic across input order", async () => {
  const input = {
    datasetVersionId: "dataset-v1",
    sourceSha256: "abc123",
    rows: baseRows.slice(0, 4),
  };
  const forward = await runTrainingMvp(input, { batchSize: 1 });
  const reversed = await runTrainingMvp({ ...input, rows: [...input.rows].reverse() }, { batchSize: 1 });

  assert.deepEqual(forward.cleaned, reversed.cleaned);
  assert.deepEqual(forward.groups, reversed.groups);
  assert.deepEqual(forward.batches, reversed.batches);
  assert.deepEqual(
    forward.candidates.map((candidate) => candidate.id),
    reversed.candidates.map((candidate) => candidate.id),
  );
});

test("a retryable draft-provider failure is retried once and then recorded as a real success", async () => {
  let calls = 0;
  const provider: TrainingDraftProvider = {
    id: "retry-provider",
    configured: true,
    async generateBatch(request) {
      calls += 1;
      if (calls === 1) throw new RetryableTrainingError("provider_temporarily_unavailable");
      return { drafts: draftsFor(request) };
    },
  };
  const result = await runTrainingMvp({
    datasetVersionId: "dataset-v1",
    sourceSha256: "abc123",
    rows: [{ id: "row-1", expression: "검토 표현" }],
  }, {
    draftProvider: provider,
    waitingReviewRepository: savingRepository([]),
    maxRetries: 1,
  });

  assert.equal(calls, 2);
  assert.equal(stage(result, "skill_generator").attempts, 2);
  assert.equal(stage(result, "skill_generator").state, "succeeded");
  assert.equal(result.status, "waiting_review");
});

test("invalid provider output is degraded and remains human-reviewable rather than reported as generated", async () => {
  let calls = 0;
  const provider: TrainingDraftProvider = {
    id: "invalid-provider",
    configured: true,
    async generateBatch() {
      calls += 1;
      return { drafts: [] };
    },
  };
  const result = await runTrainingMvp({
    datasetVersionId: "dataset-v1",
    sourceSha256: "abc123",
    rows: [{ id: "row-1", expression: "검토 표현" }],
  }, {
    draftProvider: provider,
    waitingReviewRepository: savingRepository([]),
  });

  assert.equal(calls, 1);
  assert.equal(result.status, "waiting_review");
  assert.equal(stage(result, "skill_generator").state, "degraded");
  assert.equal(result.metrics.draftedCandidates, 0);
  assert.equal(result.candidates[0].draft, null);
  assert.ok(result.candidates[0].warnings.includes("llm_draft_contract_failed"));
});

test("cancellation is handed to the active provider and records cancel-requested then cancelled", async () => {
  const controller = new AbortController();
  let markStarted: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const provider: TrainingDraftProvider = {
    id: "blocking-provider",
    configured: true,
    async generateBatch(_request, signal) {
      markStarted?.();
      return await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  };

  const pending = runTrainingMvp({
    datasetVersionId: "dataset-v1",
    sourceSha256: "abc123",
    rows: [{ id: "row-1", expression: "검토 표현" }],
  }, { draftProvider: provider, signal: controller.signal });
  await started;
  controller.abort();
  const result = await pending;

  assert.equal(result.status, "cancelled");
  assert.deepEqual(stage(result, "skill_generator").history.slice(-2), ["cancel_requested", "cancelled"]);
  assert.equal(result.metrics.savedCandidates, 0);
  assert.deepEqual(result.persistedCandidateIds, []);
});

test("partial candidate persistence is a failed run, not a waiting-review acknowledgement", async () => {
  const repository: WaitingReviewRepository = {
    configured: true,
    async saveWaitingReview() {
      return { savedCandidateIds: [] };
    },
  };
  const result = await runTrainingMvp({
    datasetVersionId: "dataset-v1",
    sourceSha256: "abc123",
    rows: [{ id: "row-1", expression: "검토 표현" }],
  }, { waitingReviewRepository: repository });

  assert.equal(result.status, "failed");
  assert.equal(stage(result, "confidence_router").state, "failed");
  assert.equal(stage(result, "confidence_router").errorCode, "candidate_save_incomplete");
  assert.equal(result.metrics.savedCandidates, 0);
});

test("an empty or fully quarantined dataset fails at Cleaner and creates no candidates", async () => {
  const result = await runTrainingMvp({
    datasetVersionId: "dataset-v1",
    sourceSha256: "abc123",
    rows: [
      { id: "row-1", expression: "" },
      { id: "row-2", expression: "test@example.com", flags: ["pii_candidate"] },
    ],
  });

  assert.equal(result.status, "failed");
  assert.equal(stage(result, "cleaner").state, "failed");
  assert.equal(stage(result, "cleaner").errorCode, "no_clean_expressions");
  assert.deepEqual(result.candidates, []);
});
