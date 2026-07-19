import { createRemoteJWKSet, jwtVerify } from "jose";
import { canonicalOrigin, getAuthRuntime, requireAuthConfiguration } from "./runtime";
import { createOidcStateToken, type OidcState } from "./session";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(size = 32) {
  const value = new Uint8Array(size);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/admin";
  try {
    const parsed = new URL(value, "https://riskshield.local");
    if (parsed.origin !== "https://riskshield.local") return "/admin";
    if (parsed.pathname.startsWith("/api/auth/")) return "/admin";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/admin";
  }
}

export async function authorizationRequest(request: Request, returnTo: string) {
  const runtime = await getAuthRuntime();
  const { clientId } = requireAuthConfiguration(runtime);
  const redirectUri = `${canonicalOrigin(request, runtime)}/api/auth/google/callback`;
  const state: OidcState = {
    state: randomToken(),
    nonce: randomToken(),
    codeVerifier: randomToken(48),
    returnTo: safeReturnTo(returnTo),
  };
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state.state);
  url.searchParams.set("nonce", state.nonce);
  url.searchParams.set("code_challenge", await pkceChallenge(state.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return { url, stateToken: await createOidcStateToken(state) };
}

export async function exchangeAndVerifyCode(
  request: Request,
  input: { code: string; codeVerifier: string; nonce: string },
) {
  const runtime = await getAuthRuntime();
  const { clientId, clientSecret } = requireAuthConfiguration(runtime);
  const redirectUri = `${canonicalOrigin(request, runtime)}/api/auth/google/callback`;
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    }),
  });
  if (!response.ok) throw new Error("oidc_code_exchange_failed");
  const token = await response.json() as { id_token?: string };
  if (!token.id_token) throw new Error("oidc_id_token_missing");
  const { payload } = await jwtVerify(token.id_token, JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: clientId,
    algorithms: ["RS256"],
  });
  if (
    payload.nonce !== input.nonce ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw new Error("oidc_claim_validation_failed");
  }
  return {
    subject: payload.sub,
    email: payload.email.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
    issuer: "https://accounts.google.com" as const,
  };
}
