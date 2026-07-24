import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
import { parseYouTubeVideoInput } from "../lib/collectors/youtube.ts";

test("YouTube 주소와 ID를 같은 입력에서 추출하고 중복을 제거한다", () => {
  assert.deepEqual(parseYouTubeVideoInput([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=10",
    "https://www.youtube.com/shorts/aqz-KE-bpKQ",
    "9bZkp7q19f0",
  ].join("\n")), {
    ids: ["dQw4w9WgXcQ", "aqz-KE-bpKQ", "9bZkp7q19f0"],
    invalid: [],
  });
});

test("지원하지 않는 주소와 잘못된 ID를 거부한다", () => {
  const result = parseYouTubeVideoInput("https://example.com/video/123 not-an-id");
  assert.equal(result.ids.length, 0);
  assert.equal(result.invalid.length, 2);
});
