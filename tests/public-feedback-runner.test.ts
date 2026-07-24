import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  retryPublicFeedbackRows,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/public-feedback/retry.ts";
import {
  evaluationEnabledForRuleFeedback,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/evaluation/rule-feedback.ts";

const row = (id: string) => ({
  id,
  expression: "느개미",
  report_type: "missed_detection" as const,
  contexts_json: JSON.stringify(["너 진짜 느개미네"]),
  reporter_fingerprints_json: "[]",
  submission_count: 1,
  retention_deadline: "2026-08-01T00:00:00.000Z",
});

test("scheduled retry processes at most three due intakes and records promotion", async () => {
  const seen: string[] = [];
  const result = await retryPublicFeedbackRows([row("error-1"), row("monitor-2"), row("received-3"), row("later-4")], async (item) => {
    seen.push(item.id);
    return item.id === "error-1" ? "promoted" : "monitor";
  });
  assert.deepEqual(seen, ["error-1", "monitor-2", "received-3"]);
  assert.deepEqual(result, { processed: 3, promoted: 1, monitored: 2, rejected: 0, errors: 0 });
});

test("scheduled worker runs collector and public feedback retries together", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /runDuePublicFeedbackIntakes\(env\)/u);
  assert.match(source, /Promise\.all/u);
});

test("false-positive evaluation case stays disabled until approval", async () => {
  const route = await readFile(new URL("../app/api/analyze/candidate/route.ts", import.meta.url), "utf8");
  assert.match(route, /public_false_positive', 0/u);
  assert.equal(evaluationEnabledForRuleFeedback("reject"), 0);
  assert.equal(evaluationEnabledForRuleFeedback("approve"), 1);
});

test("known-expression check is scoped to the submitted expression", async () => {
  const route = await readFile(new URL("../app/api/analyze/candidate/route.ts", import.meta.url), "utf8");
  assert.match(route, /analyzeText\(expression, reviewedSkills\)/u);
  assert.doesNotMatch(route, /existingRuleResult = analyzeText\(context/u);
});
