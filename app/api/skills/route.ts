import { desc, eq } from "drizzle-orm";
import { riskSkills } from "../../../db/schema";
import {
  RISK_SKILL_SCHEMA_VERSION,
  DEFAULT_SEVERITY_RULES,
  parseSeverityRules,
  previewSkillImport,
  starterSkills,
  validateSkill,
  type RiskSkill,
  type SeverityRules,
  type SkillImportMode,
} from "../../../lib/riskshield";

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_SKILL_BYTES = 64 * 1024;
const skillIdPattern = /^risk_[a-z0-9][a-z0-9_-]{2,63}$/;

let schemaPromise: Promise<void> | undefined;

async function getDatabase() {
  const { getDb } = await import("../../../db");
  return getDb();
}

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("RiskShield 저장소가 연결되지 않았습니다.");
  return env.DB;
}

function ensureSchema() {
  schemaPromise ??= import("cloudflare:workers")
    .then(async ({ env }) => {
      if (!env.DB) throw new Error("RiskShield 저장소가 연결되지 않았습니다.");
      const table = await env.DB.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'risk_skills'",
      ).first<{ sql?: string }>();
      if (table?.sql && !table.sql.includes("'rejected'")) {
        await env.DB.batch([
          env.DB.prepare("DROP INDEX IF EXISTS risk_skills_updated_idx"),
          env.DB.prepare("DROP INDEX IF EXISTS risk_skills_status_idx"),
          env.DB.prepare("ALTER TABLE risk_skills RENAME TO risk_skills_legacy"),
          env.DB.prepare(`
            CREATE TABLE risk_skills (
              id TEXT PRIMARY KEY NOT NULL,
              category TEXT NOT NULL,
              review_status TEXT NOT NULL CHECK (review_status IN ('draft', 'reviewed', 'rejected')),
              severity_floor INTEGER NOT NULL CHECK (severity_floor BETWEEN 0 AND 100),
              dominant_risk INTEGER NOT NULL CHECK (dominant_risk IN (0, 1)),
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
          `),
          env.DB.prepare(`
            INSERT INTO risk_skills
              (id, category, review_status, severity_floor, dominant_risk, payload, created_at, updated_at)
            SELECT id, category,
              CASE json_extract(payload, '$.reviewStatus')
                WHEN 'reviewed' THEN 'reviewed'
                WHEN 'rejected' THEN 'rejected'
                ELSE 'draft'
              END,
              severity_floor, dominant_risk, payload, created_at, updated_at
            FROM risk_skills_legacy
          `),
          env.DB.prepare("DROP TABLE risk_skills_legacy"),
        ]);
      }
      await env.DB.batch([
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS risk_skills (
            id TEXT PRIMARY KEY NOT NULL,
            category TEXT NOT NULL,
            review_status TEXT NOT NULL CHECK (review_status IN ('draft', 'reviewed', 'rejected')),
            severity_floor INTEGER NOT NULL CHECK (severity_floor BETWEEN 0 AND 100),
            dominant_risk INTEGER NOT NULL CHECK (dominant_risk IN (0, 1)),
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `),
        env.DB.prepare(
          "CREATE INDEX IF NOT EXISTS risk_skills_updated_idx ON risk_skills(updated_at DESC)",
        ),
        env.DB.prepare(
          "CREATE INDEX IF NOT EXISTS risk_skills_status_idx ON risk_skills(review_status, category)",
        ),
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS riskshield_settings (
            key TEXT PRIMARY KEY NOT NULL,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `),
      ]);
    })
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaPromise = undefined;
      throw error;
    });

  return schemaPromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseRiskSkill(value: unknown): { skill?: RiskSkill; issues: string[] } {
  if (!isRecord(value)) {
    return { issues: ["skill은 객체여야 합니다."] };
  }

  const issues: string[] = [];
  const stringFields = [
    "id",
    "category",
    "subcategory",
    "patternType",
    "surfaceMeaning",
    "riskSummary",
    "socialContext",
    "legalOrEthicIssue",
    "riskReason",
    "riskDomain",
    "falsePositiveNote",
    "createdAt",
    "updatedAt",
  ] as const;
  const arrayFields = [
    "triggerPatterns",
    "contextPatterns",
    "recentContextTags",
    "safeRewrite",
  ] as const;

  for (const field of stringFields) {
    if (typeof value[field] !== "string") issues.push(`${field}은 문자열이어야 합니다.`);
  }
  for (const field of arrayFields) {
    if (!isStringArray(value[field])) issues.push(`${field}은 문자열 배열이어야 합니다.`);
  }
  if (value.exclusionPatterns !== undefined && !isStringArray(value.exclusionPatterns)) {
    issues.push("exclusionPatterns는 문자열 배열이어야 합니다.");
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== RISK_SKILL_SCHEMA_VERSION) {
    issues.push(`schemaVersion은 ${RISK_SKILL_SCHEMA_VERSION}이어야 합니다.`);
  }
  if (
    value.revision !== undefined &&
    (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 1)
  ) {
    issues.push("revision은 1 이상의 정수여야 합니다.");
  }
  if (value.anyOfPatterns !== undefined && !isStringArray(value.anyOfPatterns)) {
    issues.push("anyOfPatterns는 문자열 배열이어야 합니다.");
  }
  if (
    value.conditionScope !== undefined &&
    value.conditionScope !== "sentence" &&
    value.conditionScope !== "paragraph"
  ) {
    issues.push("conditionScope는 sentence 또는 paragraph여야 합니다.");
  }
  if (
    value.maxDistance !== undefined &&
    (
      typeof value.maxDistance !== "number" ||
      !Number.isInteger(value.maxDistance) ||
      value.maxDistance < 0 ||
      value.maxDistance > 2_000
    )
  ) {
    issues.push("maxDistance는 0에서 2000 사이의 정수여야 합니다.");
  }
  if (value.notes !== undefined && typeof value.notes !== "string") {
    issues.push("notes는 문자열이어야 합니다.");
  }
  if (typeof value.severityFloor !== "number" || !Number.isFinite(value.severityFloor)) {
    issues.push("severityFloor은 유한한 숫자여야 합니다.");
  }
  if (typeof value.dominantRisk !== "boolean") {
    issues.push("dominantRisk는 불리언이어야 합니다.");
  }
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence)) {
    issues.push("confidence는 유한한 숫자여야 합니다.");
  }
  if (
    value.reviewStatus !== "draft" &&
    value.reviewStatus !== "reviewed" &&
    value.reviewStatus !== "rejected"
  ) {
    issues.push("reviewStatus는 draft, reviewed 또는 rejected여야 합니다.");
  }
  if (typeof value.id === "string" && !skillIdPattern.test(value.id)) {
    issues.push("id는 risk_로 시작하는 안전한 식별자여야 합니다.");
  }

  if (!isRecord(value.source)) {
    issues.push("source는 객체여야 합니다.");
  } else {
    for (const field of ["title", "url", "date"] as const) {
      if (typeof value.source[field] !== "string") {
        issues.push(`source.${field}은 문자열이어야 합니다.`);
      }
    }
    if (value.source.sourceId !== undefined && typeof value.source.sourceId !== "string") {
      issues.push("source.sourceId는 문자열이어야 합니다.");
    }
    if (
      value.source.provenanceStatus !== undefined &&
      value.source.provenanceStatus !== "provided" &&
      value.source.provenanceStatus !== "verified" &&
      value.source.provenanceStatus !== "synthetic_unverified"
    ) {
      issues.push("source.provenanceStatus 값이 올바르지 않습니다.");
    }
  }

  if (issues.length || !isRecord(value.source)) return { issues };

  const source = value.source;
  const skill: RiskSkill = {
    schemaVersion: (value.schemaVersion ?? RISK_SKILL_SCHEMA_VERSION) as RiskSkill["schemaVersion"],
    revision: (value.revision ?? 1) as number,
    id: value.id as string,
    category: value.category as string,
    subcategory: value.subcategory as string,
    patternType: value.patternType as string,
    triggerPatterns: value.triggerPatterns as string[],
    contextPatterns: value.contextPatterns as string[],
    anyOfPatterns: (value.anyOfPatterns ?? []) as string[],
    ...(value.exclusionPatterns === undefined
      ? {}
      : { exclusionPatterns: value.exclusionPatterns as string[] }),
    conditionScope: (value.conditionScope ?? "sentence") as RiskSkill["conditionScope"],
    maxDistance: (value.maxDistance ?? 48) as number,
    surfaceMeaning: value.surfaceMeaning as string,
    riskSummary: value.riskSummary as string,
    socialContext: value.socialContext as string,
    legalOrEthicIssue: value.legalOrEthicIssue as string,
    riskReason: value.riskReason as string,
    severityFloor: value.severityFloor as number,
    dominantRisk: value.dominantRisk as boolean,
    confidence: value.confidence as number,
    riskDomain: value.riskDomain as string,
    recentContextTags: value.recentContextTags as string[],
    safeRewrite: value.safeRewrite as string[],
    falsePositiveNote: value.falsePositiveNote as string,
    notes: (value.notes ?? "") as string,
    source: {
      title: source.title as string,
      url: source.url as string,
      date: source.date as string,
      ...(typeof source.sourceId === "string" ? { sourceId: source.sourceId } : {}),
      ...(source.provenanceStatus === undefined
        ? {}
        : {
            provenanceStatus: source.provenanceStatus as NonNullable<
              RiskSkill["source"]["provenanceStatus"]
            >,
          }),
    },
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
    reviewStatus: value.reviewStatus as RiskSkill["reviewStatus"],
  };
  return { skill, issues };
}

