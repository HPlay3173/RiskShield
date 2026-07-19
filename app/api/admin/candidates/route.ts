import { requireApiCapability } from "../../../../lib/auth/authorize";
import { controlJson, repositoryFailure } from "../../../../lib/http/control-response";
import { createRepositoryServices } from "../../../../lib/repositories";

export async function GET(request: Request) {
  const denied = await requireApiCapability(request, "candidate:read");
  if (denied) return denied;
  const repositories = await createRepositoryServices({ request });
  const result = await repositories.candidates.list();
  return result.status === "ready"
    ? controlJson({ data: result.data, source: result.source, fixture: result.fixture })
    : repositoryFailure(result);
}
