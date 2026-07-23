import assert from "node:assert/strict";
import test from "node:test";

import {
  verificationNextCheckAt,
  verificationShouldRun,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/collectors/quality.ts";

const now = "2026-07-23T00:00:00.000Z";

test("search verification cooldowns keep reject and monitor expressions out of immediate retries", () => {
  assert.equal(verificationNextCheckAt("reject", 0, now), "2026-08-22T00:00:00.000Z");
  assert.equal(verificationNextCheckAt("monitor", 0, now), "2026-07-26T00:00:00.000Z");
  assert.equal(verificationShouldRun({ decision: "reject", nextCheckAt: "2026-08-22T00:00:00.000Z", verifiedObservationCount: 3 }, 20, now), false);
  assert.equal(verificationShouldRun({ decision: "monitor", nextCheckAt: "2026-07-26T00:00:00.000Z", verifiedObservationCount: 3 }, 5, now), false);
});

test("monitor verification reruns only after cooldown and two new observations", () => {
  const previous = { decision: "monitor" as const, nextCheckAt: "2026-07-22T00:00:00.000Z", verifiedObservationCount: 3 };
  assert.equal(verificationShouldRun(previous, 4, now), false);
  assert.equal(verificationShouldRun(previous, 5, now), true);
});

test("search errors use bounded exponential backoff and approved verification is reused", () => {
  assert.equal(verificationNextCheckAt("error", 1, now), "2026-07-23T01:00:00.000Z");
  assert.equal(verificationNextCheckAt("error", 2, now), "2026-07-23T06:00:00.000Z");
  assert.equal(verificationNextCheckAt("error", 3, now), "2026-07-24T00:00:00.000Z");
  assert.equal(verificationNextCheckAt("error", 99, now), "2026-07-24T00:00:00.000Z");
  assert.equal(verificationShouldRun({ decision: "send_to_review", nextCheckAt: now, verifiedObservationCount: 3 }, 100, "2026-08-23T00:00:00.000Z"), false);
});
