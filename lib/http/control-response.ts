import type { RepositoryResult } from "../repositories/contracts";

export function controlJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function repositoryFailure<T>(result: Exclude<RepositoryResult<T>, { status: "ready" }>) {
  return controlJson(
    {
      error: result.code,
      message: result.message,
      state: result.status,
      ...(result.status === "configuration_required" ? { missing: result.missing } : {}),
    },
    503,
  );
}

export const JSON_BODY_TOO_LARGE = Symbol("json_body_too_large");

export async function readJsonObject(request: Request, maxBytes = 256 * 1024) {
  try {
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("json_body_too_large");
        return JSON_BODY_TOO_LARGE;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "");
    const value = JSON.parse(decoded) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
