import {
  CAPABILITIES,
  type CurrentPrincipal,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./current-principal.ts";
import type {
  AuthRuntime,
} from "./runtime.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const DEVELOPMENT_PRINCIPAL_LABEL = "개발 데이터" as const;

function normalizedHost(value: string | null | undefined) {
  if (!value) return null;
  if (/[@/\\?#]/u.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/") return null;
    return parsed.hostname.toLocaleLowerCase("en-US");
  } catch {
    return null;
  }
}

export function isLoopbackHost(value: string | null | undefined) {
  const host = normalizedHost(value);
  return host !== null && LOOPBACK_HOSTS.has(host);
}

export function developmentPrincipalAllowed(input: {
  runtime: AuthRuntime;
  host: string | null | undefined;
  nodeEnv?: string;
}) {
  return (
    (input.nodeEnv ?? process.env.NODE_ENV) !== "production" &&
    input.runtime.RISKSHIELD_ENABLE_DEV_PRINCIPAL === "1" &&
    isLoopbackHost(input.host)
  );
}

export function developmentPrincipalForHost(input: {
  runtime: AuthRuntime;
  host: string | null | undefined;
  nodeEnv?: string;
}): CurrentPrincipal | null {
  if (!developmentPrincipalAllowed(input)) return null;
  return {
    userId: "dev-owner",
    externalSubject: "dev-owner",
    normalizedEmail: "dev-owner@localhost.invalid",
    identityIssuer: "riskshield:local-development",
    authSource: "development_fixture",
    role: "owner",
    roleVersion: 1,
    capabilities: new Set(CAPABILITIES),
    sessionId: "dev-owner-fixture",
    csrfToken: "dev-owner-fixture-csrf",
  };
}

export function developmentPrincipalForRequest(
  request: Request,
  runtime: AuthRuntime,
  nodeEnv?: string,
) {
  return developmentPrincipalForHost({
    runtime,
    host: new URL(request.url).host,
    nodeEnv,
  });
}
