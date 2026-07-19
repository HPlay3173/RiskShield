import {
  CAPABILITIES,
  type CurrentPrincipal,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./current-principal.ts";
import type {
  AuthRuntime,
} from "./runtime.ts";
import {
  requireAccessCodeConfiguration,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./runtime.ts";
import type {
  SessionClaims,
} from "./session.ts";

export const ACCESS_CODE_SUBJECT = "riskshield-access-owner";

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value)));
}

export async function verifyAccessCode(candidate: unknown, runtime: AuthRuntime) {
  if (typeof candidate !== "string" || candidate.length < 1 || candidate.length > 256) return false;
  const { accessCode } = requireAccessCodeConfiguration(runtime);
  const [candidateDigest, expectedDigest] = await Promise.all([digest(candidate), digest(accessCode)]);
  let difference = candidateDigest.length ^ expectedDigest.length;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= (candidateDigest[index] ?? 0) ^ expectedDigest[index];
  }
  return difference === 0;
}

export function accessCodePrincipalForSession(
  session: SessionClaims,
  runtime: AuthRuntime,
): CurrentPrincipal | null {
  try {
    requireAccessCodeConfiguration(runtime);
  } catch {
    return null;
  }
  if (session.sub !== ACCESS_CODE_SUBJECT || session.roleVersion !== 1) return null;
  return {
    userId: ACCESS_CODE_SUBJECT,
    externalSubject: ACCESS_CODE_SUBJECT,
    normalizedEmail: "access-code@riskshield.local",
    identityIssuer: "riskshield:access-code",
    authSource: "access_code",
    role: "owner",
    roleVersion: 1,
    capabilities: new Set(CAPABILITIES),
    sessionId: session.sid,
    csrfToken: session.csrf,
  };
}
