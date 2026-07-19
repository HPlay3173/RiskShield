import { requireApiCapability } from "../../../../lib/auth/authorize";
import { controlJson, repositoryFailure } from "../../../../lib/http/control-response";
import { createRepositoryServices } from "../../../../lib/repositories";

export async function GET(request: Request) {
  const denied = await requireApiCapability(request, "skill:read_admin");
  if (denied) return denied;
  const repositories = await createRepositoryServices({ request });
  const result = await repositories.skills.listAdmin({ limit: 100 });
  return result.status === "ready"
    ? controlJson({ data: result.data, source: result.source, fixture: result.fixture })
    : repositoryFailure(result);
}
