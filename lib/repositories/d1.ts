import {
  isCapability,
  isRole,
  type Capability,
  type CurrentPrincipal,
  type Role,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../auth/current-principal.ts";
import {
  sessionClearsNotBefore,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../auth/identity-adapter.ts";
import type {
  SessionClaims,
} from "../auth/session.ts";
import {
  DEFAULT_SEVERITY_RULES,
  RISK_SKILL_SCHEMA_VERSION,
  analyzeText,
  parseSeverityRules,
  validateManagedSkill,
  starterSkills,
  type ReviewStatus,
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../riskshield.ts";
import {
  resolveActiveReviewedSkills,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../active-skills.ts";
import {
  configurationRequired,
  ready,
  unavailable,
  type AnalyzerService,
  type AuditRecord,
  type AuditRepository,
  type CandidateDecisionAcknowledgement,
  type CandidateDecisionInput,
  type CandidateRecord,
  type CandidateRepository,
  type DatasetRecord,
  type DatasetRegistrationAcknowledgement,
  type DatasetRegistrationInput,
  type DatasetRepository,
  type DatasetVersionRecord,
  type EvaluationRepository,
  type EvaluationRunRecord,
  type GeneratedCandidateRecordInput,
  type PrincipalRecord,
  type PrincipalRepository,
  type RepositoryPage,
  type RepositoryResult,
  type SkillAdminRecord,
  type SkillRepository,
  type SkillRevisionAcknowledgement,
  type SkillRevisionInput,
  type TrainingRepository,
  type TrainingRunRecord,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./contracts.ts";

type EvaluationRow = {
  id: string;
  status: string;
  case_count: number;
  metrics_json: string;
  results_json: string;
  source_commit: string;
  scoring_policy: string;
  created_at: string;
};

function parsedEvaluation(row: EvaluationRow): EvaluationRunRecord | null {
  try {
    const metrics = JSON.parse(row.metrics_json) as Record<string, number | null>;
    const results = JSON.parse(row.results_json) as Array<{ riskCorrect?: boolean }>;
    const passed = results.filter((result) => result.riskCorrect === true).length;
    return {
      id: row.id, baselineVersion: null, candidateVersion: row.scoring_policy, codeSha: row.source_commit,
      modelVersion: "rules-only evaluation", promptVersion: "not-used", schemaVersion: row.scoring_policy,
      datasetVersion: "labeled-cases", testCount: row.case_count, passed, failed: Math.max(0, row.case_count - passed),
      status: row.status === "completed"
        ? passed === row.case_count ? "passed" : "failed"
        : row.status === "running" ? "running"
          : row.status === "failed" ? "failed" : "unavailable",
      measuredAt: row.created_at,
      metrics: {
        falseHigh: metrics.falsePositive ?? null, falseNegative: metrics.falseNegative ?? null,
        unnecessaryReview: null, noMatch: null, jsonSuccessRate: null, providerFallbackRate: null,
        latencyP50Ms: null, latencyP95Ms: null, estimatedCostUsd: 0,
      },
      profileSlices: null, contextSlices: null,
    };
  } catch { return null; }
}

export class D1EvaluationRepository implements EvaluationRepository {
  private readonly db?: D1Database;
  constructor(db?: D1Database) { this.db = db; }
  async listRuns() {
    if (!this.db) return configurationRequired<RepositoryPage<EvaluationRunRecord>>("evaluation_storage_required", "평가 저장소가 필요합니다.", ["DB"]);
    try {
      const rows = await this.db.prepare(`SELECT id, status, case_count, metrics_json, results_json, source_commit, scoring_policy, created_at FROM riskshield_evaluation_runs ORDER BY created_at DESC LIMIT 100`).all<EvaluationRow>();
      return ready({ items: (rows.results ?? []).flatMap((row) => { const record = parsedEvaluation(row); return record ? [record] : []; }), nextCursor: null }, "d1");
    } catch { return unavailable<RepositoryPage<EvaluationRunRecord>>("evaluation_read_failed", "평가 실행을 읽지 못했습니다."); }
  }
  async getRun(id: string) {
    if (!this.db) return configurationRequired<EvaluationRunRecord | null>("evaluation_storage_required", "평가 저장소가 필요합니다.", ["DB"]);
    try {
      const row = await this.db.prepare(`SELECT id, status, case_count, metrics_json, results_json, source_commit, scoring_policy, created_at FROM riskshield_evaluation_runs WHERE id = ? LIMIT 1`).bind(id).first<EvaluationRow>();
      return ready(row ? parsedEvaluation(row) : null, "d1");
    } catch { return unavailable<EvaluationRunRecord | null>("evaluation_read_failed", "평가 실행을 읽지 못했습니다."); }
  }
}

type SkillRow = {
  id: string;
  category: string;
  review_status: string;
  severity_floor: number;
  dominant_risk: number;
  payload: string;
  updated_at: string;
};

type PrincipalRow = {
  user_id: string;
  identity_provider: string;
  external_subject: string;
  normalized_email: string;
  role_name: string;
  capabilities: string;
  status: string;
  role_version: number;
  session_not_before: string | null;
  updated_at: string | null;
};

const PRINCIPAL_SELECT = `
  SELECT
    u.id AS user_id,
    u.identity_provider,
    u.external_subject,
    u.normalized_email,
    u.role_name,
    r.capabilities,
    u.status,
    u.role_version,
    u.session_not_before,
    u.updated_at
  FROM riskshield_users AS u
  INNER JOIN riskshield_roles AS r ON r.name = u.role_name
`;

function storageRequired<T>(): RepositoryResult<T> {
  return configurationRequired(
    "d1_binding_required",
    "D1 저장소 binding이 필요합니다.",
    ["DB"],
  );
}

function storageUnavailable<T>(): RepositoryResult<T> {
  return unavailable("d1_read_failed", "저장소를 읽을 수 없습니다.");
}

type AuditWrite = {
  occurredAt: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  result: "succeeded" | "denied" | "failed";
  beforeJson?: string | null;
  afterJson?: string | null;
  reason?: string | null;
};

async function chainedAuditStatements(db: D1Database, input: AuditWrite) {
  const previous = await db.prepare(
    "SELECT entry_hash FROM riskshield_audit_chain ORDER BY sequence DESC LIMIT 1",
  ).first<{ entry_hash: string }>();
  const previousHash = previous?.entry_hash ?? "GENESIS";
  const auditId = crypto.randomUUID();
  const canonical = JSON.stringify([
    previousHash,
    auditId,
    input.occurredAt,
    input.actorId,
    input.action,
    input.resourceType,
    input.resourceId,
    input.result,
    input.beforeJson ?? null,
    input.afterJson ?? null,
    input.reason ?? null,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const entryHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    db.prepare(`
      INSERT INTO riskshield_audit_logs
        (id, occurred_at, actor_id, action, resource_type, resource_id, result, before_json, after_json, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      auditId,
      input.occurredAt,
      input.actorId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.result,
      input.beforeJson ?? null,
      input.afterJson ?? null,
      input.reason ?? null,
    ),
    db.prepare(`
      INSERT INTO riskshield_audit_chain (audit_id, previous_hash, entry_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(auditId, previousHash, entryHash, input.occurredAt),
  ];
}

function reviewStatus(value: string): ReviewStatus | "invalid" {
  return value === "draft" || value === "reviewed" || value === "rejected" ? value : "invalid";
}

function parseSkill(value: string) {
  try {
    const parsed = JSON.parse(value) as RiskSkill;
    const compatibilityId = starterSkills.some((skill) => skill.id === parsed.id);
    const validationIssues = compatibilityId ? [] : validateManagedSkill(parsed);
    return {
      skill: validationIssues.length === 0 ? parsed : null,
      validationIssues,
    };
  } catch {
    return { skill: null, validationIssues: ["payload_json_invalid"] };
  }
}

function adminRecord(row: SkillRow): SkillAdminRecord {
  const parsed = parseSkill(row.payload);
  return {
    id: row.id,
    category: row.category,
    reviewStatus: reviewStatus(row.review_status),
    severityFloor: row.severity_floor,
    dominantRisk: row.dominant_risk === 1,
    revision: parsed.skill?.revision ?? null,
    updatedAt: row.updated_at,
    active: null,
    sourceCount: parsed.skill?.source ? 1 : null,
    payload: parsed.skill,
    skill: parsed.skill,
    validationIssues: parsed.validationIssues,
  };
}

function capabilitiesFrom(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return new Set<Capability>();
    return new Set(parsed.filter(
      (item): item is Capability => typeof item === "string" && isCapability(item),
    ));
  } catch {
    return new Set<Capability>();
  }
}

function principalRecord(row: PrincipalRow): PrincipalRecord {
  return {
    id: row.user_id,
    identityProvider: row.identity_provider === "google" ? "google" : "unknown",
    externalSubject: row.external_subject,
    normalizedEmail: row.normalized_email,
    role: isRole(row.role_name) ? row.role_name : "invalid",
    status: row.status === "active" ? "active" : row.status === "disabled" ? "disabled" : "invalid",
    roleVersion: row.role_version,
    sessionNotBefore: row.session_not_before,
    updatedAt: row.updated_at,
  };
}

export class D1SkillRepository implements SkillRepository {
  private readonly db?: D1Database;

  constructor(db?: D1Database) {
    this.db = db;
  }

  async listReviewed() {
    if (!this.db) return storageRequired<readonly RiskSkill[]>();
    try {
      const rows = await this.db.prepare(
        "SELECT id, review_status, payload FROM risk_skills ORDER BY updated_at DESC",
      ).all<{ id: string; review_status: string; payload: string }>();
      return ready(resolveActiveReviewedSkills(rows.results ?? []), "d1");
    } catch {
      return storageUnavailable<readonly RiskSkill[]>();
    }
  }

  async readSeverityRules() {
    if (!this.db) return storageRequired<typeof DEFAULT_SEVERITY_RULES>();
    try {
      const row = await this.db.prepare(
        "SELECT payload FROM riskshield_settings WHERE key = 'severity_rules' LIMIT 1",
      ).first<{ payload?: string }>();
      if (!row?.payload) return ready(DEFAULT_SEVERITY_RULES, "d1");
      const parsed = parseSeverityRules(row.payload);
      return ready(parsed.issues.length === 0 ? parsed.rules : DEFAULT_SEVERITY_RULES, "d1");
    } catch {
      return storageUnavailable<typeof DEFAULT_SEVERITY_RULES>();
    }
  }

  async listAdmin(input: { limit?: number; cursor?: string } = {}) {
    if (!this.db) return storageRequired<RepositoryPage<SkillAdminRecord>>();
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const offset = Math.max(0, Number.parseInt(input.cursor ?? "0", 10) || 0);
    try {
      const response = await this.db.prepare(`
        SELECT id, category, review_status, severity_floor, dominant_risk, payload, updated_at
        FROM risk_skills
        ORDER BY updated_at DESC, id ASC
        LIMIT ? OFFSET ?
      `).bind(limit + 1, offset).all<SkillRow>();
      const rows = response.results ?? [];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(adminRecord);
      return ready({
        items,
        nextCursor: hasMore ? String(offset + items.length) : null,
      }, "d1");
    } catch {
      return storageUnavailable<RepositoryPage<SkillAdminRecord>>();
    }
  }

  async getById(id: string) {
    if (!this.db) return storageRequired<SkillAdminRecord | null>();
    try {
      const row = await this.db.prepare(`
        SELECT id, category, review_status, severity_floor, dominant_risk, payload, updated_at
        FROM risk_skills
        WHERE id = ?
        LIMIT 1
      `).bind(id).first<SkillRow>();
      return ready(row ? adminRecord(row) : null, "d1");
    } catch {
      return storageUnavailable<SkillAdminRecord | null>();
    }
  }

  async proposeRevision(input: SkillRevisionInput) {
    if (!this.db) return storageRequired<SkillRevisionAcknowledgement>();
    try {
      const current = await this.getById(input.skillId);
      if (current.status !== "ready") return current;
      if (!current.data || current.data.revision !== input.baseRevision) {
        return ready<SkillRevisionAcknowledgement>({
          revisionId: `revision_rejected_${input.skillId}`,
          proposedRevision: input.baseRevision + 1,
          message: "현재 revision과 기준 revision이 달라 제안을 저장하지 않았습니다.",
          persisted: false,
        }, "d1");
      }
      const proposedPayload = input.proposedPayload as unknown as RiskSkill;
      const proposedIssues = validateManagedSkill(proposedPayload);
      if (proposedIssues.length > 0 || proposedPayload.id !== input.skillId || proposedPayload.revision !== input.baseRevision + 1) {
        return ready<SkillRevisionAcknowledgement>({
          revisionId: `revision_invalid_${input.skillId}`,
          proposedRevision: input.baseRevision + 1,
          message: `revision payload 검증 실패: ${proposedIssues[0] ?? "ID 또는 revision 불일치"}`,
          persisted: false,
        }, "d1");
      }
      const now = new Date().toISOString();
      const revisionId = crypto.randomUUID();
      const audit = await chainedAuditStatements(this.db, {
        occurredAt: now,
        actorId: input.actorId,
        action: "skill.revision.proposed",
        resourceType: "skill_revision",
        resourceId: revisionId,
        result: "succeeded",
        afterJson: JSON.stringify({ skillId: input.skillId, proposedRevision: input.baseRevision + 1 }),
        reason: input.rationale,
      });
      await this.db.batch([
        this.db.prepare(`
          INSERT INTO riskshield_skill_revisions
            (id, skill_id, base_revision, proposed_revision, summary, rationale, payload, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(revisionId, input.skillId, input.baseRevision, input.baseRevision + 1, input.summary, input.rationale, JSON.stringify(input.proposedPayload), input.actorId, now),
        ...audit,
      ]);
      return ready<SkillRevisionAcknowledgement>({
        revisionId,
        proposedRevision: input.baseRevision + 1,
        message: "새 revision 제안과 감사 이력을 D1에 저장했습니다. 활성 스킬은 아직 변경하지 않았습니다.",
        persisted: true,
      }, "d1");
    } catch {
      return unavailable<SkillRevisionAcknowledgement>("skill_revision_write_failed", "revision 제안을 D1에 저장하지 못했습니다.");
    }
    /*
    return configurationRequired<SkillRevisionAcknowledgement>(
      "skill_revision_configuration_required",
      "스킬 revision 쓰기 저장소와 감사 계약이 필요합니다.",
      ["skill_revisions migration", "audit_logs migration"],
    ); */
  }
}

export class D1AnalyzerService implements AnalyzerService {
  private readonly skills: SkillRepository;

  constructor(skills: SkillRepository) {
    this.skills = skills;
  }

  async analyze(text: string) {
    const [skillResult, severityResult] = await Promise.all([
      this.skills.listReviewed(),
      this.skills.readSeverityRules(),
    ]);
    if (skillResult.status !== "ready") return skillResult;
    if (severityResult.status !== "ready") return severityResult;
    return ready(analyzeText(text, [...skillResult.data], { severityRules: severityResult.data }), "d1");
  }
}

type CandidateRow = {
  id: string;
  status: string;
  payload: string;
  created_at: string;
};

type DatasetRow = {
  id: string;
  name: string;
  source_kind: string;
  status: string;
  owner: string;
  license: string;
  allowed_purpose: string;
  retention: string;
  updated_at: string;
  version_count: number;
  latest_sha256: string | null;
  latest_keyword_column: string | null;
  latest_object_key: string | null;
};

type DatasetVersionRow = {
  id: string;
  dataset_id: string;
  version_number: number;
  sha256: string;
  byte_size: number;
  row_count: number;
  encoding: string;
  delimiter: string;
  headers_json: string;
  keyword_column: string;
  object_key: string | null;
  created_at: string;
};

type TrainingRunRow = {
  id: string;
  dataset_version_id: string | null;
  status: string;
  current_stage: string | null;
  item_count: number | null;
  warning_count: number | null;
  estimated_cost: number | null;
  latency_ms: number | null;
  updated_at: string | null;
};

function parsedCandidate(row: CandidateRow): CandidateRecord | null {
  try {
    const payload = JSON.parse(row.payload) as CandidateRecord;
    const statuses = new Set<CandidateRecord["status"]>(["pending", "approved", "merged", "held", "rejected"]);
    if (!payload || typeof payload !== "object" || !payload.expression || !statuses.has(row.status as CandidateRecord["status"])) {
      return null;
    }
    return {
      ...payload,
      id: row.id,
      status: row.status as CandidateRecord["status"],
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

const COLLECTOR_QUALITY_GATE_VERSION = "collector-semantic-search-v1";
const REVIEWABLE_COLLECTOR_ROLES = new Set(["harmful_expression", "coded_expression", "deceptive_claim"]);

export function visibleInDefaultCandidateInbox(candidate: CandidateRecord) {
  const collector = candidate.origin?.type === "collector" || candidate.reportType === "collector_discovery";
  if (!collector) return true;
  const gateVersion = candidate.origin?.type === "collector"
    ? candidate.origin.qualityGateVersion
    : candidate.qualityGateVersion;
  return gateVersion === COLLECTOR_QUALITY_GATE_VERSION
    && candidate.qualification?.disposition === "review"
    && REVIEWABLE_COLLECTOR_ROLES.has(candidate.qualification.role)
    && candidate.searchVerification?.decision === "send_to_review"
    && REVIEWABLE_COLLECTOR_ROLES.has(candidate.searchVerification.role);
}

function candidateStatus(decision: CandidateDecisionInput["decision"]): CandidateRecord["status"] {
  if (decision === "hold") return "held";
  if (decision === "reject") return "rejected";
  if (decision === "merge") return "merged";
  return "approved";
}

function generatedSkill(
  candidate: CandidateRecord,
  now: string,
  draft: NonNullable<CandidateRecord["draft"]> | null = candidate.draft ?? null,
): RiskSkill | null {
  if (!draft) return null;
  const source = candidate.sources?.[0];
  const sourceId = candidate.lineage?.datasetVersionId ?? candidate.id;
  const skill: RiskSkill = {
    schemaVersion: RISK_SKILL_SCHEMA_VERSION,
    revision: 1,
    id: candidate.id.startsWith("risk_") ? candidate.id : `risk_generated_${candidate.id.replace(/[^a-zA-Z0-9_-]+/gu, "_")}`,
    category: candidate.riskDomain || "미분류 광고 위험",
    subcategory: draft.title,
    patternType: "generated_candidate_review",
    matchMode: draft.matchMode ?? (draft.contextPatterns.length ? "trigger_and_context" : "atomic_lexeme"),
    triggerPatterns: [...new Set(draft.triggerPatterns.map((value) => value.trim()).filter(Boolean))],
    contextPatterns: [...new Set(draft.contextPatterns.map((value) => value.trim()).filter(Boolean))],
    anyOfPatterns: [],
    exclusionPatterns: [...new Set((draft.exclusionPatterns ?? []).map((value) => value.trim()).filter(Boolean))],
    regressionTests: [
      ...(candidate.positiveTests ?? []).map((input, index) => ({
        id: `${candidate.id}:positive:${index + 1}`,
        input: input.trim(),
        expected: "match" as const,
        contextSlice: "후보 생성 단계에서 등록된 양성 예시",
      })),
      ...(candidate.negativeTests ?? []).map((input, index) => ({
        id: `${candidate.id}:negative:${index + 1}`,
        input: input.trim(),
        expected: "no_match" as const,
        contextSlice: "후보 생성 단계에서 등록된 음성·경고 문맥 예시",
      })),
    ].filter((regressionCase) => regressionCase.input),
    conditionScope: "sentence",
    maxDistance: 96,
    surfaceMeaning: candidate.expression,
    riskSummary: draft.riskSummary,
    socialContext: candidate.contextSummary ?? "등록된 데이터셋에서 발견된 표현군을 사람이 검토했습니다.",
    legalOrEthicIssue: draft.riskSummary,
    riskReason: draft.riskSummary,
    severityFloor: Math.min(100, Math.max(1, Math.round(draft.severityFloor ?? 60))),
    dominantRisk: false,
    confidence: candidate.confidence ?? 0.6,
    riskFamily: draft.riskFamily ?? candidate.riskFamily ?? "general_substantiation",
    riskDomain: draft.riskDomain?.trim() || candidate.riskDomain || "미분류 텍스트 위험",
    recentContextTags: ["dataset", "candidate_approved"],
    safeRewrite: [...new Set(draft.safeRewrite.map((value) => value.trim()).filter(Boolean))],
    falsePositiveNote: "인용·비판·교육·금지 문맥과 근거가 있는 사실 설명은 별도로 검토합니다.",
    notes: `후보 ${candidate.id}에서 사람의 명시적 승인으로 생성했습니다.`,
    source: {
      title: source?.title?.trim() || `Dataset ${sourceId}`,
      url: source?.url?.trim() || "",
      date: source?.date?.trim() || now.slice(0, 10),
      sourceId,
      provenanceStatus: "provided",
    },
    createdAt: now,
    updatedAt: now,
    reviewStatus: "draft",
  };
  return validateManagedSkill(skill).length === 0 ? skill : null;
}

function mergedSkillProposal(target: RiskSkill, generated: RiskSkill, now: string): RiskSkill | null {
  const merged: RiskSkill = {
    ...target,
    revision: target.revision + 1,
    triggerPatterns: [...new Set([...target.triggerPatterns, ...generated.triggerPatterns])],
    contextPatterns: [...new Set([...target.contextPatterns, ...generated.contextPatterns])],
    anyOfPatterns: [...new Set([...target.anyOfPatterns, ...generated.anyOfPatterns])],
    exclusionPatterns: [...new Set([...(target.exclusionPatterns ?? []), ...(generated.exclusionPatterns ?? [])])],
    regressionTests: [...new Map(
      [...(target.regressionTests ?? []), ...(generated.regressionTests ?? [])]
        .map((regressionCase) => [`${regressionCase.expected}\u0000${regressionCase.input}`, regressionCase]),
    ).values()],
    safeRewrite: [...new Set([...target.safeRewrite, ...generated.safeRewrite])],
    updatedAt: now,
    reviewStatus: "draft",
    notes: [target.notes, `후보 ${generated.id} 병합 제안`].filter(Boolean).join(" · "),
  };
  return validateManagedSkill(merged).length === 0 ? merged : null;
}

export class D1CandidateRepository implements CandidateRepository {
  private readonly db?: D1Database;

  constructor(db?: D1Database) {
    this.db = db;
  }

  async list() {
    if (!this.db) return storageRequired<RepositoryPage<CandidateRecord>>();
    try {
      const items: CandidateRecord[] = [];
      const pageSize = 250;
      let offset = 0;
      while (items.length < pageSize) {
        const response = await this.db.prepare(`
          SELECT id, status, payload, created_at
          FROM riskshield_candidates
          WHERE retention_deadline IS NULL OR retention_deadline > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'held' THEN 1 ELSE 2 END, updated_at DESC
          LIMIT ? OFFSET ?
        `).bind(pageSize, offset).all<CandidateRow>();
        const rows = response.results ?? [];
        for (const row of rows) {
          const record = parsedCandidate(row);
          if (record && visibleInDefaultCandidateInbox(record)) items.push(record);
          if (items.length >= pageSize) break;
        }
        if (rows.length < pageSize) break;
        offset += rows.length;
      }
      return ready({
        items,
        nextCursor: null,
      }, "d1");
    } catch {
      return storageUnavailable<RepositoryPage<CandidateRecord>>();
    }
  }

  async getById(id: string) {
    if (!this.db) return storageRequired<CandidateRecord | null>();
    try {
      const row = await this.db.prepare(
        "SELECT id, status, payload, created_at FROM riskshield_candidates WHERE id = ? AND (retention_deadline IS NULL OR retention_deadline > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) LIMIT 1",
      ).bind(id).first<CandidateRow>();
      return ready(row ? parsedCandidate(row) : null, "d1");
    } catch {
      return storageUnavailable<CandidateRecord | null>();
    }
  }

  async saveGenerated(records: readonly GeneratedCandidateRecordInput[]) {
    if (!this.db) return storageRequired<{ savedIds: readonly string[] }>();
    const now = new Date().toISOString();
    try {
      const statements = records.map((input) => {
        const record: CandidateRecord = {
          ...input,
          status: "pending",
          createdAt: input.createdAt ?? now,
        };
        return this.db!.prepare(`
          INSERT INTO riskshield_candidates (id, status, payload, created_at, updated_at)
          VALUES (?, 'pending', ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            payload = CASE WHEN riskshield_candidates.status IN ('pending', 'held') THEN excluded.payload ELSE riskshield_candidates.payload END,
            updated_at = CASE WHEN riskshield_candidates.status IN ('pending', 'held') THEN excluded.updated_at ELSE riskshield_candidates.updated_at END
        `).bind(record.id, JSON.stringify(record), record.createdAt, now);
      });
      if (statements.length) await this.db.batch(statements);
      return ready<{ savedIds: readonly string[] }>({ savedIds: records.map((record) => record.id) }, "d1");
    } catch {
      return unavailable<{ savedIds: readonly string[] }>("candidate_write_failed", "후보를 D1에 저장하지 못했습니다.");
    }
  }

  async decide(input: CandidateDecisionInput) {
    if (!this.db) return storageRequired<CandidateDecisionAcknowledgement>();
    try {
      const row = await this.db.prepare(
        "SELECT id, status, payload, created_at FROM riskshield_candidates WHERE id = ? LIMIT 1",
      ).bind(input.candidateId).first<CandidateRow>();
      const candidate = row ? parsedCandidate(row) : null;
      if (!candidate) {
        return ready<CandidateDecisionAcknowledgement>({
          decisionId: `missing_${input.candidateId}`,
          candidateStatus: "pending",
          message: "검토할 후보를 찾지 못했습니다.",
          persisted: false,
        }, "d1");
      }
      if (candidate.status !== "pending" && candidate.status !== "held") {
        return ready<CandidateDecisionAcknowledgement>({
          decisionId: `terminal_${input.candidateId}`,
          candidateStatus: candidate.status,
          message: "이미 최종 결정된 후보입니다.",
          persisted: false,
        }, "d1");
      }
      const status = candidateStatus(input.decision);
      const now = new Date().toISOString();
      const decisionId = crypto.randomUUID();
      const skill = input.decision === "approve" || input.decision === "approve_with_edits" || input.decision === "merge"
        ? generatedSkill(candidate, now, input.decision === "approve_with_edits" ? input.editedDraft ?? null : candidate.draft ?? null)
        : null;
      if (["approve", "approve_with_edits", "merge"].includes(input.decision) && !skill) {
        return ready<CandidateDecisionAcknowledgement>({
          decisionId,
          candidateStatus: candidate.status,
          message: "후보 초안이 스킬 검증을 통과하지 못해 승인하지 않았습니다.",
          persisted: false,
        }, "d1");
      }
      let mergeTarget: SkillAdminRecord | null = null;
      let mergePayload: RiskSkill | null = null;
      if (input.decision === "merge") {
        if (!input.mergeSkillId || !skill) {
          return ready<CandidateDecisionAcknowledgement>({
            decisionId,
            candidateStatus: candidate.status,
            message: "병합할 기존 스킬과 유효한 후보 초안이 필요합니다.",
            persisted: false,
          }, "d1");
        }
        const target = await new D1SkillRepository(this.db).getById(input.mergeSkillId);
        if (target.status !== "ready" || !target.data?.skill) {
          return ready<CandidateDecisionAcknowledgement>({
            decisionId,
            candidateStatus: candidate.status,
            message: "병합 대상 스킬을 찾지 못했거나 payload가 유효하지 않습니다.",
            persisted: false,
          }, "d1");
        }
        mergeTarget = target.data;
        mergePayload = mergedSkillProposal(target.data.skill, skill, now);
        if (!mergePayload) {
          return ready<CandidateDecisionAcknowledgement>({
            decisionId,
            candidateStatus: candidate.status,
            message: "병합 결과가 스킬 검증을 통과하지 못했습니다.",
            persisted: false,
          }, "d1");
        }
      }
      const audit = await chainedAuditStatements(this.db, {
        occurredAt: now,
        actorId: input.actorId,
        action: `candidate.${input.decision}`,
        resourceType: "candidate",
        resourceId: input.candidateId,
        result: "succeeded",
        beforeJson: JSON.stringify({ status: candidate.status }),
        afterJson: JSON.stringify({ status }),
        reason: input.note,
      });
      const statements = [
        ...(
          input.decision === "hold"
            ? []
            : [this.db.prepare(`
              INSERT INTO riskshield_candidate_terminal_claims
                (candidate_id, decision_id, actor_id, created_at)
              VALUES (?, ?, ?, ?)
            `).bind(input.candidateId, decisionId, input.actorId, now)]
        ),
        this.db.prepare(`
          INSERT INTO riskshield_candidate_decisions
            (id, candidate_id, decision, note, merge_skill_id, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(decisionId, input.candidateId, input.decision, input.note, input.mergeSkillId, input.actorId, now),
        this.db.prepare(
          "UPDATE riskshield_candidates SET status = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'held')",
        ).bind(status, now, input.candidateId),
        ...audit,
      ];
      if (skill && input.decision !== "merge") {
        statements.push(this.db.prepare(`
          INSERT INTO risk_skills
            (id, category, review_status, severity_floor, dominant_risk, payload, created_at, updated_at)
          VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            category = excluded.category,
            review_status = 'draft',
            severity_floor = excluded.severity_floor,
            dominant_risk = excluded.dominant_risk,
            payload = excluded.payload,
            updated_at = excluded.updated_at
        `).bind(
          skill.id,
          skill.category,
          skill.severityFloor,
          skill.dominantRisk ? 1 : 0,
          JSON.stringify(skill),
          now,
          now,
        ));
      }
      if (mergeTarget && mergePayload) {
        statements.push(this.db.prepare(`
          INSERT INTO riskshield_skill_revisions
            (id, skill_id, base_revision, proposed_revision, summary, rationale, payload, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          mergeTarget.id,
          mergeTarget.revision,
          mergePayload.revision,
          `후보 ${candidate.id} 병합`,
          input.note,
          JSON.stringify(mergePayload),
          input.actorId,
          now,
        ));
      }
      await this.db.batch(statements);
      return ready<CandidateDecisionAcknowledgement>({
        decisionId,
        candidateStatus: status,
        message: status === "approved"
          ? "후보 결정을 기록하고 비활성 draft 스킬을 D1에 저장했습니다. 별도 검증·릴리스 전에는 분석에 사용되지 않습니다."
          : status === "merged"
            ? "기존 스킬을 직접 변경하지 않고 검토 가능한 병합 revision을 저장했습니다."
            : "후보 결정과 감사 이력을 D1에 저장했습니다.",
        persisted: true,
      }, "d1");
    } catch {
      return unavailable<CandidateDecisionAcknowledgement>("candidate_decision_failed", "후보 결정을 D1에 저장하지 못했습니다.");
    }
  }
}

function datasetRecord(row: DatasetRow): DatasetRecord {
  const validStatus = new Set<DatasetRecord["status"]>(["staging", "ready", "invalid", "unavailable"]);
  return {
    id: row.id,
    name: row.name,
    sourceKind: row.source_kind === "csv" ? "csv" : row.source_kind === "connector" ? "connector" : "unknown",
    status: validStatus.has(row.status as DatasetRecord["status"]) ? row.status as DatasetRecord["status"] : "unavailable",
    versionCount: row.version_count,
    latestSha256: row.latest_sha256,
    latestKeywordColumn: row.latest_keyword_column,
    latestObjectKey: row.latest_object_key,
    updatedAt: row.updated_at,
    owner: row.owner,
    license: row.license,
    allowedPurpose: row.allowed_purpose,
    retention: row.retention,
  };
}

const DATASET_SELECT = `
  SELECT d.id, d.name, d.source_kind, d.status, d.owner, d.license,
    d.allowed_purpose, d.retention, d.updated_at,
    COUNT(v.id) AS version_count,
    (SELECT latest.sha256 FROM riskshield_dataset_versions latest
      WHERE latest.dataset_id = d.id ORDER BY latest.version_number DESC LIMIT 1) AS latest_sha256,
    (SELECT latest.keyword_column FROM riskshield_dataset_versions latest
      WHERE latest.dataset_id = d.id ORDER BY latest.version_number DESC LIMIT 1) AS latest_keyword_column
    ,(SELECT latest.object_key FROM riskshield_dataset_versions latest
      WHERE latest.dataset_id = d.id ORDER BY latest.version_number DESC LIMIT 1) AS latest_object_key
  FROM riskshield_datasets d
  LEFT JOIN riskshield_dataset_versions v ON v.dataset_id = d.id
`;

export class D1DatasetRepository implements DatasetRepository {
  private readonly db?: D1Database;

  constructor(db?: D1Database) {
    this.db = db;
  }

  async list() {
    if (!this.db) return storageRequired<RepositoryPage<DatasetRecord>>();
    try {
      const response = await this.db.prepare(`${DATASET_SELECT}
        GROUP BY d.id ORDER BY d.updated_at DESC LIMIT 200
      `).all<DatasetRow>();
      return ready({ items: (response.results ?? []).map(datasetRecord), nextCursor: null }, "d1");
    } catch {
      return storageUnavailable<RepositoryPage<DatasetRecord>>();
    }
  }

  async getById(id: string) {
    if (!this.db) return storageRequired<DatasetRecord | null>();
    try {
      const row = await this.db.prepare(`${DATASET_SELECT}
        WHERE d.id = ? GROUP BY d.id LIMIT 1
      `).bind(id).first<DatasetRow>();
      return ready(row ? datasetRecord(row) : null, "d1");
    } catch {
      return storageUnavailable<DatasetRecord | null>();
    }
  }

  async listVersions(datasetId?: string) {
    if (!this.db) return storageRequired<RepositoryPage<DatasetVersionRecord>>();
    try {
      const response = await this.db.prepare(`
        SELECT id, dataset_id, version_number, sha256, byte_size, row_count, encoding,
          delimiter, headers_json, keyword_column, object_key, created_at
        FROM riskshield_dataset_versions
        WHERE (? IS NULL OR dataset_id = ?)
          AND object_key IS NOT NULL
        ORDER BY created_at DESC, version_number DESC
        LIMIT 500
      `).bind(datasetId ?? null, datasetId ?? null).all<DatasetVersionRow>();
      const items: DatasetVersionRecord[] = [];
      for (const row of response.results ?? []) {
        if (!row.object_key || row.encoding !== "utf-8") continue;
        const headers = JSON.parse(row.headers_json) as unknown;
        if (!Array.isArray(headers) || !headers.every((value) => typeof value === "string")) continue;
        items.push({
          id: row.id,
          datasetId: row.dataset_id,
          versionNumber: row.version_number,
          sha256: row.sha256,
          byteSize: row.byte_size,
          rowCount: row.row_count,
          encoding: "utf-8",
          delimiter: row.delimiter,
          headers,
          keywordColumn: row.keyword_column,
          objectKey: row.object_key,
          createdAt: row.created_at,
        });
      }
      return ready({ items, nextCursor: null }, "d1");
    } catch {
      return storageUnavailable<RepositoryPage<DatasetVersionRecord>>();
    }
  }

  async getVersion(id: string) {
    if (!this.db) return storageRequired<DatasetVersionRecord | null>();
    try {
      const row = await this.db.prepare(`
        SELECT id, dataset_id, version_number, sha256, byte_size, row_count, encoding,
          delimiter, headers_json, keyword_column, object_key, created_at
        FROM riskshield_dataset_versions WHERE id = ? LIMIT 1
      `).bind(id).first<DatasetVersionRow>();
      if (!row || !row.object_key || row.encoding !== "utf-8") return ready(null, "d1");
      const headers = JSON.parse(row.headers_json) as unknown;
      if (!Array.isArray(headers) || !headers.every((value) => typeof value === "string")) {
        return unavailable<DatasetVersionRecord | null>("dataset_version_invalid", "데이터셋 버전 metadata가 올바르지 않습니다.");
      }
      return ready<DatasetVersionRecord | null>({
        id: row.id,
        datasetId: row.dataset_id,
        versionNumber: row.version_number,
        sha256: row.sha256,
        byteSize: row.byte_size,
        rowCount: row.row_count,
        encoding: "utf-8",
        delimiter: row.delimiter,
        headers,
        keywordColumn: row.keyword_column,
        objectKey: row.object_key,
        createdAt: row.created_at,
      }, "d1");
    } catch {
      return storageUnavailable<DatasetVersionRecord | null>();
    }
  }

  async register(input: DatasetRegistrationInput) {
    if (!this.db) return storageRequired<DatasetRegistrationAcknowledgement>();
    const datasetKey = new TextEncoder().encode(
      `${input.owner.trim().toLocaleLowerCase("ko-KR")}\u241f${input.name.trim().toLocaleLowerCase("ko-KR")}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", datasetKey);
    const datasetId = `dataset_${Array.from(
      new Uint8Array(digest),
      (value) => value.toString(16).padStart(2, "0"),
    ).join("").slice(0, 16)}`;
    const now = new Date().toISOString();
    const objectKey = input.objectKey ?? `datasets/sha256/${input.sha256.slice(0, 2)}/${input.sha256}.csv`;
    try {
      const existing = await this.db.prepare(
        "SELECT id, version_number FROM riskshield_dataset_versions WHERE dataset_id = ? AND sha256 = ? LIMIT 1",
      ).bind(datasetId, input.sha256).first<{ id: string; version_number: number }>();
      if (existing) {
        return ready<DatasetRegistrationAcknowledgement>({
          datasetId,
          versionId: existing.id,
          status: "staging",
          message: "동일한 SHA-256 데이터셋 버전이 이미 등록돼 있습니다.",
          persisted: true,
        }, "d1");
      }
      const versionId = `dataset_version_${crypto.randomUUID()}`;
      const audit = await chainedAuditStatements(this.db, {
        occurredAt: now,
        actorId: input.actorId,
        action: "dataset.register",
        resourceType: "dataset_version",
        resourceId: versionId,
        result: "succeeded",
        afterJson: JSON.stringify({ sha256: input.sha256, rowCount: input.rowCount, objectKey }),
        reason: input.allowedPurpose,
      });
      await this.db.batch([
        this.db.prepare(`
          INSERT INTO riskshield_datasets
            (id, name, source_kind, status, owner, license, allowed_purpose, retention, created_at, updated_at)
          VALUES (?, ?, 'csv', 'staging', ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, owner = excluded.owner, license = excluded.license,
            allowed_purpose = excluded.allowed_purpose, retention = excluded.retention,
            updated_at = excluded.updated_at
        `).bind(datasetId, input.name, input.owner, input.license, input.allowedPurpose, input.retention, now, now),
        this.db.prepare(`
          INSERT INTO riskshield_dataset_versions
            (id, dataset_id, version_number, sha256, byte_size, row_count, encoding, delimiter, headers_json, keyword_column, object_key, created_at)
          SELECT ?, ?, COALESCE(MAX(version_number), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM riskshield_dataset_versions WHERE dataset_id = ?
        `).bind(versionId, datasetId, input.sha256, input.byteSize, input.rowCount, input.encoding, input.delimiter, JSON.stringify(input.headers), input.keywordColumn, objectKey, now, datasetId),
        ...audit,
      ]);
      return ready<DatasetRegistrationAcknowledgement>({
        datasetId,
        versionId,
        status: "staging",
        message: "서버가 검증한 원본을 불변 object key로 저장하고 D1 staging 버전에 연결했습니다.",
        persisted: true,
      }, "d1");
    } catch {
      return unavailable<DatasetRegistrationAcknowledgement>("dataset_registration_failed", "데이터셋 버전을 D1에 등록하지 못했습니다.");
    }
  }
}

export class D1TrainingRepository implements TrainingRepository {
  private readonly db?: D1Database;

  constructor(db?: D1Database) {
    this.db = db;
  }

  async listRuns() {
    if (!this.db) return storageRequired<RepositoryPage<TrainingRunRecord>>();
    try {
      const response = await this.db.prepare(`
        SELECT id, dataset_version_id, status, current_stage, item_count, warning_count,
          estimated_cost, latency_ms, updated_at
        FROM riskshield_training_runs ORDER BY updated_at DESC LIMIT 100
      `).all<TrainingRunRow>();
      return ready({ items: (response.results ?? []).map((row) => ({
        id: row.id,
        datasetVersionId: row.dataset_version_id,
        status: row.status as TrainingRunRecord["status"],
        currentStage: row.current_stage,
        itemCount: row.item_count,
        warningCount: row.warning_count,
        estimatedCost: row.estimated_cost,
        latencyMs: row.latency_ms,
        updatedAt: row.updated_at,
      })), nextCursor: null }, "d1");
    } catch {
      return storageUnavailable<RepositoryPage<TrainingRunRecord>>();
    }
  }

  async getRun(id: string) {
    if (!this.db) return storageRequired<TrainingRunRecord | null>();
    try {
      const row = await this.db.prepare(`
        SELECT id, dataset_version_id, status, current_stage, item_count, warning_count,
          estimated_cost, latency_ms, updated_at
        FROM riskshield_training_runs WHERE id = ? LIMIT 1
      `).bind(id).first<TrainingRunRow>();
      return ready(row ? {
        id: row.id,
        datasetVersionId: row.dataset_version_id,
        status: row.status as TrainingRunRecord["status"],
        currentStage: row.current_stage,
        itemCount: row.item_count,
        warningCount: row.warning_count,
        estimatedCost: row.estimated_cost,
        latencyMs: row.latency_ms,
        updatedAt: row.updated_at,
      } : null, "d1");
    } catch {
      return storageUnavailable<TrainingRunRecord | null>();
    }
  }

  async saveRun(record: TrainingRunRecord, actorId: string) {
    if (!this.db) return storageRequired<{ persisted: boolean }>();
    const now = new Date().toISOString();
    try {
      const audit = await chainedAuditStatements(this.db, {
        occurredAt: now,
        actorId,
        action: "training.run.saved",
        resourceType: "training_run",
        resourceId: record.id,
        result: "succeeded",
        afterJson: JSON.stringify({ status: record.status, itemCount: record.itemCount }),
      });
      await this.db.batch([
        this.db.prepare(`
          INSERT INTO riskshield_training_runs
            (id, dataset_version_id, status, current_stage, item_count, warning_count, estimated_cost, latency_ms, payload, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, current_stage = excluded.current_stage,
            item_count = excluded.item_count, warning_count = excluded.warning_count,
            estimated_cost = excluded.estimated_cost, latency_ms = excluded.latency_ms,
            payload = excluded.payload, updated_at = excluded.updated_at
        `).bind(record.id, record.datasetVersionId, record.status, record.currentStage, record.itemCount, record.warningCount, record.estimatedCost, record.latencyMs, JSON.stringify(record), now, now),
        ...audit,
      ]);
      return ready<{ persisted: boolean }>({ persisted: true }, "d1");
    } catch {
      return unavailable<{ persisted: boolean }>("training_run_write_failed", "학습 실행 결과를 D1에 저장하지 못했습니다.");
    }
  }
}

export class D1AuditRepository implements AuditRepository {
  private readonly db?: D1Database;

  constructor(db?: D1Database) {
    this.db = db;
  }

  async list() {
    if (!this.db) return storageRequired<RepositoryPage<AuditRecord>>();
    try {
      const response = await this.db.prepare(`
        SELECT id, occurred_at, actor_id, action, resource_type, resource_id, result
        FROM riskshield_audit_logs ORDER BY occurred_at DESC LIMIT 250
      `).all<{
        id: string;
        occurred_at: string;
        actor_id: string;
        action: string;
        resource_type: string;
        resource_id: string;
        result: AuditRecord["result"];
      }>();
      return ready({
        items: (response.results ?? []).map((row) => ({
          id: row.id,
          occurredAt: row.occurred_at,
          actorId: row.actor_id,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          result: row.result,
        })),
        nextCursor: null,
      }, "d1");
    } catch {
      return storageUnavailable<RepositoryPage<AuditRecord>>();
    }
  }
}

export class D1PrincipalRepository implements PrincipalRepository {
  private readonly db?: D1Database;

  constructor(db?: D1Database) {
    this.db = db;
  }

  async list() {
    if (!this.db) return storageRequired<RepositoryPage<PrincipalRecord>>();
    try {
      const response = await this.db.prepare(`${PRINCIPAL_SELECT}
        ORDER BY u.updated_at DESC, u.id ASC
        LIMIT 200
      `).all<PrincipalRow>();
      return ready({ items: (response.results ?? []).map(principalRecord), nextCursor: null }, "d1");
    } catch {
      return storageUnavailable<RepositoryPage<PrincipalRecord>>();
    }
  }

  async findForGoogleIdentity(identity: { subject: string; email: string }) {
    if (!this.db) return storageRequired<PrincipalRecord | null>();
    try {
      const row = await this.db.prepare(`${PRINCIPAL_SELECT}
        WHERE u.identity_provider = 'google'
          AND u.external_subject = ?
          AND u.status = 'active'
        LIMIT 1
      `).bind(identity.subject).first<PrincipalRow>();
      if (!row || row.normalized_email !== identity.email || !isRole(row.role_name)) {
        return ready(null, "d1");
      }
      return ready(principalRecord(row), "d1");
    } catch {
      return storageUnavailable<PrincipalRecord | null>();
    }
  }

  async resolveSession(session: SessionClaims) {
    if (!this.db) return storageRequired<CurrentPrincipal | null>();
    try {
      const row = await this.db.prepare(`${PRINCIPAL_SELECT}
        WHERE u.id = ?
          AND u.identity_provider = 'google'
          AND u.status = 'active'
        LIMIT 1
      `).bind(session.sub).first<PrincipalRow>();
      if (
        !row ||
        !isRole(row.role_name) ||
        row.role_version !== session.roleVersion ||
        !sessionClearsNotBefore(session.iat, row.session_not_before)
      ) {
        return ready(null, "d1");
      }
      const revoked = await this.db.prepare(
        "SELECT session_id FROM riskshield_session_revocations WHERE session_id = ? AND expires_at > ? LIMIT 1",
      ).bind(session.sid, new Date().toISOString()).first<{ session_id: string }>();
      if (revoked) return ready(null, "d1");
      const principal: CurrentPrincipal = {
        userId: row.user_id,
        externalSubject: row.external_subject,
        normalizedEmail: row.normalized_email,
        identityIssuer: "https://accounts.google.com",
        authSource: "google_oidc",
        role: row.role_name as Role,
        roleVersion: row.role_version,
        capabilities: capabilitiesFrom(row.capabilities),
        sessionId: session.sid,
        csrfToken: session.csrf,
      };
      return ready(principal, "d1");
    } catch {
      return storageUnavailable<CurrentPrincipal | null>();
    }
  }
}
