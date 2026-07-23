import type { CandidateRecord } from "../repositories/contracts";
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
import { GoogleCollectorQualificationProvider } from "../collectors/google-qualification-provider.ts";
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
import { GoogleCollectorSearchVerificationProvider } from "../collectors/google-search-verification-provider.ts";
import type { ScorableRiskFamily } from "../risk-family";
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

async function savePromotedCandidate(db: D1Database, row: DueIntake, verification: Extract<Awaited<ReturnType<typeof verifyPublicFeedbackExpression>>, { status: "promoted" }>, now: string) {
  const contexts = jsonStrings(row.contexts_json).filter((context) => expressionAppearsInContext(row.expression, context)).slice(-5);
  const reporters = jsonStrings(row.reporter_fingerprints_json);
  const tests = verifiedContextTests(contexts, verification.qualification);
  const family = familyOf(verification.searchVerification.riskFamily);
  const domain = domainOf(verification.searchVerification.riskFamily);
  const candidateId = row.id.replace(/^public_intake_/u, "public_verified_");
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
    status: "pending",
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
    autoInclusionBlockedReason: "의미·검색 검증을 통과했지만 사람 검토와 회귀 테스트 전에는 활성화하지 않습니다.",
    retentionDeadline: row.retention_deadline,
    submissionCount: row.submission_count,
  };
  await db.batch([
    db.prepare(`INSERT INTO riskshield_candidates (id, status, payload, retention_deadline, created_at, updated_at)
      VALUES (?, 'pending', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, retention_deadline = excluded.retention_deadline,
        status = CASE WHEN riskshield_candidates.status = 'held' THEN 'pending' ELSE riskshield_candidates.status END,
        updated_at = excluded.updated_at`)
      .bind(candidateId, JSON.stringify(payload), row.retention_deadline, now, now),
    db.prepare(`UPDATE riskshield_public_feedback_intakes SET status = 'promoted', qualification_json = ?,
      search_verification_json = ?, candidate_id = ?, last_error = NULL, next_check_at = NULL, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(verification.qualification), JSON.stringify(verification.searchVerification), candidateId, now, row.id),
  ]);
}

export async function runDuePublicFeedbackIntakes(
  env: PublicFeedbackEnvironment,
  overrides?: PublicFeedbackVerificationProviders,
): Promise<PublicFeedbackRetryResult> {
  const now = new Date().toISOString();
  const due = await env.DB.prepare(`SELECT id, expression, report_type, contexts_json, reporter_fingerprints_json,
    submission_count, retention_deadline FROM riskshield_public_feedback_intakes
    WHERE report_type IN ('missed_detection', 'new_expression')
      AND status IN ('received', 'monitor', 'verification_error')
      AND (next_check_at IS NULL OR next_check_at <= ?)
    ORDER BY CASE WHEN status = 'received' THEN 0 ELSE 1 END ASC,
      CASE WHEN status = 'received' THEN updated_at END DESC,
      updated_at ASC LIMIT 3`).bind(now).all<DueIntake>();
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