function rowForSkill(skill: RiskSkill) {
  return {
    id: skill.id,
    category: skill.category,
    reviewStatus: skill.reviewStatus,
    severityFloor: skill.severityFloor,
    dominantRisk: skill.dominantRisk,
    payload: JSON.stringify(skill),
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function parseRows(rows: Array<{ payload: string }>) {
  return rows.flatMap((row) => {
    try {
      const parsed = parseRiskSkill(JSON.parse(row.payload));
      return parsed.skill ? [parsed.skill] : [];
    } catch {
      return [];
    }
  });
}

async function seedIfEmpty() {
  const db = await getDatabase();
  const existing = await db.select({ id: riskSkills.id }).from(riskSkills).limit(1);
  if (existing.length) return;
  // D1/SQLite caps the number of bound variables in a statement. Inserting the
  // full starter bundle at once crosses that cap because every skill has eight
  // persisted columns. Seed one row per statement so the production Worker
  // preview and a fresh D1 database behave the same regardless of bundle size.
  for (const skill of starterSkills) {
    await db.insert(riskSkills).values(rowForSkill(skill)).onConflictDoNothing();
  }
}

async function upgradeUnmodifiedBundledRules() {
  const db = await getDatabase();
  const rows = await db.select({ payload: riskSkills.payload }).from(riskSkills);
  const currentSkills = parseRows(rows);
  const currentById = new Map(currentSkills.map((skill) => [skill.id, skill]));
  const hasUntouchedBundle = currentSkills.some((skill) =>
    skill.source.sourceId === "handoff_expected_behavior"
    && skill.createdAt === "2026-07-17T00:00:00.000Z"
    && skill.updatedAt === "2026-07-17T00:00:00.000Z");
  if (!hasUntouchedBundle) return;

  const candidates = starterSkills.filter((bundled) => {
    const current = currentById.get(bundled.id);
    if (!current) return true;
    return current.source.sourceId === "handoff_expected_behavior"
      && current.createdAt === "2026-07-17T00:00:00.000Z"
      && current.updatedAt === "2026-07-17T00:00:00.000Z"
      && current.revision < bundled.revision;
  });
  for (const bundled of candidates) {
    const row = rowForSkill(bundled);
    await db.insert(riskSkills).values(row).onConflictDoUpdate({
      target: riskSkills.id,
      set: {
        category: row.category,
        reviewStatus: row.reviewStatus,
        severityFloor: row.severityFloor,
        dominantRisk: row.dominantRisk,
        payload: row.payload,
        updatedAt: row.updatedAt,
      },
    });
  }
}

async function readSeverityRules(): Promise<SeverityRules> {
  const d1 = await getD1();
  const row = await d1.prepare(
    "SELECT payload FROM riskshield_settings WHERE key = 'severity_rules'",
  ).first<{ payload?: string }>();
  if (!row?.payload) return DEFAULT_SEVERITY_RULES;
  const parsed = parseSeverityRules(row.payload);
  return parsed.issues.length ? DEFAULT_SEVERITY_RULES : parsed.rules;
}

function serverError(scope: string, error: unknown, userMessage: string) {
  console.error(`[RiskShield skills API] ${scope}`, error);
  return Response.json({ error: userMessage }, { status: 500 });
}

export async function GET() {
  try {
    await ensureSchema();
    await seedIfEmpty();
    await upgradeUnmodifiedBundledRules();
    const rows = await (await getDatabase())
      .select({ payload: riskSkills.payload })
      .from(riskSkills)
      .orderBy(desc(riskSkills.updatedAt));
    return Response.json({
      skills: parseRows(rows),
      severityRules: await readSeverityRules(),
      storage: "d1",
    });
  } catch (error) {
    return serverError("GET", error, "스킬을 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: "요청 크기가 너무 큽니다." }, { status: 413 });
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json({ error: "올바른 JSON 요청이 필요합니다." }, { status: 400 });
  }
  if (!isRecord(body) || !Array.isArray(body.skills)) {
    return Response.json({ error: "skills 배열이 필요합니다." }, { status: 400 });
  }
  const mode: SkillImportMode = body.mode === "replace" ? "replace" : "merge";
  if (mode === "replace" && body.confirmReplace !== true) {
    return Response.json({ error: "전체 교체 확인이 필요합니다." }, { status: 400 });
  }

  const incoming: RiskSkill[] = [];
  const issues: string[] = [];
  const ids = new Set<string>();
  body.skills.forEach((value, index) => {
    const parsed = parseRiskSkill(value);
    if (!parsed.skill) {
      issues.push(`${index + 1}번 스킬: ${parsed.issues.join(" ")}`);
      return;
    }
    const validationIssues = validateSkill(parsed.skill);
    if (validationIssues.length) {
      issues.push(`${parsed.skill.id}: ${validationIssues.join(" ")}`);
      return;
    }
    if (ids.has(parsed.skill.id)) {
      issues.push(`${parsed.skill.id}: 중복 ID입니다.`);
      return;
    }
    ids.add(parsed.skill.id);
    incoming.push(parsed.skill);
  });
  const severity = body.severityRules === undefined
    ? { rules: DEFAULT_SEVERITY_RULES, issues: [] as string[] }
    : parseSeverityRules(body.severityRules);
  issues.push(...severity.issues);
  if (issues.length) {
    return Response.json({ error: "가져오기 데이터가 올바르지 않습니다.", issues }, { status: 400 });
  }

  try {
    await ensureSchema();
    await seedIfEmpty();
    await upgradeUnmodifiedBundledRules();
    const currentRows = await (await getDatabase())
      .select({ payload: riskSkills.payload })
      .from(riskSkills);
    const currentSkills = parseRows(currentRows);
    const preview = previewSkillImport(currentSkills, incoming, mode);
    const now = new Date().toISOString();
    const d1 = await getD1();
    const changedIds = new Set([...preview.newIds, ...preview.updateIds]);
    const skillsToPersist = mode === "replace"
      ? preview.finalSkills
      : preview.finalSkills.filter((skill) => changedIds.has(skill.id));
    const statements = mode === "replace"
      ? [d1.prepare("DELETE FROM risk_skills")]
      : [];
    for (const skill of skillsToPersist) {
      const row = rowForSkill(skill);
      statements.push(d1.prepare(`
        INSERT INTO risk_skills
          (id, category, review_status, severity_floor, dominant_risk, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          review_status = excluded.review_status,
          severity_floor = excluded.severity_floor,
          dominant_risk = excluded.dominant_risk,
          payload = excluded.payload,
          updated_at = excluded.updated_at
      `).bind(
        row.id,
        row.category,
        row.reviewStatus,
        row.severityFloor,
        row.dominantRisk ? 1 : 0,
        row.payload,
        row.createdAt,
        row.updatedAt,
      ));
    }
    statements.push(d1.prepare(`
      INSERT INTO riskshield_settings (key, payload, updated_at)
      VALUES ('severity_rules', ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).bind(JSON.stringify(severity.rules), now));
    await d1.batch(statements);

    const savedRows = await (await getDatabase())
      .select({ payload: riskSkills.payload })
      .from(riskSkills)
      .orderBy(desc(riskSkills.updatedAt));
    const savedSkills = parseRows(savedRows);
    if (savedSkills.length !== preview.finalCount) {
      throw new Error("가져오기 저장 후 개수 검증에 실패했습니다.");
    }
    const summary = {
      mode: preview.mode,
      newCount: preview.newCount,
      updateCount: preview.updateCount,
      sameCount: preview.sameCount,
      conflictCount: preview.conflictCount,
      skippedCount: preview.skippedCount,
      errorCount: preview.errorCount,
      finalCount: preview.finalCount,
      newIds: preview.newIds,
      updateIds: preview.updateIds,
      sameIds: preview.sameIds,
      conflictIds: preview.conflictIds,
    };
    return Response.json({ skills: savedSkills, severityRules: severity.rules, summary, storage: "d1" });
  } catch (error) {
    return serverError("PUT", error, "스킬 번들을 저장하지 못했습니다.");
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "요청 크기가 너무 큽니다." }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: "요청 본문을 읽지 못했습니다." }, { status: 400 });
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "요청 크기가 너무 큽니다." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json({ error: "올바른 JSON 요청이 필요합니다." }, { status: 400 });
  }

  if (!isRecord(body) || !("skill" in body)) {
    return Response.json({ error: "skill payload is required" }, { status: 400 });
  }
  const parsed = parseRiskSkill(body.skill);
  if (!parsed.skill) {
    return Response.json(
      { error: "스킬 데이터 형식이 올바르지 않습니다.", issues: parsed.issues },
      { status: 400 },
    );
  }

  try {
    await ensureSchema();
    const db = await getDatabase();
    const [existing] = await db
      .select({ createdAt: riskSkills.createdAt })
      .from(riskSkills)
      .where(eq(riskSkills.id, parsed.skill.id))
      .limit(1);
    const now = new Date().toISOString();
    const skill = {
      ...parsed.skill,
      createdAt: existing?.createdAt ?? (parsed.skill.createdAt || now),
      updatedAt: now,
    } satisfies RiskSkill;
    const issues = validateSkill(skill);
    if (issues.length) {
      return Response.json({ error: issues.join(" "), issues }, { status: 400 });
    }

    if (new TextEncoder().encode(JSON.stringify(skill)).byteLength > MAX_SKILL_BYTES) {
      return Response.json({ error: "스킬 데이터 크기가 너무 큽니다." }, { status: 413 });
    }

    const row = rowForSkill(skill);
    await db
      .insert(riskSkills)
      .values(row)
      .onConflictDoUpdate({
        target: riskSkills.id,
        set: {
          category: row.category,
          reviewStatus: row.reviewStatus,
          severityFloor: row.severityFloor,
          dominantRisk: row.dominantRisk,
          payload: row.payload,
          updatedAt: row.updatedAt,
        },
      });
    return Response.json({ skill, issues }, { status: 200 });
  } catch (error) {
    return serverError("POST", error, "스킬을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });
    if (!skillIdPattern.test(id)) {
      return Response.json({ error: "id 형식이 올바르지 않습니다." }, { status: 400 });
    }
    await (await getDatabase()).delete(riskSkills).where(eq(riskSkills.id, id));
    return Response.json({ deleted: id });
  } catch (error) {
    return serverError("DELETE", error, "스킬을 삭제하지 못했습니다.");
  }
}
