import type { Capability } from "./current-principal";
import { requireApiCapability } from "./authorize";
import { requireMutationIntegrity } from "./request-integrity";

export async function controlApi(
  request: Request,
  capability: Capability,
  mutation = false,
) {
  const denied = await requireApiCapability(request, capability);
  if (denied) return denied;
  if (mutation) {
    const invalid = await requireMutationIntegrity(request);
    if (invalid) return invalid;
  }
  return Response.json(
    { error: "not_implemented" },
    { status: 404, headers: { "cache-control": "private, no-store" } },
  );
}
