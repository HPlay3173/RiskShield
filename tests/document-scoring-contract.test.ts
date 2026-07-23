import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
});
