import assert from "node:assert/strict";
import test from "node:test";

import {
  buildXRecentQuery,
  isHardRejectedExpression,
  newestNumericId,
  parseApprovedFeedEntries,
  qualificationGate,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/collectors/quality.ts";

test("collector rejects common terms and reaction-only tokens before qualification", () => {
  for (const expression of ["\ud544\uc694\ud558\ub2e4", "\uac8c\uc784", "\uc601\uc0c1", "\u314b\u314b\u314b", "\u3160\u3160"]) {
    assert.equal(isHardRejectedExpression(expression), true, expression);
  }
  assert.equal(isHardRejectedExpression("\ub290\uac1c\ubbf8"), false);
});

test("collector quality gate requires independent authors and direct harmful contexts", () => {
  const baseline = {
    observationCount: 3,
    distinctAuthorCount: 2,
    distinctSourceCount: 1,
    directEvidenceCount: 2,
    contextualEvidenceCount: 1,
    confidence: 0.84,
    disposition: "review" as const,
  };
  assert.equal(qualificationGate(baseline), true);
  assert.equal(qualificationGate({ ...baseline, distinctAuthorCount: 1 }), false);
  assert.equal(qualificationGate({ ...baseline, directEvidenceCount: 1 }), false);
  assert.equal(qualificationGate({ ...baseline, disposition: "monitor" }), false);
});

test("collector accepts two-source corroboration but not one unsupported observation", () => {
  assert.equal(qualificationGate({
    observationCount: 2,
    distinctAuthorCount: 2,
    distinctSourceCount: 2,
    directEvidenceCount: 2,
    contextualEvidenceCount: 0,
    confidence: 0.9,
    disposition: "review",
  }), true);
  assert.equal(qualificationGate({
    observationCount: 1,
    distinctAuthorCount: 1,
    distinctSourceCount: 1,
    directEvidenceCount: 1,
    contextualEvidenceCount: 0,
    confidence: 0.99,
    disposition: "review",
  }), false);
});

test("X query applies Korean and repost filters once", () => {
  assert.equal(buildXRecentQuery("\uc740\uc5b4 OR \ube44\ud558"), "(\uc740\uc5b4 OR \ube44\ud558) lang:ko -is:retweet");
  assert.equal(buildXRecentQuery("\uc740\uc5b4 lang:ko -is:retweet"), "(\uc740\uc5b4 lang:ko -is:retweet)");
});

test("Mastodon cursor comparison is numeric rather than lexical", () => {
  assert.equal(newestNumericId(["9", "10", "11"], null), "11");
  assert.equal(newestNumericId([], "7"), "7");
});

test("DC parser ignores generic navigation anchors and accepts approved feed entries", () => {
  assert.deepEqual(parseApprovedFeedEntries('<nav><a href="/login">Login</a></nav>'), []);
  assert.deepEqual(parseApprovedFeedEntries('<item><title>Title</title><description>Body</description><link>https://example.test/post/1</link></item>'), [
    { text: "Title / Body", link: "https://example.test/post/1" },
  ]);
});
