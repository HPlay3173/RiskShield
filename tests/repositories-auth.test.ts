import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAPABILITIES,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/auth/current-principal.ts";
import {
  ACCESS_CODE_SUBJECT,
  accessCodePrincipalForSession,
  verifyAccessCode,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/auth/access-code.ts";
import {
  requireAccessCodeConfiguration,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/auth/runtime.ts";
import {
  developmentPrincipalForRequest,
  developmentPrincipalForHost,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/auth/dev-principal.ts";
import {
  sessionClearsNotBefore,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/auth/identity-adapter.ts";
import {
  D1PrincipalRepository,
  D1SkillRepository,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/repositories/d1.ts";
import {
  createRepositoryServices,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/repositories/index.ts";
import {
  LocalCandidateRepository,
  LocalDatasetRepository,
  LocalSkillRepository,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/repositories/local.ts";
import {
  DEFAULT_SEVERITY_RULES,
  starterSkills,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";
import {
  INVALID_JSON_BODY,
  JSON_BODY_TOO_LARGE,
  readJsonValue,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/http/control-response.ts";

type FakeResponse = {
  all?: unknown[];
  first?: unknown;
};

function fakeD1(
  responder: (sql: string, values: readonly unknown[]) => FakeResponse,
  queries: string[],
) {
  return {
    prepare(sql: string) {
      queries.push(sql);
      let values: readonly unknown[] = [];
      const statement = {
        bind(...next: unknown[]) {
          values = next;
          return statement;
        },
        async all<T>() {
          return { results: (responder(sql, values).all ?? []) as T[], success: true };
        },
        async first<T>() {
          return (responder(sql, values).first ?? null) as T | null;
        },
        async run<T>() {
          return { results: [] as T[], success: true };
        },
        async raw<T>() {
          return [] as T[];
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

test("development owner fixture requires non-production, explicit enablement, and loopback", () => {
  const runtime = { RISKSHIELD_ENABLE_DEV_PRINCIPAL: "1" };
  const principal = developmentPrincipalForRequest(
    new Request("http://localhost:3000/admin?role=reviewer"),
    runtime,
    "development",
  );
  assert.ok(principal);
  assert.equal(principal.role, "owner");
  assert.equal(principal.authSource, "development_fixture");
  assert.equal(principal.identityIssuer, "riskshield:local-development");
  assert.deepEqual([...principal.capabilities], [...CAPABILITIES]);

  assert.equal(developmentPrincipalForHost({ runtime, host: "localhost:3000", nodeEnv: "production" }), null);
  assert.equal(developmentPrincipalForHost({ runtime: {}, host: "localhost:3000", nodeEnv: "development" }), null);
  assert.equal(developmentPrincipalForHost({ runtime, host: "riskshield.example", nodeEnv: "development" }), null);
  assert.equal(developmentPrincipalForHost({ runtime, host: "riskshield.example@localhost", nodeEnv: "development" }), null);
});

test("access-code authentication requires strong server-only secrets and resolves an owner session", async () => {
  const runtime = {
    RISKSHIELD_ACCESS_CODE: "correct-horse-battery-staple-2026",
    RISKSHIELD_SESSION_SIGNING_KEY: "s".repeat(48),
  };
  assert.deepEqual(requireAccessCodeConfiguration(runtime), {
    accessCode: runtime.RISKSHIELD_ACCESS_CODE,
    signingKey: runtime.RISKSHIELD_SESSION_SIGNING_KEY,
  });
  assert.equal(await verifyAccessCode(runtime.RISKSHIELD_ACCESS_CODE, runtime), true);
  assert.equal(await verifyAccessCode("wrong-code", runtime), false);
  assert.throws(() => requireAccessCodeConfiguration({
    RISKSHIELD_ACCESS_CODE: "too-short",
    RISKSHIELD_SESSION_SIGNING_KEY: "s".repeat(48),
  }));

  const principal = accessCodePrincipalForSession({
    sub: ACCESS_CODE_SUBJECT,
    sid: "session-1",
    roleVersion: 1,
    csrf: "csrf-1",
    iat: 1,
    exp: 2,
  }, runtime);
  assert.ok(principal);
  assert.equal(principal.role, "owner");
  assert.equal(principal.authSource, "access_code");
  assert.deepEqual([...principal.capabilities], [...CAPABILITIES]);
  assert.equal(accessCodePrincipalForSession({
    sub: "different-subject",
    sid: "session-2",
    roleVersion: 1,
    csrf: "csrf-2",
    iat: 1,
    exp: 2,
  }, runtime), null);
});

test("streamed JSON parsing distinguishes oversized, malformed, and non-object JSON", async () => {
  const oversized = await readJsonValue(new Request("http://localhost/api/analyze", {
    method: "POST",
    body: JSON.stringify({ text: "x".repeat(64) }),
  }), 16);
  assert.equal(oversized, JSON_BODY_TOO_LARGE);

  const malformed = await readJsonValue(new Request("http://localhost/api/analyze", {
    method: "POST",
    body: "{broken",
  }), 64);
  assert.equal(malformed, INVALID_JSON_BODY);

  const validArray = await readJsonValue(new Request("http://localhost/api/analyze", {
    method: "POST",
    body: "[]",
  }), 64);
  assert.deepEqual(validArray, []);
});

test("training UI and API share training:run and production fails before body or provider access", async () => {
  const pageSource = await readFile(new URL("../app/dev/training/page.tsx", import.meta.url), "utf8");
  const routeSource = await readFile(new URL("../app/api/dev/training/run/route.ts", import.meta.url), "utf8");
  assert.match(pageSource, /protectedProductPage\("\/dev\/training",\s*"training:run"\)/u);
  assert.match(pageSource, /runnerAvailable=\{repositories\.developmentFixture\}/u);
  assert.match(pageSource, /repositories\.datasets\.list\(\)/u);
  assert.match(pageSource, /datasetVersions=\{datasetVersions\}/u);

  const productionGate = routeSource.indexOf("if (!repositories.developmentFixture)");
  const bodyRead = routeSource.indexOf("const body = await readJsonObject");
  const providerSecret = routeSource.indexOf("RISKSHIELD_INTERPRETER_API_KEY");
  const datasetLookup = routeSource.indexOf("repositories.datasets.getById(datasetId)");
  const shaVerification = routeSource.indexOf("registeredDataset.data.latestSha256 !== sourceSha256");
  assert.ok(productionGate > 0);
  assert.ok(bodyRead > productionGate);
  assert.ok(datasetLookup > bodyRead);
  assert.ok(shaVerification > datasetLookup);
  assert.ok(providerSecret > productionGate);
});

test("public analysis profiles change presentation without changing locked v4 scores", async () => {
  const routeSource = await readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8");
  const clientSource = await readFile(new URL("../app/PublicAnalyzer.tsx", import.meta.url), "utf8");
  assert.match(routeSource, /projectRules\(rules, profile\)/u);
  assert.match(routeSource, /profile === "advertising"/u);
  assert.match(routeSource, /잠긴 v4 점수는 바꾸지 않고/u);
  assert.match(clientSource, /result\.profile\.focus/u);
  assert.match(clientSource, /profile-\$\{result\.profile\.emphasis\}/u);
});

test("invalid session_not_before values fail closed", () => {
  const issuedAt = Date.parse("2026-07-20T00:00:00.000Z") / 1_000;
  assert.equal(sessionClearsNotBefore(issuedAt, null), true);
  assert.equal(sessionClearsNotBefore(issuedAt, "2026-07-19T23:59:59.000Z"), true);
  assert.equal(sessionClearsNotBefore(issuedAt, "2026-07-20T00:00:01.000Z"), false);
  assert.equal(sessionClearsNotBefore(issuedAt, "not-a-timestamp"), false);
});

test("D1 skill adapter returns reviewed and admin projections using SELECT only", async () => {
  const queries: string[] = [];
  const reviewed = starterSkills.find((skill) => skill.reviewStatus === "reviewed") ?? starterSkills[0];
  const db = fakeD1((sql) => {
    if (sql.includes("riskshield_settings")) {
      return { first: { payload: JSON.stringify(DEFAULT_SEVERITY_RULES) } };
    }
    if (sql.includes("review_status = 'reviewed'")) {
      return { all: [{ payload: JSON.stringify(reviewed) }] };
    }
    if (sql.includes("FROM risk_skills") && sql.includes("WHERE id = ?")) {
      return {
        first: {
          id: reviewed.id,
          category: reviewed.category,
          review_status: reviewed.reviewStatus,
          severity_floor: reviewed.severityFloor,
          dominant_risk: reviewed.dominantRisk ? 1 : 0,
          payload: JSON.stringify(reviewed),
          updated_at: reviewed.updatedAt,
        },
      };
    }
    return {
      all: [{
        id: reviewed.id,
        category: reviewed.category,
        review_status: reviewed.reviewStatus,
        severity_floor: reviewed.severityFloor,
        dominant_risk: reviewed.dominantRisk ? 1 : 0,
        payload: JSON.stringify(reviewed),
        updated_at: reviewed.updatedAt,
      }],
    };
  }, queries);

  const repository = new D1SkillRepository(db);
  const reviewedResult = await repository.listReviewed();
  const adminResult = await repository.listAdmin({ limit: 20 });
  const detailResult = await repository.getById(reviewed.id);
  const severityResult = await repository.readSeverityRules();

  assert.equal(reviewedResult.status, "ready");
  assert.equal(adminResult.status, "ready");
  assert.equal(detailResult.status, "ready");
  assert.equal(severityResult.status, "ready");
  if (adminResult.status === "ready") {
    assert.equal(adminResult.data.items[0]?.payload?.id, reviewed.id);
    assert.equal(adminResult.data.items[0]?.sourceCount, 1);
    assert.equal(adminResult.data.items[0]?.active, null);
  }
  assert.ok(queries.every((sql) => !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/iu.test(sql)));
});

test("D1 principal adapter reads roles and rejects malformed revocation boundaries", async () => {
  const queries: string[] = [];
  const principalRow = {
    user_id: "user-1",
    identity_provider: "google",
    external_subject: "google-subject",
    normalized_email: "reviewer@example.com",
    role_name: "reviewer",
    capabilities: JSON.stringify(["candidate:read"]),
    status: "active",
    role_version: 3,
    session_not_before: "invalid-date",
    updated_at: "2026-07-20T00:00:00.000Z",
  };
  const db = fakeD1((sql) => {
    if (sql.includes("riskshield_session_revocations")) return { first: null };
    if (sql.includes("ORDER BY")) return { all: [principalRow] };
    return { first: principalRow };
  }, queries);
  const repository = new D1PrincipalRepository(db);
  const list = await repository.list();
  const identity = await repository.findForGoogleIdentity({
    subject: "google-subject",
    email: "reviewer@example.com",
  });
  const session = await repository.resolveSession({
    sub: "user-1",
    sid: "session-1",
    roleVersion: 3,
    csrf: "csrf",
    iat: 1_784_524_800,
    exp: 1_784_525_700,
  });
  assert.equal(list.status, "ready");
  assert.equal(identity.status, "ready");
  assert.equal(session.status, "ready");
  if (session.status === "ready") assert.equal(session.data, null);
  assert.ok(queries.every((sql) => !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/iu.test(sql)));
});

test("repository factory selects labeled local fixtures only through the same three-part gate", async () => {
  const local = await createRepositoryServices({
    runtime: { RISKSHIELD_ENABLE_DEV_PRINCIPAL: "1" },
    host: "127.0.0.1:3000",
    nodeEnv: "development",
  });
  assert.equal(local.developmentFixture, true);
  assert.equal(local.label, "개발 데이터");
  const candidates = await local.candidates.list();
  assert.equal(candidates.status, "ready");
  if (candidates.status === "ready") {
    assert.equal(candidates.fixture, true);
    assert.equal(candidates.label, "개발 데이터");
    assert.ok(candidates.data.items.length >= 2);
    assert.ok(candidates.data.items.every((item) => item.autoInclusionBlockedReason));
  }

  const production = await createRepositoryServices({
    runtime: { RISKSHIELD_ENABLE_DEV_PRINCIPAL: "1" },
    host: "localhost:3000",
    nodeEnv: "production",
  });
  assert.equal(production.developmentFixture, false);
  assert.equal((await production.skills.listAdmin()).status, "configuration_required");
  assert.equal((await production.candidates.list()).status, "configuration_required");
});

test("local candidate adapter exposes detailed fixture projections without invented metrics", async () => {
  const result = await new LocalCandidateRepository().list();
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.ok(result.data.items.length >= 2);
  const candidate = result.data.items[0];
  assert.ok(candidate?.expressionGroup?.length);
  assert.ok(candidate?.contextSummary);
  assert.equal(candidate?.similarity, null);
  assert.equal(candidate?.modelConflict, null);
  assert.equal(candidate?.policyChange, null);
});

test("local mutation adapters acknowledge only real in-memory development changes", async () => {
  const skills = new LocalSkillRepository();
  const currentSkill = starterSkills[0];
  const revision = await skills.proposeRevision({
    skillId: currentSkill.id,
    baseRevision: currentSkill.revision,
    summary: "검토용 변경",
    rationale: "개발 fixture 경로 검증",
    proposedPayload: { ...currentSkill, revision: currentSkill.revision + 1 },
    actorId: "dev-owner",
  });
  assert.equal(revision.status, "ready");
  if (revision.status === "ready") {
    assert.equal(revision.data.persisted, true);
    assert.equal(revision.data.proposedRevision, currentSkill.revision + 1);
    assert.equal(revision.fixture, true);
  }

  const candidates = new LocalCandidateRepository();
  const listing = await candidates.list();
  assert.equal(listing.status, "ready");
  if (listing.status !== "ready") return;
  const candidateId = listing.data.items[0]?.id;
  assert.ok(candidateId);
  const decision = await candidates.decide({
    candidateId,
    decision: "hold",
    note: "추가 근거 필요",
    mergeSkillId: null,
    actorId: "dev-reviewer",
  });
  assert.equal(decision.status, "ready");
  if (decision.status === "ready") {
    assert.equal(decision.data.persisted, true);
    assert.equal(decision.data.candidateStatus, "held");
  }
  const decided = await candidates.getById(candidateId);
  assert.equal(decided.status, "ready");
  if (decided.status === "ready") assert.equal(decided.data?.status, "held");

  const datasets = new LocalDatasetRepository();
  const registration = await datasets.register({
    name: "test-dataset.csv",
    sha256: "a".repeat(64),
    byteSize: 128,
    rowCount: 2,
    encoding: "utf-8",
    delimiter: ",",
    headers: ["keyword", "category"],
    keywordColumn: "keyword",
    owner: "RiskShield",
    license: "internal-test",
    allowedPurpose: "development validation",
    retention: "session only",
    actorId: "dev-owner",
  });
  assert.equal(registration.status, "ready");
  if (registration.status === "ready") {
    assert.equal(registration.data.persisted, true);
    assert.equal(registration.data.status, "staging");
  }
});

test("production mutation adapters remain configuration-required and never imply a write", async () => {
  const production = await createRepositoryServices({
    runtime: {},
    host: "riskshield.example",
    nodeEnv: "production",
  });
  const [revision, decision, registration] = await Promise.all([
    production.skills.proposeRevision({
      skillId: "skill-1",
      baseRevision: 1,
      summary: "blocked",
      rationale: "blocked",
      proposedPayload: {},
      actorId: "owner",
    }),
    production.candidates.decide({
      candidateId: "candidate-1",
      decision: "reject",
      note: null,
      mergeSkillId: null,
      actorId: "reviewer",
    }),
    production.datasets.register({
      name: "blocked.csv",
      sha256: "b".repeat(64),
      byteSize: 1,
      rowCount: 1,
      encoding: "utf-8",
      delimiter: ",",
      headers: ["keyword"],
      keywordColumn: "keyword",
      owner: "owner",
      license: "unknown",
      allowedPurpose: "none",
      retention: "none",
      actorId: "owner",
    }),
  ]);
  for (const result of [revision, decision, registration]) {
    assert.equal(result.status, "configuration_required");
  }
});
