import {
  isCapability,
  isRole,
  type Capability,
  type CurrentPrincipal,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./current-principal.ts";
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
import { getAuthRuntime } from "./runtime.ts";
import type { SessionClaims } from "./session.ts";
import {
  accessCodePrincipalForSession,
  ACCESS_CODE_SUBJECT,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./access-code.ts";

type UserRow = {
  user_id: string;
  external_subject: string;
  normalized_email: string;
  role_name: string;
  capabilities: string;
  role_version: number;
  session_not_before: string | null;
};

function capabilitiesFrom(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return new Set<Capability>();
  }
  if (!Array.isArray(parsed)) return new Set<Capability>();
  return new Set(parsed.filter((item): item is Capability => typeof item === "string" && isCapability(item)));
}

export function sessionClearsNotBefore(sessionIssuedAt: number, value: string | null) {
  if (value === null) return true;
  const notBefore = Date.parse(value);
  return Number.isFinite(notBefore) && sessionIssuedAt * 1_000 >= notBefore;
}

async function database() {
  const runtime = await getAuthRuntime();
  if (!runtime.DB) throw new Error("auth_storage_unavailable");
  return runtime.DB;
}

async function rowBy(sql: string, value: string) {
  return (await database()).prepare(sql).bind(value).first<UserRow>();
}

const USER_SELECT = `
  SELECT
    u.id AS user_id,
    u.external_subject,
    u.normalized_email,
    u.role_name,
    r.capabilities,
    u.role_version,
    u.session_not_before
  FROM riskshield_users AS u
  INNER JOIN riskshield_roles AS r ON r.name = u.role_name
`;

export async function userForGoogleIdentity(identity: { subject: string; email: string }) {
  const row = await rowBy(
    `${USER_SELECT}
     WHERE u.identity_provider = 'google'
       AND u.external_subject = ?
       AND u.status = 'active'
     LIMIT 1`,
    identity.subject,
  );
  if (!row || row.normalized_email !== identity.email || !isRole(row.role_name)) return null;
  return row;
}

export async function principalForSession(session: SessionClaims): Promise<CurrentPrincipal | null> {
  const runtime = await getAuthRuntime();
  const accessCodePrincipal = accessCodePrincipalForSession(session, runtime);
  if (accessCodePrincipal) return accessCodePrincipal;
  const row = await rowBy(
    `${USER_SELECT}
     WHERE u.id = ?
       AND u.identity_provider = 'google'
       AND u.status = 'active'
     LIMIT 1`,
    session.sub,
  );
  if (!row || !isRole(row.role_name) || row.role_version !== session.roleVersion) return null;
  if (!sessionClearsNotBefore(session.iat, row.session_not_before)) return null;
  const revoked = await (await database()).prepare(
    "SELECT session_id FROM riskshield_session_revocations WHERE session_id = ? AND expires_at > ? LIMIT 1",
  ).bind(session.sid, new Date().toISOString()).first<{ session_id: string }>();
  if (revoked) return null;
  return {
    userId: row.user_id,
    externalSubject: row.external_subject,
    normalizedEmail: row.normalized_email,
    identityIssuer: "https://accounts.google.com",
    authSource: "google_oidc",
    role: row.role_name,
    roleVersion: row.role_version,
    capabilities: capabilitiesFrom(row.capabilities),
    sessionId: session.sid,
    csrfToken: session.csrf,
  };
}

export async function revokeSession(session: SessionClaims) {
  if (session.sub === ACCESS_CODE_SUBJECT) return;
  const db = await database();
  await db.prepare(`
    INSERT INTO riskshield_session_revocations (session_id, user_id, expires_at, revoked_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO NOTHING
  `).bind(
    session.sid,
    session.sub,
    new Date(session.exp * 1_000).toISOString(),
    new Date().toISOString(),
  ).run();
}
