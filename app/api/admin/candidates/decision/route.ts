import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject, repositoryFailure } from "../../../../../lib/http/control-response";
import { createRepositoryServices } from "../../../../../lib/repositories";
import type { CandidateDecisionInput } from "../../../../../lib/repositories/contracts";
import { RISK_FAMILIES } from "../../../../../lib/risk-family";

const DECISIONS = new Set<CandidateDecisionInput["decision"]>([
  "approve",
  "approve_with_edits",
  "merge",
  "hold",
  "reject",
]);

function strings(value: unknown, maxItems = 64, maxLength = 320) {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result = value.map((item) => typeof item === "string" ? item.trim() : "");
  return result.every((item) => item && item.length <= maxLength) ? result : null;
}

export async function POST(request: Request) {
  const denied = await requireApiCapability(request, "candidate:decide");
  if (denied) return denied;
  const integrityFailure = await requireMutationIntegrity(request);
  if (integrityFailure) return integrityFailure;
  const principal = await principalFromRequest(request);
  if (!principal) return controlJson({ error: "authentication_required" }, 401);
  const body = await readJsonObject(request);
  if (body === JSON_BODY_TOO_LARGE) return controlJson({ error: "request_payload_too_large" }, 413);
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId.trim() : "";
  const decision = typeof body?.decision === "string" && DECISIONS.has(body.decision as CandidateDecisionInput["decision"])
    ? body.decision as CandidateDecisionInput["decision"]
    : null;
  const note = typeof body?.note === "string" ? body.note.trim() : null;
  const mergeSkillId = typeof body?.mergeSkillId === "string" && body.mergeSkillId.trim()
    ? body.mergeSkillId.trim().slice(0, 200)
    : null;
  const draftValue = typeof body?.editedDraft === "object" && body.editedDraft !== null && !Array.isArray(body.editedDraft)
    ? body.editedDraft as Record<string, unknown>
    : null;
  const editedDraft = draftValue ? {
    title: typeof draftValue.title === "string" ? draftValue.title.trim().slice(0, 200) : "",
    riskSummary: typeof draftValue.riskSummary === "string" ? draftValue.riskSummary.trim().slice(0, 1_000) : "",
    riskFamily: typeof draftValue.riskFamily === "string" && draftValue.riskFamily !== "none" && (RISK_FAMILIES as readonly string[]).includes(draftValue.riskFamily) ? draftValue.riskFamily as NonNullable<CandidateDecisionInput["editedDraft"]>["riskFamily"] : undefined,
    riskDomain: typeof draftValue.riskDomain === "string" ? draftValue.riskDomain.trim().slice(0, 200) : "",
    matchMode: draftValue.matchMode === "atomic_lexeme" ? "atomic_lexeme" as const : "trigger_and_context" as const,
    triggerPatterns: strings(draftValue.triggerPatterns),
    contextPatterns: strings(draftValue.contextPatterns),
    exclusionPatterns: strings(draftValue.exclusionPatterns ?? []),
    severityFloor: typeof draftValue.severityFloor === "number" && Number.isFinite(draftValue.severityFloor) ? Math.min(100, Math.max(1, Math.round(draftValue.severityFloor))) : 60,
    safeRewrite: strings(draftValue.safeRewrite, 16, 1_000),
  } : null;
  const validEditedDraft = editedDraft
    && editedDraft.title
    && editedDraft.riskSummary
    && editedDraft.riskFamily
    && editedDraft.riskDomain
    && editedDraft.triggerPatterns
    && editedDraft.contextPatterns
    && (editedDraft.matchMode === "atomic_lexeme" || editedDraft.contextPatterns.length > 0)
    && editedDraft.exclusionPatterns
    && editedDraft.safeRewrite
      ? editedDraft as NonNullable<CandidateDecisionInput["editedDraft"]>
      : null;
  if (
    !candidateId
    || !decision
    || (decision !== "approve" && !note)
    || (decision === "merge" && !mergeSkillId)
    || (decision === "approve_with_edits" && !validEditedDraft)
  ) {
    return controlJson({ error: "invalid_candidate_decision", message: "후보, 결정, 필수 근거를 확인해 주세요." }, 400);
  }
  const repositories = await createRepositoryServices({ request });
  const result = await repositories.candidates.decide({
    candidateId,
    decision,
    note,
    mergeSkillId,
    editedDraft: validEditedDraft ?? undefined,
    actorId: principal.userId,
  });
  if (result.status !== "ready") return repositoryFailure(result);
  if (!result.data.persisted) {
    return controlJson({ error: "candidate_decision_not_persisted", message: result.data.message }, 409);
  }
  return controlJson({
    acknowledged: true,
    decisionId: result.data.decisionId,
    candidateStatus: result.data.candidateStatus,
    message: result.data.message,
  });
}
