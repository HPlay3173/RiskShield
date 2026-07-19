import { SESSION_COOKIE, clearCookie } from "../../../../lib/auth/cookies";
import { revokeSession } from "../../../../lib/auth/identity-adapter";
import { requireMutationIntegrity } from "../../../../lib/auth/request-integrity";
import { sessionFromRequest } from "../../../../lib/auth/session";

export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }
  const invalid = await requireMutationIntegrity(request);
  if (invalid) return invalid;
  try {
    await revokeSession(session);
  } catch {
    return Response.json(
      { error: "session_revoke_failed" },
      {
        status: 503,
        headers: {
          "cache-control": "private, no-store",
          "set-cookie": clearCookie(SESSION_COOKIE, "Strict"),
        },
      },
    );
  }
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "private, no-store",
      "set-cookie": clearCookie(SESSION_COOKIE, "Strict"),
    },
  });
}
