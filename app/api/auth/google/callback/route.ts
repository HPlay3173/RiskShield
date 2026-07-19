import {
  OIDC_STATE_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  secureCookie,
} from "../../../../../lib/auth/cookies";
import { exchangeAndVerifyCode } from "../../../../../lib/auth/google-oidc";
import { userForGoogleIdentity } from "../../../../../lib/auth/identity-adapter";
import {
  createSessionToken,
  readOidcState,
  sessionTtlSeconds,
} from "../../../../../lib/auth/session";

function failure(status: number, code: string) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "private, no-store" });
  headers.append("set-cookie", clearCookie(OIDC_STATE_COOKIE, "Lax"));
  return new Response(JSON.stringify({ error: code }), { status, headers });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = await readOidcState(request);
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.get("state") !== state.state) {
    return failure(401, "invalid_oauth_state");
  }
  try {
    const identity = await exchangeAndVerifyCode(request, {
      code,
      codeVerifier: state.codeVerifier,
      nonce: state.nonce,
    });
    const user = await userForGoogleIdentity(identity);
    if (!user) return failure(403, "account_not_authorized");
    const sessionToken = await createSessionToken({
      userId: user.user_id,
      sessionId: crypto.randomUUID(),
      roleVersion: user.role_version,
      csrfToken: crypto.randomUUID(),
    });
    const headers = new Headers({ location: state.returnTo, "cache-control": "private, no-store" });
    headers.append("set-cookie", clearCookie(OIDC_STATE_COOKIE, "Lax"));
    headers.append("set-cookie", secureCookie(SESSION_COOKIE, sessionToken, {
      maxAge: sessionTtlSeconds,
      sameSite: "Strict",
    }));
    return new Response(null, { status: 303, headers });
  } catch {
    return failure(401, "authentication_failed");
  }
}
