import type { CandidateRecord } from "../repositories/contracts";
import { D1SkillRepository } from "../repositories/d1";
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
import { GoogleCollectorQualificationProvider } from "../collectors/google-qualification-provider.ts";
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
import { GoogleCollectorSearchVerificationProvider } from "../collectors/google-search-verification-provider.ts";
import type { ScorableRiskFamily } from "../risk-family";
import {
  analyzeText,
  RISK_SKILL_SCHEMA_VERSION,
  validateManagedSkill,
  type RiskSkill,
} from "../riskshield";
import { runSkillActivationRegression } from "../skill-activation";
import {
  expressionAppearsInContext,
  PUBLIC_FEEDBACK_GATE_VERSION,
  verifiedContextTests,
  verifyPublicFeedbackExpression,
  type PublicFeedbackVerificationProviders,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./intake.ts";
import { retryPublicFeedbackRows, type PublicFeedbackRetryResult } from "./retry";

type PublicFeedbackEnvironment = {
  DB: D1Database;
  RISKSHIELD_INTERPRETER_API_KEY?: string;
};

type DueIntake = {
  id: string;
  expression: string;
  report_type: "missed_detection" | "new_expression";
  contexts_json: string;
  reporter_fingerprints_json: string;
  submission_count: number;
  retention_deadline: string;
};

function jsonStrings(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function familyOf(value: string): ScorableRiskFamily {
  return value === "hate_discrimination" || value === "abusive_language" || value === "coded_expression" || value === "violent_threat"
    ? value : "general_substantiation";
}

function domainOf(value: string) {
  return value === "hate_discrimination" ? "혐오·차별 표현"
    : value === "abusive_language" ? "욕설·공격 표현"
      : value === "coded_expression" ? "숨은 은어·코드 표현"
        : value === "violent_threat" ? "폭력·위협 표현" : "과장·기만 표현";
}

function severityOf(value: string) {
  return value === "violent_threat" ? 80 : value === "hate_discrimination" ? 75
    : value === "abusive_language" ? 68 : value === "coded_expression" ? 65 : 60;
}

const AUTO_RULE_MIN_CONFIDENCE = 0.95;
const AUTO_RULE_ROLES = new Set(["harmful_expression", "coded_expression"]);

function independentSearchDomainCount(
  sources: readonly { uri: string }[],
) {
  return new Set(sources.flatMap((source) => {
    try {
      return [new URL(source.uri).hostname.toLocaleLowerCase("en-US").replace(/^www\./u, "")];
    } catch {
      return [];
    }
  })).size;
}

function canAutoActivateRule(
  verification: Extract<Awaited<ReturnType<typeof verifyPublicFeedbackExpression>>, { status: "promoted" }>,
  positiveTestCount: number,
  distinctReporterCount: number,
) {
  const hasIndependentSupport = distinctReporterCount >= 2
    || independentSearchDomainCount(verification.searchVerification.sources) >= 3;
  return verification.qualification.disposition === "review"
    && AUTO_RULE_ROLES.has(verification.qualification.role)
    && verification.qualification.confidence >= AUTO_RULE_MIN_CONFIDENCE
    && verification.searchVerification.decision === "send_to_review"
    && AUTO_RULE_ROLES.has(verification.searchVerification.role)
    && verification.searchVerification.confidence >= AUTO_RULE_MIN_CONFIDENCE
    && verification.searchVerification.directUseSupported
    && hasIndependentSupport
    && positiveTestCount > 0;
}

function autoVerifiedSkill(
  row: DueIntake,
  verification: Extract<Awaited<ReturnType<typeof verifyPublicFeedbackExpression>>, { status: "promoted" }>,
  positiveTests: string[],
  negativeTests: string[],
  now: string,
): RiskSkill {
  const family = familyOf(verification.searchVerification.riskFamily);
  const source = verification.searchVerification.sources[0];
  const skillId = row.id.replace(/^public_intake_/u, "risk_auto_verified_");
  return {
    schemaVersion: RISK_SKILL_SCHEMA_VERSION,
    revision: 1,
    id: skillId,
    category: domainOf(verification.searchVerification.riskFamily),
    subcategory: `${row.expression} 자동 검증 표현`,
    patternType: "auto_verified_atomic_lexeme",
    matchMode: "atomic_lexeme",
    triggerPatterns: [row.expression],
    contextPatterns: [],
    anyOfPatterns: [],
    exclusionPatterns: ["인용", "비판", "표현을 쓰지 마세요", "사용하지 마세요", "뜻을 설명"],
    regressionTests: [
      ...positiveTests.map((input, index) => ({
        id: `${skillId}:positive:${index + 1}`,
        input,
        expected: "match" as const,
        contextSlice: "자동 검증에서 확인된 직접 유해 사용",
      })),
      ...negativeTests.map((input, index) => ({
        id: `${skillId}:negative:${index + 1}`,
        input,
        expected: "no_match" as const,
        contextSlice: "자동 검증에서 확인된 인용·경고·설명 문맥",
      })),
    ],
    conditionScope: "sentence",
    maxDistance: 96,
    surfaceMeaning: verification.searchVerification.meaning ?? row.expression,
    riskSummary: verification.reason,
    socialContext: "사용자 누락 신고와 검색 근거에서 직접 유해 사용이 교차 확인된 표현입니다.",
    legalOrEthicIssue: "직접 비하·모욕 또는 숨은 혐오 표현으로 사용될 수 있습니다.",
    riskReason: verification.reason,
    severityFloor: severityOf(verification.searchVerification.riskFamily),
    dominantRisk: false,
    confidence: Math.min(verification.qualification.confidence, verification.searchVerification.confidence),
    riskFamily: family,
    riskDomain: domainOf(verification.searchVerification.riskFamily),
    recentContextTags: ["public_feedback", "auto_verified", "human_review_pending", verification.searchVerification.role],
    safeRewrite: ["비하·공격 표현 대신 대상과 상황을 사실 중심으로 구체적으로 설명해 주세요."],
    falsePositiveNote: "인용·비판·교육·사용 금지 문맥은 별도로 억제합니다.",
    notes: `공개 누락 신고 ${row.id}가 고신뢰 자동 검증 기준을 통과해 활성화되었습니다.`,
    source: {
      title: source?.title ?? "RiskShield 검색 검증",
      url: source?.uri ?? "",
      date: now.slice(0, 10),
      sourceId: row.id,
      provenanceStatus: "verified",
    },
    createdAt: now,
    updatedAt: now,
    reviewStatus: "reviewed",
  };
}

async function autoActivationStatements(db: D1Database, skill: RiskSkill, now: string) {
  const previous = await db.prepare(
    "SELECT entry_hash FROM riskshield_audit_chain ORDER BY sequence DESC LIMIT 1",
  ).first<{ entry_hash: string }>();
  const previousHash = previous?.entry_hash ?? "GENESIS";
  const auditId = crypto.randomUUID();
  const actorId = "system:public-feedback-auto-verification";
  const reason = "LLM·검색 고신뢰 검증과 회귀 검사를 통과한 명백한 원자 유해 표현 자동 활성화";
  const afterJson = JSON.stringify(skill);
  const canonical = JSON.stringify([
    previousHash, auditId, now, actorId, "skill.auto_activated", "skill", skill.id,
    "succeeded", null, afterJson, reason,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const entryHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    db.prepare(`INSERT INTO risk_skills
      (id, category, review_status, severity_floor, dominant_risk, payload, created_at, updated_at)
      VALUES (?, ?, 'reviewed', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`)
      .bind(skill.id, skill.category, skill.severityFloor, skill.dominantRisk ? 1 : 0, afterJson, now, now),
    db.prepare(`INSERT INTO riskshield_audit_logs
      (id, occurred_at, actor_id, action, resource_type, resource_id, result, before_json, after_json, reason)
      VALUES (?, ?, ?, 'skill.auto_activated', 'skill', ?, 'succeeded', NULL, ?, ?)`)
      .bind(auditId, now, actorId, skill.id, afterJson, reason),
    db.prepare(`INSERT INTO riskshield_audit_chain (audit_id, previous_hash, entry_hash, created_at)
      VALUES (?, ?, ?, ?)`)
      .bind(auditId, previousHash, entryHash, now),
  ];
}

async function savePromotedCandidate(db: D1Database, row: DueIntake, verification: Extract<Awaited<ReturnType<typeof verifyPublicFeedbackExpression>>, { status: "promoted" }>, now: string) {
  const contexts = jsonStrings(row.contexts_json).filter((context) => expressionAppearsInContext(row.expression, context)).slice(-5);
  const reporters = [...new Set(jsonStrings(row.reporter_fingerprints_json))];
  const tests = verifiedContextTests(contexts, verification.qualification);
  const family = familyOf(verification.searchVerification.riskFamily);
  const domain = domainOf(verification.searchVerification.riskFamily);
  const candidateId = row.id.replace(/^public_intake_/u, "public_verified_");
  const activeSkillsResult = await new D1SkillRepository(db).listReviewed();
  const expressionAlreadyActive = activeSkillsResult.status === "ready"
    && analyzeText(row.expression, [...activeSkillsResult.data]).matches.length > 0;
  const proposedAutoSkill = canAutoActivateRule(verification, tests.positiveTests.length, reporters.length)
    && activeSkillsResult.status === "ready"
    && !expressionAlreadyActive
    ? autoVerifiedSkill(row, verification, tests.positiveTests, tests.negativeTests, now)
    : null;
  const autoSkill = proposedAutoSkill
    && validateManagedSkill(proposedAutoSkill).length === 0
    && runSkillActivationRegression(proposedAutoSkill, activeSkillsResult.status === "ready" ? activeSkillsResult.data : []).passed
    ? proposedAutoSkill
    : null;
  const payload: CandidateRecord & { retentionDeadline: string; submissionCount: number } = {
    id: candidateId,
    expression: row.expression,
    riskFamily: family,
    riskDomain: domain,
    reportType: row.report_type,
    origin: { type: "user_feedback", reportType: row.report_type },
    qualityGateVersion: PUBLIC_FEEDBACK_GATE_VERSION,
    qualification: {
      disposition: verification.qualification.disposition,
      role: verification.qualification.role,
      riskFamily: family,
      confidence: verification.qualification.confidence,
      reason: verification.qualification.reason,
      directUseCount: tests.positiveTests.length,
      contextualUseCount: tests.negativeTests.length,
      distinctAuthorCount: reporters.length,
      distinctPlatformCount: 1,
      observationCount: row.submission_count,
    },
    searchVerification: { ...verification.searchVerification, riskFamily: family, verifiedAt: now },
    status: autoSkill ? "approved" : "pending",
    noveltyScore: null,
    confidence: Math.min(verification.qualification.confidence, verification.searchVerification.confidence),
    sourceCount: row.submission_count,
    createdAt: now,
    expressionGroup: [row.expression],
    contextSummary: verification.reason,
    evidence: contexts,
    positiveTests: tests.positiveTests,
    negativeTests: tests.negativeTests,
    draft: {
      title: `${row.expression} 표현 검토`, riskSummary: verification.reason, riskFamily: family, riskDomain: domain,
      matchMode: "atomic_lexeme", triggerPatterns: [row.expression], contextPatterns: [],
      exclusionPatterns: ["인용", "비판", "표현을 쓰지 마세요", "사용하지 마세요"],
      severityFloor: severityOf(verification.searchVerification.riskFamily),
      safeRewrite: ["비하·공격·기만 표현 대신 대상과 상황을 사실 중심으로 구체적으로 설명해 주세요."],
    },
    lineage: null,
    sources: verification.searchVerification.sources.map((source) => ({ title: source.title, url: source.uri, date: now.slice(0, 10) })),
    autoInclusionBlockedReason: autoSkill ? "" : "고신뢰 자동 활성화 기준을 모두 통과하지 않아 사람 검토가 필요합니다.",
    retentionDeadline: row.retention_deadline,
    submissionCount: row.submission_count,
  };
  const automaticStatements = autoSkill ? await autoActivationStatements(db, autoSkill, now) : [];
  await db.batch([
    db.prepare(`INSERT INTO riskshield_candidates (id, status, payload, retention_deadline, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, retention_deadline = excluded.retention_deadline,
        status = CASE WHEN riskshield_candidates.status = 'held' THEN 'pending' ELSE riskshield_candidates.status END,
        updated_at = excluded.updated_at`)
      .bind(candidateId, autoSkill ? "approved" : "pending", JSON.stringify(payload), row.retention_deadline, now, now),
    db.prepare(`UPDATE riskshield_public_feedback_intakes SET status = 'promoted', qualification_json = ?,
      search_verification_json = ?, candidate_id = ?, last_error = NULL, next_check_at = NULL, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(verification.qualification), JSON.stringify(verification.searchVerification), candidateId, now, row.id),
    ...automaticStatements,
  ]);
}

export async function runDuePublicFeedbackIntakes(
  env: PublicFeedbackEnvironment,
  overrides?: PublicFeedbackVerificationProviders,
): Promise<PublicFeedbackRetryResult> {
  const now = new Date().toISOString();
  const staleVerificationBefore = new Date(Date.parse(now) - 10 * 60_000).toISOString();
  const due = await env.DB.prepare(`SELECT id, expression, report_type, contexts_json, reporter_fingerprints_json,
    submission_count, retention_deadline FROM riskshield_public_feedback_intakes
    WHERE report_type IN ('missed_detection', 'new_expression')
      AND ((status IN ('received', 'monitor', 'verification_error')
        AND (next_check_at IS NULL OR next_check_at <= ?))
        OR (status = 'verifying' AND updated_at <= ?))
    ORDER BY CASE WHEN status = 'received' THEN 0 ELSE 1 END ASC,
      CASE WHEN status = 'received' THEN updated_at END DESC,
      updated_at ASC LIMIT 3`).bind(now, staleVerificationBefore).all<DueIntake>();
  const qualification = new GoogleCollectorQualificationProvider(env.RISKSHIELD_INTERPRETER_API_KEY ?? "");
  const search = new GoogleCollectorSearchVerificationProvider(env.RISKSHIELD_INTERPRETER_API_KEY ?? "");
  const providers = overrides ?? {
    qualify: qualification.qualify.bind(qualification),
    verify: search.verify.bind(search),
  };
  return retryPublicFeedbackRows(due.results ?? [], async (row) => {
    const contexts = jsonStrings(row.contexts_json).filter((context) => expressionAppearsInContext(row.expression, context)).slice(-5);
    if (!contexts.length) {
      await env.DB.prepare("UPDATE riskshield_public_feedback_intakes SET status = 'rejected', last_error = 'expression_not_found_in_context', next_check_at = NULL, updated_at = ? WHERE id = ?").bind(now, row.id).run();
      return "rejected";
    }
    try {
      await env.DB.prepare("UPDATE riskshield_public_feedback_intakes SET status = 'verifying', last_error = NULL, updated_at = ? WHERE id = ?").bind(now, row.id).run();
      const verification = await verifyPublicFeedbackExpression({ expression: row.expression, contexts }, providers, AbortSignal.timeout(120_000));
      if (verification.status === "promoted") {
        await savePromotedCandidate(env.DB, row, verification, now);
        return "promoted";
      }
      const days = verification.status === "rejected" ? 30 : 3;
      const nextCheckAt = new Date(Date.parse(now) + days * 86_400_000).toISOString();
      await env.DB.prepare(`UPDATE riskshield_public_feedback_intakes SET status = ?, qualification_json = ?,
        search_verification_json = ?, last_error = NULL, next_check_at = ?, updated_at = ? WHERE id = ?`)
        .bind(verification.status, verification.qualification ? JSON.stringify(verification.qualification) : null,
          verification.searchVerification ? JSON.stringify(verification.searchVerification) : null, nextCheckAt, now, row.id).run();
      return verification.status;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "verification_unavailable";
      const nextCheckAt = new Date(Date.parse(now) + 6 * 60 * 60_000).toISOString();
      await env.DB.prepare(`UPDATE riskshield_public_feedback_intakes SET status = 'verification_error', last_error = ?,
        next_check_at = ?, updated_at = ? WHERE id = ?`).bind(code, nextCheckAt, now, row.id).run();
      throw error;
    }
  });
}
