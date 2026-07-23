import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("management navigation exposes five core tasks and separates labs and settings", async () => {
  const source = await readFile(new URL("../components/shell/AreaShells.tsx", import.meta.url), "utf8");
  const core = source.match(/const managementNavigation = \[([\s\S]*?)\] as const;/u)?.[1] ?? "";
  assert.equal((core.match(/href:/gu) ?? []).length, 5);
  for (const label of ["관리 홈", "검토함", "위험 규칙", "자료 추가", "테스트"]) assert.match(core, new RegExp(`label: "${label}"`, "u"));
  assert.match(source, /href="\/manage\/labs"/u);
  assert.match(source, /href="\/manage\/settings"/u);
});

test("candidate review keeps approve and reject primary and advanced decisions collapsed", async () => {
  const source = await readFile(new URL("../components/admin/ReviewInbox.tsx", import.meta.url), "utf8");
  assert.match(source, /primaryDecisions: ReviewDecision\[\] = \["approve", "reject"\]/u);
  assert.match(source, /<strong>고급 결정<\/strong>/u);
});
