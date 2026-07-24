import { OIDC_STATE_COOKIE, secureCookie } from "../../../../../lib/auth/cookies";
import { authorizationRequest } from "../../../../../lib/auth/google-oidc";
import { oidcStateTtlSeconds } from "../../../../../lib/auth/session";

export async function GET(request: Request) {
  try {
    const returnTo = new URL(request.url).searchParams.get("return_to") ?? "/admin";
    const authorization = await authorizationRequest(request, returnTo);
    return new Response(null, {
      status: 302,
      headers: {
        location: authorization.url.toString(),
        "set-cookie": secureCookie(OIDC_STATE_COOKIE, authorization.stateToken, {
          maxAge: oidcStateTtlSeconds,
          sameSite: "Lax",
        }),
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "authentication_unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
