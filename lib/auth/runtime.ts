export type AuthRuntime = {
  DB?: D1Database;
  GOOGLE_OIDC_CLIENT_ID?: string;
  GOOGLE_OIDC_CLIENT_SECRET?: string;
  RISKSHIELD_SESSION_SIGNING_KEY?: string;
  RISKSHIELD_CANONICAL_ORIGIN?: string;
};

export async function getAuthRuntime(): Promise<AuthRuntime> {
  const { env } = await import("cloudflare:workers");
  return env as typeof env & AuthRuntime;
}

export function canonicalOrigin(request: Request, runtime: AuthRuntime) {
  if (runtime.RISKSHIELD_CANONICAL_ORIGIN) {
    const configured = new URL(runtime.RISKSHIELD_CANONICAL_ORIGIN);
    if (configured.protocol !== "https:") throw new Error("auth_configuration_unavailable");
    return configured.origin;
  }
  const incoming = new URL(request.url);
  if (incoming.hostname === "localhost" || incoming.hostname === "127.0.0.1") {
    return incoming.origin;
  }
  throw new Error("auth_configuration_unavailable");
}

export function requireAuthConfiguration(runtime: AuthRuntime) {
  const clientId = runtime.GOOGLE_OIDC_CLIENT_ID;
  const clientSecret = runtime.GOOGLE_OIDC_CLIENT_SECRET;
  const signingKey = runtime.RISKSHIELD_SESSION_SIGNING_KEY;
  if (!clientId || !clientSecret || !signingKey || signingKey.length < 32) {
    throw new Error("auth_configuration_unavailable");
  }
  return { clientId, clientSecret, signingKey };
}
