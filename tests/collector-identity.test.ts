import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalCollectorIdentity,
  collectedPostFingerprint,
  collectorSourceFingerprint,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/collectors/identity.ts";

test("collector identity canonicalizes YouTube video order and endpoint details", async () => {
  const left = canonicalCollectorIdentity("youtube", "https://youtu.be/dQw4w9WgXcQ, M7lc1UVf-VE", null);
  const right = canonicalCollectorIdentity("youtube", "M7lc1UVf-VE dQw4w9WgXcQ", null);
  assert.equal(left, right);
  assert.equal(await collectorSourceFingerprint("youtube", "M7lc1UVf-VE dQw4w9WgXcQ", null), await collectorSourceFingerprint("youtube", "dQw4w9WgXcQ,M7lc1UVf-VE", null));
});

test("collector identity collapses equivalent endpoint and query whitespace", async () => {
  assert.equal(
    await collectorSourceFingerprint("mastodon", "  혐오표현  ", "https://MASTODON.social:443/"),
    await collectorSourceFingerprint("mastodon", "혐오표현", "https://mastodon.social"),
  );
});

test("post identity is global per provider instead of per collector setting", async () => {
  const first = await collectedPostFingerprint("youtube", "comment-123");
  const second = await collectedPostFingerprint("youtube", "comment-123");
  const otherProvider = await collectedPostFingerprint("x", "comment-123");
  assert.equal(first, second);
  assert.notEqual(first, otherProvider);
});
