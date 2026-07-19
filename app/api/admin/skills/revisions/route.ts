import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject, repositoryFailure } from "../../../../../lib/http/control-response";
import { createRepositoryServices } from "../../../../../lib/repositories";

export async function POST(request: Request) {
  const denied = await requireApiCapability(request, "skill:propose_revision");
  if (denied) return denied;
  const integrityFailure = await requireMutationIntegrity(request);
  if (integrityFailure) return integrityFailure;
  const principal = await principalFromRequest(request);
  if (!principal) return controlJson({ error: "authentication_required" }, 401);
  const body = await readJsonObject(request);
  if (body === JSON_BODY_TOO_LARGE) return controlJson({ error: "request_payload_too_large" }, 413);
  const skillId = typeof body?.skillId === "string" ? body.skillId.trim() : "";
  const baseRevision = typeof body?.baseRevision === "number" && Number.isInteger(body.baseRevision)
    ? body.baseRevision
    : -1;
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  const rationale = typeof body?.rationale === "string" ? body.rationale.trim() : "";
  const proposedPayload = typeof body?.proposedPayload === "object" && body.proposedPayload !== null && !Array.isArray(body.proposedPayload)
    ? body.proposedPayload as Record<string, unknown>
    : null;
  if (!skillId || baseRevision < 0 || !summary || !rationale || !proposedPayload) {
    return controlJson({ error: "invalid_skill_revision", message: "기준 revision, 변경 요약, 근거와 payload가 필요합니다." }, 400);
  }
  const repositories = await createRepositoryServices({ request });
  const result = await repositories.skills.proposeRevision({
    skillId,
    baseRevision,
    summary,
    rationale,
    proposedPayload,
    actorId: principal.userId,
  });
  if (result.status !== "ready") return repositoryFailure(result);
  if (!result.data.persisted) {
    return controlJson({ error: "skill_revision_not_persisted", message: result.data.message }, 409);
  }
  return controlJson({
    acknowledged: true,
    revisionId: result.data.revisionId,
    proposedRevision: result.data.proposedRevision,
    message: result.data.message,
  });
}
