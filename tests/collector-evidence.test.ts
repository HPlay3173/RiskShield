import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateSourcesFromEvidence,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/collectors/evidence.ts";

test("candidate evidence preserves the actual source for each platform", () => {
  const sources = candidateSourcesFromEvidence([], [
    { sourceId: "youtube-source", provider: "youtube", sourceLabel: "YouTube 댓글", url: "https://youtube.test/a", publishedAt: "2026-07-20T00:00:00.000Z" },
    { sourceId: "threads-source", provider: "threads", sourceLabel: "Threads 공개 글", url: "https://threads.test/b", publishedAt: "2026-07-21T00:00:00.000Z" },
  ], "2026-07-23T00:00:00.000Z");

  assert.deepEqual(sources, [
    { title: "YouTube 댓글", url: "https://youtube.test/a", date: "2026-07-20", sourceId: "youtube-source", provider: "youtube" },
    { title: "Threads 공개 글", url: "https://threads.test/b", date: "2026-07-21", sourceId: "threads-source", provider: "threads" },
  ]);
});
