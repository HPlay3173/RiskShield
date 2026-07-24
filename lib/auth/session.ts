import { EncryptJWT, SignJWT, jwtDecrypt, jwtVerify } from "jose";
import { OIDC_STATE_COOKIE, SESSION_COOKIE, readCookie } from "./cookies";
import { getAuthRuntime, requireSessionConfiguration } from "./runtime";

const SESSION_ISSUER = "riskshield-control";
const SESSION_AUDIENCE = "riskshield-protected-routes";
const SESSION_TTL_SECONDS = 15 * 60;
const OIDC_STATE_TTL_SECONDS = 10 * 60;

export type SessionClaims = {
  sub: string;
  sid: string;
  roleVersion: number;
  csrf: string;
  iat: number;
  exp: number;
  googleSubject?: string;
  normalizedEmail?: string;
  managerAllowlist?: true;
};

export type OidcState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
};

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

async function encryptionKey(secret: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(`oidc-state:${secret}`)));
}

export async function createSessionToken(input: {
  userId: string;
  sessionId: string;
  roleVersion: number;
  csrfToken: string;
  googleIdentity?: {
    subject: string;
    email: string;
    managerAllowlist: true;
  };
}) {
  const runtime = await getAuthRuntime();
  const { signingKey } = requireSessionConfiguration(runtime);
  return new SignJWT({
    sid: input.sessionId,
    roleVersion: input.roleVersion,
    csrf: input.csrfToken,
    ...(input.googleIdentity ? {
      googleSubject: input.googleIdentity.subject,
      normalizedEmail: input.googleIdentity.email.trim().toLowerCase(),
      managerAllowlist: true,
    } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(bytes(signingKey));
}

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const runtime = await getAuthRuntime();
  const { signingKey } = requireSessionConfiguration(runtime);
  const { payload } = await jwtVerify(token, bytes(signingKey), {
    issuer: SESSION_ISSUER,
    audience: SESSION_AUDIENCE,
    algorithms: ["HS256"],
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    typeof payload.roleVersion !== "number" ||
    typeof payload.csrf !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("invalid_session");
  }
  const hasManagerClaims = payload.managerAllowlist === true;
  if (hasManagerClaims && (
    typeof payload.googleSubject !== "string" ||
    payload.googleSubject.length < 1 ||
    typeof payload.normalizedEmail !== "string"
  )) {
    throw new Error("invalid_session");
  }
  return {
    sub: payload.sub,
    sid: payload.sid,
    roleVersion: payload.roleVersion,
    csrf: payload.csrf,
    iat: payload.iat,
    exp: payload.exp,
    ...(hasManagerClaims ? {
      googleSubject: payload.googleSubject as string,
      normalizedEmail: (payload.normalizedEmail as string).trim().toLowerCase(),
      managerAllowlist: true as const,
    } : {}),
  };
}

export async function sessionFromRequest(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

export async function createOidcStateToken(state: OidcState) {
  const runtime = await getAuthRuntime();
  const { signingKey } = requireSessionConfiguration(runtime);
  return new EncryptJWT(state)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "riskshield-oidc-state" })
    .setIssuedAt()
    .setExpirationTime(`${OIDC_STATE_TTL_SECONDS}s`)
    .encrypt(await encryptionKey(signingKey));
}

export async function readOidcState(request: Request): Promise<OidcState | null> {
  const token = readCookie(request, OIDC_STATE_COOKIE);
  if (!token) return null;
  try {
    const runtime = await getAuthRuntime();
    const { signingKey } = requireSessionConfiguration(runtime);
    const { payload } = await jwtDecrypt(token, await encryptionKey(signingKey), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (
      typeof payload.state !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.codeVerifier !== "string" ||
      typeof payload.returnTo !== "string"
    ) {
      return null;
    }
    return {
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
      returnTo: payload.returnTo,
    };
  } catch {
    return null;
  }
}

export const sessionTtlSeconds = SESSION_TTL_SECONDS;
export const oidcStateTtlSeconds = OIDC_STATE_TTL_SECONDS;
