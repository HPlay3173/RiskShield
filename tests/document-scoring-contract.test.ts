import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  summarizeAiCoverage,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-5/ai-coverage.ts";

test("AI coverage distinguishes selected, successful, and partial analysis", () => {
  assert.deepEqual(summarizeAiCoverage(6, 0), { selectedClaimCount: 6, analyzedClaimCount: 0, state: "fallback" });
  assert.deepEqual(summarizeAiCoverage(6, 4), { selectedClaimCount: 6, analyzedClaimCount: 4, state: "partial" });
  assert.deepEqual(summarizeAiCoverage(6, 6), { selectedClaimCount: 6, analyzedClaimCount: 6, state: "ready" });
});

test("public document scoring analyzes twenty claims and removes aggregate bonuses", async () => {
  const source = await readFile(new URL("../lib/v0-5/document-scoring.ts", import.meta.url), "utf8");
  assert.match(source, /MAX_DOCUMENT_CLAIMS = 20/u);
  assert.match(source, /const aggregateBonus = 0/u);
  assert.match(source, /const finalScore = top\?\.finalScore \?\? 0/u);
  assert.doesNotMatch(source, /independent_claims_aggregated/u);
});

test("public analyzer does not load or apply rule-only calibration", async () => {
  const route = await readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /readActiveCalibration|applyCalibration/u);
  assert.match(route, /calibratedScore: null/u);
  assert.match(route, /calibration: null/u);
  assert.match(route, /MAX_AI_ANALYZED_CLAIMS = 6/u);
  assert.match(route, /aiSelectedClaimCount:/u);
});
