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
  analyzeText,
  parseSeverityRules,
  validateSkill,
  type ReviewStatus,
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../riskshield.ts";
import {
  configurationRequired,
  ready,
  unavailable,
  type AnalyzerService,
  type PrincipalRecord,
  type PrincipalRepository,
  type RepositoryPage,
  type RepositoryResult,
  type SkillAdminRecord,
  type SkillRepository,
  type SkillRevisionAcknowledgement,
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
        "SELECT payload FROM risk_skills WHERE review_status = 'reviewed' ORDER BY updated_at DESC",
      ).all<{ payload: string }>();
      const skills = (rows.results ?? []).flatMap((row) => {
        const parsed = parseSkill(row.payload).skill;
        return parsed?.reviewStatus === "reviewed" ? [parsed] : [];
      });
      return ready(skills, "d1");
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

  async proposeRevision() {
    return configurationRequired<SkillRevisionAcknowledgement>(
      "skill_revision_configuration_required",
      "스킬 revision 쓰기 저장소와 감사 계약이 필요합니다.",
      ["skill_revisions migration", "audit_logs migration"],
    );
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
