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

test("exposes only POST on the public Analyzer API", async () => {
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"]) {
    const response = await request("/api/analyze", { method });
    assert.equal(response.status, 405, `${method} /api/analyze`);
  }
});

test("keeps the management control plane fail-closed when auth is unavailable", async () => {
  const defaultRedirects = new Map([
    ["/admin", "/admin/review"],
    ["/dev", "/dev/datasets"],
    ["/owner", "/owner/access"],
  ]);
  for (const [path, destination] of defaultRedirects) {
    const response = await request(path);
    assert.equal(response.status, 307, path);
    assert.equal(new URL(response.headers.get("location")).pathname, destination);
  }

  for (const path of [
    "/admin/review",
    "/admin/skills",
    "/admin/trends",
    "/admin/audit",
    "/dev/datasets",
    "/dev/training",
    "/dev/evaluation",
    "/dev/models",
    "/dev/audit",
    "/owner/access",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 307, path);
    const location = response.headers.get("location");
    assert.ok(location, `${path} omitted its authentication redirect`);
    const redirectUrl = new URL(location);
    assert.equal(redirectUrl.pathname, "/api/auth/google/start");
    assert.equal(redirectUrl.searchParams.get("return_to"), path);
  }

  const authStart = await request("/api/auth/google/start?return_to=%2Fadmin");
  assert.equal(authStart.status, 503);
  assert.equal(authStart.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await authStart.json(), { error: "authentication_unavailable" });

  for (const path of [
    "/api/admin/ping",
    "/api/admin/candidates",
    "/api/admin/skills",
    "/api/dev/ping",
    "/api/dev/datasets",
    "/api/owner/ping",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  }

  for (const path of [
    "/api/admin/candidates/decision",
    "/api/admin/skills/revisions",
    "/api/dev/datasets/register",
    "/api/dev/training/run",
  ]) {
    const response = await request(path, { method: "POST" });
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  }

  await access(new URL("../app/api/auth/google/start/route.ts", import.meta.url));
  await access(new URL("../app/api/auth/google/callback/route.ts", import.meta.url));
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
  const stylePaths = [...new Set(
    [...html.matchAll(/<link[^>]+href="(\/assets\/[^"?]+\.css)"/g)].map((match) => match[1]),
  )];
  assert.ok(stylePaths.length > 0, "root did not reference a public CSS entry");

  const publicBytes = [html];
  for (const assetPath of [...assetPaths, ...stylePaths]) {
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
    "개발 데이터",
    "Skill Library",
    "Dataset Console",
    "Training Console",
    "/api/admin",
    "/api/dev",
    "/api/owner",
    "risk_skills",
    "RISKSHIELD_INTERPRETER_API_KEY",
    "RISKSHIELD_GOOGLE_CLIENT_SECRET",
    "RISKSHIELD_SESSION_SECRET",
    "managementShell",
    "reviewInbox",
    "skillLibrary",
    "datasetConsole",
    "trainingConsole",
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
  assert.ok(getRoutes.includes("auth/google/start/route.ts"));
  assert.ok(getRoutes.includes("auth/google/callback/route.ts"));
});
