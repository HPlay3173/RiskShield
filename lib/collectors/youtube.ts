const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

export type ParsedYouTubeVideos = {
  ids: string[];
  invalid: string[];
};

function idFromUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./u, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") return null;
    const watchId = url.searchParams.get("v");
    if (watchId) return watchId;
    const [kind, id] = url.pathname.split("/").filter(Boolean);
    return ["shorts", "live", "embed"].includes(kind ?? "") ? id ?? null : null;
  } catch {
    return null;
  }
}

export function parseYouTubeVideoInput(input: string, limit = 5): ParsedYouTubeVideos {
  const ids: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const values = input.split(/[\s,]+/u).map((value) => value.trim()).filter(Boolean);

  for (const value of values) {
    const candidate = VIDEO_ID.test(value) ? value : idFromUrl(value);
    if (!candidate || !VIDEO_ID.test(candidate)) {
      invalid.push(value);
      continue;
    }
    if (!seen.has(candidate)) {
      seen.add(candidate);
      ids.push(candidate);
    }
  }

  return { ids: ids.slice(0, limit), invalid: invalid.concat(ids.length > limit ? ids.slice(limit) : []) };
}
