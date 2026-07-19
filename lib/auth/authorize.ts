import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./cookies";
import type { Capability, CurrentPrincipal } from "./current-principal";
import { developmentPrincipalForHost, developmentPrincipalForRequest } from "./dev-principal";
import { principalForSession } from "./identity-adapter";
import { can } from "./permissions";
import { safeReturnTo } from "./google-oidc";
import { getAuthRuntime } from "./runtime";
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
  try {
    const developmentPrincipal = developmentPrincipalForRequest(request, await getAuthRuntime());
    if (developmentPrincipal) return developmentPrincipal;
  } catch {
    // A missing runtime binding never broadens access; normal session auth continues below.
  }
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
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  try {
    const developmentPrincipal = developmentPrincipalForHost({
      runtime: await getAuthRuntime(),
      host: requestHeaders.get("host"),
    });
    if (developmentPrincipal) {
      if (!can(developmentPrincipal, capability)) redirect("/?access=denied");
      return developmentPrincipal;
    }
  } catch {
    // Production and incomplete local runtimes remain on the normal fail-closed path.
  }
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
