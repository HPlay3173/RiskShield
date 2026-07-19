import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("boundary-test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

async function request(path, init = {}) {
  return (await worker()).fetch(
    new Request(`http://localhost${path}`, init),
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

test("retires every compatibility skills method without reading auth or D1", async () => {
  for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
    const response = await request("/api/skills", { method });
    assert.equal(response.status, 410, `${method} /api/skills`);
    assert.equal(response.headers.get("cache-control"), "no-store");

    if (method !== "HEAD") {
      const payload = await response.json();
      assert.deepEqual(Object.keys(payload).sort(), ["error", "message"]);
      assert.equal(payload.error, "endpoint_retired");
      const serialized = JSON.stringify(payload);
      for (const forbidden of [
        "skill_id",
        "triggerPatterns",
        "severityFloor",
        "sourceId",
        "reviewStatus",
        "risk_skills",
        "D1",
      ]) {
        assert.ok(!serialized.includes(forbidden), `${method} leaked ${forbidden}`);
      }
    }
  }
});

test("keeps the control plane unavailable without starting OAuth", async () => {
  for (const path of ["/admin", "/dev", "/owner/access"]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("location"), null, `${path} redirected`);
  }

  for (const path of ["/api/admin/ping", "/api/dev/ping", "/api/owner/ping"]) {
    const response = await request(path);
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "control_plane_unavailable",
      message: "이 기능은 현재 사용할 수 없습니다.",
    });
  }

  await assert.rejects(access(new URL("../app/api/auth/google/start/route.ts", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/auth/google/callback/route.ts", import.meta.url)));
});

test("keeps public root HTML, hydration, and public JS free of skill and control datasets", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  const assetMatches = [
    ...html.matchAll(/(?:href|src)="(\/assets\/[^"?]+\.js)"/g),
    ...html.matchAll(/import\("(\/assets\/[^"?]+\.js)"\)/g),
  ];
  const assetPaths = [...new Set(assetMatches.map((match) => match[1]))];
  assert.ok(assetPaths.length > 0, "root did not reference a public JS entry");

  const publicBytes = [html];
  for (const assetPath of assetPaths) {
    publicBytes.push(
      await readFile(new URL(`../dist/client${assetPath}`, import.meta.url), "utf8"),
    );
  }
  const combined = publicBytes.join("\n");
  for (const forbidden of [
    "/api/skills",
    "triggerPatterns",
    "severityFloor",
    "source_index",
    "Skill Builder",
    "CSV 가져오기",
    "스킬 라이브러리",
    "검토 콘솔",
    "개발 콘솔",
  ]) {
    assert.ok(!combined.includes(forbidden), `public bytes contain ${forbidden}`);
  }
});

test("contains no database mutation in GET or HEAD API routes", async () => {
  const apiRoot = new URL("../app/api/", import.meta.url);
  const routeFiles = (await readdir(apiRoot, { recursive: true }))
    .filter((path) => path.endsWith("route.ts"));
  const getRoutes = [];
  for (const relativePath of routeFiles) {
    const source = await readFile(new URL(relativePath.replaceAll("\\", "/"), apiRoot), "utf8");
    if (!/export\s+(?:async\s+)?function\s+(?:GET|HEAD)\b|as\s+(?:GET|HEAD)\b/.test(source)) {
      continue;
    }
    getRoutes.push(relativePath.replaceAll("\\", "/"));
    assert.doesNotMatch(
      source,
      /\bCREATE\s+(?:TABLE|INDEX)\b|\bALTER\s+TABLE\b|\bDROP\s+TABLE\b|\bINSERT\s+INTO\b|\bUPDATE\s+[a-z_][a-z0-9_]*\s+SET\b|\bDELETE\s+FROM\b|ensureSchema|seedIfEmpty|upgradeUnmodifiedBundledRules/i,
      relativePath,
    );
  }

  assert.ok(getRoutes.includes("skills/route.ts"));
  assert.ok(getRoutes.every((path) => !path.startsWith("auth/")), getRoutes.join(", "));
});
