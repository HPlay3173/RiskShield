export const SESSION_COOKIE = "__Host-riskshield_session";
export const OIDC_STATE_COOKIE = "__Host-riskshield_oidc";

export function readCookie(request: Request, name: string) {
  const source = request.headers.get("cookie") ?? "";
  for (const part of source.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function secureCookie(
  name: string,
  value: string,
  options: { maxAge: number; sameSite: "Lax" | "Strict" },
) {
  return [
    `${name}=${value}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    `SameSite=${options.sameSite}`,
    `Max-Age=${options.maxAge}`,
  ].join("; ");
}

export function clearCookie(name: string, sameSite: "Lax" | "Strict") {
  return secureCookie(name, "", { maxAge: 0, sameSite });
}
