import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject, repositoryFailure } from "../../../../../lib/http/control-response";
import { createRepositoryServices } from "../../../../../lib/repositories";
import type { CandidateDecisionInput } from "../../../../../lib/repositories/contracts";

const DECISIONS = new Set<CandidateDecisionInput["decision"]>([
  "approve",
  "hold",
  "reject",
]);

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
  if (!candidateId || !decision || (decision !== "approve" && !note)) {
    return controlJson({ error: "invalid_candidate_decision", message: "후보, 결정, 필수 근거를 확인해 주세요." }, 400);
  }
  const repositories = await createRepositoryServices({ request });
  const result = await repositories.candidates.decide({
    candidateId,
    decision,
    note,
    mergeSkillId: null,
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
