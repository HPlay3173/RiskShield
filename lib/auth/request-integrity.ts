import { principalFromRequest } from "./authorize";
import { canonicalOrigin, getAuthRuntime } from "./runtime";

function forbidden() {
  return Response.json(
    { error: "request_integrity_failed" },
    { status: 403, headers: { "cache-control": "private, no-store" } },
  );
}

export async function requireMutationIntegrity(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return forbidden();
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== "same-origin") return forbidden();
  const runtime = await getAuthRuntime();
  let expectedOrigin: string;
  try {
    expectedOrigin = canonicalOrigin(request, runtime);
  } catch {
    return forbidden();
  }
  if (request.headers.get("origin") !== expectedOrigin) return forbidden();
  const principal = await principalFromRequest(request);
  if (!principal || request.headers.get("x-riskshield-csrf") !== principal.csrfToken) return forbidden();
  return null;
}
