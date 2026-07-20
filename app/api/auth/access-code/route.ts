import { ACCESS_CODE_SUBJECT, verifyAccessCode } from "../../../../lib/auth/access-code";
import { SESSION_COOKIE, secureCookie } from "../../../../lib/auth/cookies";
import { safeReturnTo } from "../../../../lib/auth/google-oidc";
import { JSON_BODY_TOO_LARGE, readJsonObject } from "../../../../lib/http/control-response";
import {
  canonicalOrigin,
  getAuthRuntime,
  requireAccessCodeConfiguration,
} from "../../../../lib/auth/runtime";
import { createSessionToken, sessionTtlSeconds } from "../../../../lib/auth/session";

const MAX_LOGIN_BYTES = 2_048;

function json(payload: Record<string, unknown>, status: number, headers?: HeadersInit) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function loginRequestIsSameOrigin(request: Request, expectedOrigin: string) {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
    && request.headers.get("sec-fetch-site") === "same-origin"
    && request.headers.get("origin") === expectedOrigin
  );
}

export async function POST(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (process.env.NODE_ENV === "production" || (hostname !== "localhost" && hostname !== "127.0.0.1")) {
    return json({ error: "access_code_retired" }, 410);
  }
  let runtime;
  try {
    runtime = await getAuthRuntime();
    requireAccessCodeConfiguration(runtime);
  } catch {
    return json({ error: "authentication_unavailable" }, 503);
  }

  let expectedOrigin: string;
  try {
    expectedOrigin = canonicalOrigin(request, runtime);
  } catch {
    return json({ error: "authentication_unavailable" }, 503);
  }
  if (!loginRequestIsSameOrigin(request, expectedOrigin)) {
    return json({ error: "request_integrity_failed" }, 403);
  }

  const body = await readJsonObject(request, MAX_LOGIN_BYTES);
  if (!body || body === JSON_BODY_TOO_LARGE) {
    return json({ error: "invalid_credentials" }, 401);
  }
  const valid = await verifyAccessCode(body.code, runtime);
  if (!valid) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return json({ error: "invalid_credentials" }, 401);
  }

  const returnTo = safeReturnTo(typeof body.returnTo === "string" ? body.returnTo : null);
  const token = await createSessionToken({
    userId: ACCESS_CODE_SUBJECT,
    sessionId: crypto.randomUUID(),
    roleVersion: 1,
    csrfToken: crypto.randomUUID(),
  });
  return json(
    { authenticated: true, returnTo, expiresIn: sessionTtlSeconds },
    200,
    { "set-cookie": secureCookie(SESSION_COOKIE, token, { maxAge: sessionTtlSeconds, sameSite: "Strict" }) },
  );
}
