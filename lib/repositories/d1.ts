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
  validateSkill,
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

function reviewStatus(value: string): ReviewStatus | "invalid" {
  return value === "draft" || value === "reviewed" || value === "rejected" ? value : "invalid";
}

function parseSkill(value: string) {
  try {
    const parsed = JSON.parse(value) as RiskSkill;
    const validationIssues = validateSkill(parsed);
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
      const now = new Date().toISOString();
      const revisionId = crypto.randomUUID();
      await this.db.batch([
        this.db.prepare(`
          INSERT INTO riskshield_skill_revisions
            (id, skill_id, base_revision, proposed_revision, summary, rationale, payload, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(revisionId, input.skillId, input.baseRevision, input.baseRevision + 1, input.summary, input.rationale, JSON.stringify(input.proposedPayload), input.actorId, now),
        this.db.prepare(`
          INSERT INTO riskshield_audit_logs
            (id, occurred_at, actor_id, action, resource_type, resource_id, result, after_json, reason)
          VALUES (?, ?, ?, 'skill.revision.proposed', 'skill_revision', ?, 'succeeded', ?, ?)
        `).bind(crypto.randomUUID(), now, input.actorId, revisionId, JSON.stringify({ skillId: input.skillId, proposedRevision: input.baseRevision + 1 }), input.rationale),
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

function candidateStatus(decision: CandidateDecisionInput["decision"]): CandidateRecord["status"] {
  if (decision === "hold") return "held";
  if (decision === "reject") return "rejected";
  if (decision === "merge") return "merged";
  return "approved";
}

function generatedSkill(candidate: CandidateRecord, now: string): RiskSkill | null {
  if (!candidate.draft) return null;
  const source = candidate.sources?.[0];
  const sourceId = candidate.lineage?.datasetVersionId ?? candidate.id;
  const skill: RiskSkill = {
    schemaVersion: RISK_SKILL_SCHEMA_VERSION,
    revision: 1,
    id: candidate.id.startsWith("risk_") ? candidate.id : `risk_generated_${candidate.id.replace(/[^a-zA-Z0-9_-]+/gu, "_")}`,
    category: candidate.riskDomain || "미분류 광고 위험",
    subcategory: candidate.draft.title,
    patternType: "generated_candidate_review",
    triggerPatterns: [...new Set(candidate.draft.triggerPatterns.map((value) => value.trim()).filter(Boolean))],
    contextPatterns: [...new Set(candidate.draft.contextPatterns.map((value) => value.trim()).filter(Boolean))],
    anyOfPatterns: [],
    exclusionPatterns: [],
    conditionScope: "sentence",
    maxDistance: 96,
    surfaceMeaning: candidate.expression,
    riskSummary: candidate.draft.riskSummary,
    socialContext: candidate.contextSummary ?? "등록된 데이터셋에서 발견된 표현군을 사람이 검토했습니다.",
    legalOrEthicIssue: candidate.draft.riskSummary,
    riskReason: candidate.draft.riskSummary,
    severityFloor: candidate.confidence !== null && candidate.confidence >= 0.85 ? 80 : 60,
    dominantRisk: candidate.confidence !== null && candidate.confidence >= 0.85,
    confidence: candidate.confidence ?? 0.6,
    riskDomain: candidate.riskDomain || "미분류 광고 위험",
    recentContextTags: ["dataset", "human_reviewed"],
    safeRewrite: [...new Set(candidate.draft.safeRewrite.map((value) => value.trim()).filter(Boolean))],
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
    reviewStatus: "reviewed",
  };
  return validateSkill(skill).length === 0 ? skill : null;
}

export class D1CandidateRepository implements CandidateRepository {
  private readonly db?: D1Database;

  constructor(db?: D1Database) {
    this.db = db;
  }

  async list() {
    if (!this.db) return storageRequired<RepositoryPage<CandidateRecord>>();
    try {
      const response = await this.db.prepare(`
        SELECT id, status, payload, created_at
        FROM riskshield_candidates
        ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'held' THEN 1 ELSE 2 END, updated_at DESC
        LIMIT 250
      `).all<CandidateRow>();
      return ready({
        items: (response.results ?? []).flatMap((row) => {
          const record = parsedCandidate(row);
          return record ? [record] : [];
        }),
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
        "SELECT id, status, payload, created_at FROM riskshield_candidates WHERE id = ? LIMIT 1",
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
      const statements = [
        this.db.prepare(
          "UPDATE riskshield_candidates SET status = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'held')",
        ).bind(status, now, input.candidateId),
        this.db.prepare(`
          INSERT INTO riskshield_candidate_decisions
            (id, candidate_id, decision, note, merge_skill_id, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(decisionId, input.candidateId, input.decision, input.note, input.mergeSkillId, input.actorId, now),
        this.db.prepare(`
          INSERT INTO riskshield_audit_logs
            (id, occurred_at, actor_id, action, resource_type, resource_id, result, before_json, after_json, reason)
          VALUES (?, ?, ?, ?, 'candidate', ?, 'succeeded', ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          now,
          input.actorId,
          `candidate.${input.decision}`,
          input.candidateId,
          JSON.stringify({ status: candidate.status }),
          JSON.stringify({ status }),
          input.note,
        ),
      ];
      if (input.decision === "approve" || input.decision === "approve_with_edits") {
        const skill = generatedSkill(candidate, now);
        if (!skill) {
          return ready<CandidateDecisionAcknowledgement>({
            decisionId,
            candidateStatus: candidate.status,
            message: "검증 가능한 Gemma draft와 출처가 없어 승인할 수 없습니다.",
            persisted: false,
          }, "d1");
        }
        statements.push(this.db.prepare(`
          INSERT INTO risk_skills
            (id, category, review_status, severity_floor, dominant_risk, payload, created_at, updated_at)
          VALUES (?, ?, 'reviewed', ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            category = excluded.category,
            review_status = 'reviewed',
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
      await this.db.batch(statements);
      return ready<CandidateDecisionAcknowledgement>({
        decisionId,
        candidateStatus: status,
        message: status === "approved"
          ? "후보 결정과 reviewed 스킬을 D1에 저장했습니다."
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
      WHERE latest.dataset_id = d.id ORDER BY latest.version_number DESC LIMIT 1) AS latest_sha256
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
      const count = await this.db.prepare(
        "SELECT COUNT(*) AS count FROM riskshield_dataset_versions WHERE dataset_id = ?",
      ).bind(datasetId).first<{ count: number }>();
      const version = Number(count?.count ?? 0) + 1;
      const versionId = `${datasetId}_v${version}`;
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
            (id, dataset_id, version_number, sha256, byte_size, row_count, encoding, delimiter, headers_json, keyword_column, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(versionId, datasetId, version, input.sha256, input.byteSize, input.rowCount, input.encoding, input.delimiter, JSON.stringify(input.headers), input.keywordColumn, now),
        this.db.prepare(`
          INSERT INTO riskshield_audit_logs
            (id, occurred_at, actor_id, action, resource_type, resource_id, result, after_json, reason)
          VALUES (?, ?, ?, 'dataset.register', 'dataset_version', ?, 'succeeded', ?, ?)
        `).bind(crypto.randomUUID(), now, input.actorId, versionId, JSON.stringify({ sha256: input.sha256, rowCount: input.rowCount }), input.allowedPurpose),
      ]);
      return ready<DatasetRegistrationAcknowledgement>({
        datasetId,
        versionId,
        status: "staging",
        message: "검증 결과와 provenance를 D1 staging 버전으로 등록했습니다.",
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
    const result = await this.listRuns();
    if (result.status !== "ready") return result;
    return ready(result.data.items.find((run) => run.id === id) ?? null, "d1");
  }

  async saveRun(record: TrainingRunRecord, actorId: string) {
    if (!this.db) return storageRequired<{ persisted: boolean }>();
    const now = new Date().toISOString();
    try {
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
        this.db.prepare(`
          INSERT INTO riskshield_audit_logs
            (id, occurred_at, actor_id, action, resource_type, resource_id, result, after_json)
          VALUES (?, ?, ?, 'training.run.saved', 'training_run', ?, 'succeeded', ?)
        `).bind(crypto.randomUUID(), now, actorId, record.id, JSON.stringify({ status: record.status, itemCount: record.itemCount })),
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
