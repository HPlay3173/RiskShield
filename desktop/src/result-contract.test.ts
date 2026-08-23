import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("result UI contract", () => {
  it("keeps the original Codex verdict before exactly three additions", () => {
    const originalVerdict = appSource.indexOf('"Codex 판정"');
    const context = appSource.indexOf("<h3>문맥 판단</h3>");
    const score = appSource.indexOf("<strong>판정 위험 점수</strong>");
    const rewrite = appSource.indexOf("<h3>수정 문구 제안</h3>");

    expect(originalVerdict).toBeGreaterThan(-1);
    expect(context).toBeGreaterThan(originalVerdict);
    expect(score).toBeGreaterThan(context);
    expect(rewrite).toBeGreaterThan(score);
    expect(appSource).not.toContain("검토 리포트");
    expect(appSource).not.toContain("핵심 문제");
    expect(appSource).not.toContain("예상 위험");
    expect(appSource).not.toContain("수정 권고");
  });

  it("locks source-changing controls while an analysis is pending", () => {
    expect(appSource).toContain(
      "const interactionLocked = busy || gemmaKeyBusy || pendingGemmaInput !== null;",
    );
    expect(appSource.match(/disabled=\{interactionLocked\}/gu)?.length).toBeGreaterThanOrEqual(4);
  });
});
