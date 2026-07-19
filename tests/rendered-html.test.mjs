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

test("server-renders the public Analyzer boundary", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /object-src 'none'/);
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);

  const html = await response.text();
  assert.match(html, /<html[^>]*\blang="ko"/i);
  assert.match(html, /<title>RiskShield \| 말하기 전에, 위험을 읽습니다<\/title>/i);
  assert.match(html, /<textarea[^>]*id="public-analysis-input"/i);
  assert.ok(html.includes("위험 신호 분석"));
  assert.ok(html.includes("사람의 최종 판단"));
  assert.ok(html.includes("no_match"));
  assert.ok(html.includes("안전 판정이나 게시 승인이 아닙니다."));
  assert.ok(html.includes("균형 분석"));
  assert.ok(html.includes("광고·주장"));
  assert.ok(html.includes("문맥 우선"));
  assert.match(html, /property="og:image"[^>]*og-v05\.png|content="[^"]*og-v05\.png"[^>]*property="og:image"/i);

  for (const forbidden of [
    "스킬 만들기",
    "CSV 가져오기",
    "스킬 라이브러리",
    "Skill Library",
    "내보내기",
    "Export",
    "/api/skills",
    "triggerPatterns",
    "severityFloor",
    "검토 콘솔",
    "개발 콘솔",
  ]) {
    assert.ok(!html.includes(forbidden), `forbidden public-root marker: ${forbidden}`);
  }

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
  await access(new URL("../public/og-v05.png", import.meta.url));
});

test("responsive interaction and accessibility contracts remain present", async () => {
  const stylePaths = [
    "../app/globals.css",
    "../styles/base.css",
    "../styles/materials.css",
    "../styles/motion.css",
    "../styles/accessibility.css",
    "../styles/analyzer.css",
    "../styles/access-code.css",
    "../styles/management.css",
  ];
  const css = (await Promise.all(stylePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
  const [pressable, splitPane, modalSheet] = await Promise.all([
    readFile(new URL("../components/interaction/Pressable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/interaction/SplitPane.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/interaction/ModalSheet.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.skipLink\s*\{[^}]*translateY\(-180%\)/s);
  assert.match(css, /\.skipLink:focus\s*\{[^}]*translateY\(0\)/s);
  assert.match(css, /:focus-visible\s*\{/);
  assert.match(css, /min-height:\s*2\.75rem/);
  assert.match(css, /@media \(max-width: 48rem\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /@media \(forced-colors: active\)/);

  assert.match(pressable, /setPointerCapture/);
  assert.match(pressable, /releasePointerCapture/);
  assert.match(pressable, /hysteresis\s*=\s*10/);
  assert.match(pressable, /getBoundingClientRect/);
  assert.match(pressable, /rect\.left\s*-\s*slop/);
  assert.match(css, /scale\(0\.98\)/);
  assert.match(css, /95ms/);
  assert.match(splitPane, /role="separator"/);
  assert.match(splitPane, /rubberBand/);
  assert.match(splitPane, /projectedTarget/);
  assert.match(splitPane, /prefers-reduced-motion/);
  assert.match(modalSheet, /<dialog/);
  assert.match(modalSheet, /showModal\(\)/);
  assert.match(modalSheet, /onCancel/);
  assert.match(modalSheet, /setPointerCapture/);
  assert.match(modalSheet, /returnFocusRef/);
  assert.match(modalSheet, /closeWithMotion/);
});
