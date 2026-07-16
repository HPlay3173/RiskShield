import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished RiskShield workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*\blang="ko"/i);
  assert.match(
    html,
    /<title>RiskShield Studio \| 조합형 위험 패턴 워크벤치<\/title>/i,
  );

  for (const label of [
    "스킬 만들기",
    "CSV 가져오기",
    "스킬 라이브러리",
    "Analyzer 테스트",
    "내보내기",
  ]) {
    assert.ok(html.includes(label), `missing rendered label: ${label}`);
  }
  assert.ok(
    html.includes("Mock은 규칙 기반 시연 결과를 생성합니다. 실제 AI 분석이 아닙니다."),
  );
  assert.match(html, /Human in the loop/i);

  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.doesNotMatch(html, /Codex is working|Your site is taking shape/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});

test("removes the disposable starter preview and unused starter assets", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(layout, /codex-preview|Starter Project|Your site is taking shape/);

  for (const path of [
    "../app/_sites-preview/SkeletonPreview.tsx",
    "../app/_sites-preview/preview.css",
    "../public/window.svg",
    "../public/globe.svg",
    "../public/file.svg",
  ]) {
    await assert.rejects(access(new URL(path, import.meta.url)));
  }

  await assert.rejects(access(new URL("../public/favicon.svg", import.meta.url)));
  await access(new URL("../public/og.png", import.meta.url));
});
