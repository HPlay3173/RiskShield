import type { CollectorProvider } from "./runner";

function canonicalYouTubeIds(value: string) {
  const ids = value.split(/[\s,]+/u).flatMap((token) => {
    if (/^[A-Za-z0-9_-]{11}$/u.test(token)) return [token];
    try {
      const url = new URL(token);
      const host = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./u, "");
      const candidate = host === "youtu.be" ? url.pathname.split("/").filter(Boolean)[0]
        : host === "youtube.com" || host === "m.youtube.com"
          ? url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/u)?.[1]
          : null;
      return candidate && /^[A-Za-z0-9_-]{11}$/u.test(candidate) ? [candidate] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(ids)].sort().join(",");
}

function canonicalEndpoint(value: string | null) {
  if (!value) return "";
  const url = new URL(value);
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLocaleLowerCase("en-US");
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.searchParams.sort();
  return url.toString().replace(/\/$/u, "");
}

export function canonicalCollectorIdentity(provider: CollectorProvider, query: string, endpoint: string | null) {
  const canonicalQuery = provider === "youtube"
    ? canonicalYouTubeIds(query)
    : query.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return `${provider}\n${canonicalQuery}\n${canonicalEndpoint(endpoint)}`;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

export async function collectorSourceFingerprint(provider: CollectorProvider, query: string, endpoint: string | null) {
  return sha256Hex(canonicalCollectorIdentity(provider, query, endpoint));
}

export async function collectedPostFingerprint(provider: CollectorProvider, externalId: string) {
  return sha256Hex(`${provider}\n${externalId.normalize("NFKC").trim()}`);
}
