import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./cookies";
import type { Capability, CurrentPrincipal } from "./current-principal";
import { principalForSession } from "./identity-adapter";
import { can } from "./permissions";
import { safeReturnTo } from "./google-oidc";
import { sessionFromRequest, verifySessionToken } from "./session";

function denied(status: 401 | 403) {
  return Response.json(
    { error: status === 401 ? "authentication_required" : "forbidden" },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function principalFromRequest(request: Request): Promise<CurrentPrincipal | null> {
  const session = await sessionFromRequest(request);
  if (!session) return null;
  try {
    return await principalForSession(session);
  } catch {
    return null;
  }
}

export async function requireApiCapability(request: Request, capability: Capability) {
  const principal = await principalFromRequest(request);
  if (!principal) return denied(401);
  return can(principal, capability) ? null : denied(403);
}

export async function requirePageCapability(returnTo: string, capability: Capability) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  let principal: CurrentPrincipal | null = null;
  if (token) {
    try {
      principal = await principalForSession(await verifySessionToken(token));
    } catch {
      principal = null;
    }
  }
  if (!principal) {
    redirect(`/api/auth/google/start?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`);
  }
  if (!can(principal, capability)) redirect("/?access=denied");
  return principal;
}
