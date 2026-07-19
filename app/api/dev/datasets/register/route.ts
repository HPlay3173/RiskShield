import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject, repositoryFailure } from "../../../../../lib/http/control-response";
import { createRepositoryServices } from "../../../../../lib/repositories";

const MAX_STAGING_REQUEST_BYTES = 16 * 1024 * 1024;

function stringValue(value: unknown, max = 500) {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

export async function POST(request: Request) {
  const denied = await requireApiCapability(request, "dataset:manage");
  if (denied) return denied;
  const integrityFailure = await requireMutationIntegrity(request);
  if (integrityFailure) return integrityFailure;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_STAGING_REQUEST_BYTES) {
    return controlJson({ error: "dataset_staging_payload_too_large", message: "검증된 staging 요청은 16MiB 이하여야 합니다." }, 413);
  }
  const principal = await principalFromRequest(request);
  if (!principal) return controlJson({ error: "authentication_required" }, 401);
  const body = await readJsonObject(request, MAX_STAGING_REQUEST_BYTES);
  if (body === JSON_BODY_TOO_LARGE) {
    return controlJson({ error: "dataset_staging_payload_too_large", message: "검증된 staging 요청은 16MiB 이하여야 합니다." }, 413);
  }
  const source = typeof body?.source === "object" && body.source !== null && !Array.isArray(body.source)
    ? body.source as Record<string, unknown>
    : {};
  const inspection = typeof body?.inspection === "object" && body.inspection !== null && !Array.isArray(body.inspection)
    ? body.inspection as Record<string, unknown>
    : {};
  const provenance = typeof body?.provenance === "object" && body.provenance !== null && !Array.isArray(body.provenance)
    ? body.provenance as Record<string, unknown>
    : {};
  const mapping = typeof inspection.mapping === "object" && inspection.mapping !== null && !Array.isArray(inspection.mapping)
    ? inspection.mapping as Record<string, unknown>
    : {};
  const keywordMapping = typeof mapping.keyword === "object" && mapping.keyword !== null && !Array.isArray(mapping.keyword)
    ? mapping.keyword as Record<string, unknown>
    : {};
  const name = stringValue(source.name ?? body?.name, 200);
  const rawSha = source.sha256 ?? body?.sha256;
  const sha256 = typeof rawSha === "string" && /^[a-f0-9]{64}$/u.test(rawSha) ? rawSha : null;
  const rawByteSize = source.byteSize ?? body?.byteSize;
  const byteSize = typeof rawByteSize === "number" && Number.isInteger(rawByteSize) && rawByteSize >= 0 ? rawByteSize : -1;
  const rawRowCount = inspection.rowCount ?? body?.rowCount;
  const rowCount = typeof rawRowCount === "number" && Number.isInteger(rawRowCount) && rawRowCount >= 0 ? rawRowCount : -1;
  const delimiter = stringValue(inspection.delimiter ?? body?.delimiter, 1);
  const keywordColumn = stringValue(keywordMapping.header ?? body?.keywordColumn, 200);
  const owner = stringValue(provenance.owner ?? body?.owner, 200);
  const license = stringValue(provenance.license ?? body?.license, 200);
  const allowedPurpose = stringValue(provenance.purpose ?? body?.allowedPurpose, 500);
  const retention = stringValue(provenance.retention ?? body?.retention, 200);
  const rawHeaders = inspection.headers ?? body?.headers;
  const headers = Array.isArray(rawHeaders)
    ? rawHeaders.filter((value): value is string => typeof value === "string" && value.length <= 200).slice(0, 64)
    : [];
  const rows = body?.rows;
  if (!name || !sha256 || byteSize < 0 || rowCount < 0 || !delimiter || !keywordColumn || !owner || !license || !allowedPurpose || !retention || !headers.length || !Array.isArray(rows) || rows.length !== rowCount) {
    return controlJson({ error: "invalid_dataset_registration", message: "검증 결과와 provenance 필드를 모두 확인해 주세요." }, 400);
  }
  const repositories = await createRepositoryServices({ request });
  const result = await repositories.datasets.register({
    name,
    sha256,
    byteSize,
    rowCount,
    encoding: "utf-8",
    delimiter,
    headers,
    keywordColumn,
    owner,
    license,
    allowedPurpose,
    retention,
    actorId: principal.userId,
  });
  if (result.status !== "ready") return repositoryFailure(result);
  if (!result.data.persisted) return controlJson({ error: "dataset_not_registered", message: result.data.message }, 409);
  return controlJson({
    acknowledged: true,
    datasetId: result.data.datasetId,
    versionId: result.data.versionId,
    datasetVersionId: result.data.versionId,
    status: result.data.status,
    message: result.data.message,
  });
}
