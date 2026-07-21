import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { CSV_FIELD_ROLES, readCsvDataset, type CsvDelimiter, type CsvManualMapping } from "../../../../../lib/datasets/csv";
import { decodeSourceBase64 } from "../../../../../lib/datasets/source-bytes";
import { datasetObjectKey, persistDatasetSource } from "../../../../../lib/datasets/object-store";
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
    return controlJson({ error: "dataset_staging_payload_too_large", message: "검증할 staging 요청은 16MiB 이하여야 합니다." }, 413);
  }
  const principal = await principalFromRequest(request);
  if (!principal) return controlJson({ error: "authentication_required" }, 401);
  const body = await readJsonObject(request, MAX_STAGING_REQUEST_BYTES);
  if (body === JSON_BODY_TOO_LARGE) {
    return controlJson({ error: "dataset_staging_payload_too_large", message: "검증할 staging 요청은 16MiB 이하여야 합니다." }, 413);
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
  const name = stringValue(source.name ?? body?.name, 200);
  const sourceBytes = decodeSourceBase64(source.bytesBase64);
  const delimiterValue = stringValue(inspection.delimiter ?? body?.delimiter, 1);
  const delimiter = delimiterValue && [",", ";", "\t", "|"].includes(delimiterValue)
    ? delimiterValue as CsvDelimiter
    : null;
  const owner = stringValue(provenance.owner ?? body?.owner, 200);
  const license = stringValue(provenance.license ?? body?.license, 200);
  const allowedPurpose = stringValue(provenance.purpose ?? body?.allowedPurpose, 500);
  const retention = stringValue(provenance.retention ?? body?.retention, 200);
  if (!name || !sourceBytes || !delimiter || !owner || !license || !allowedPurpose || !retention) {
    return controlJson({ error: "invalid_dataset_registration", message: "원본 CSV와 provenance 필드를 모두 확인해 주세요." }, 400);
  }

  const manualMapping: CsvManualMapping = {};
  for (const role of CSV_FIELD_ROLES) {
    const entry = mapping[role];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const index = (entry as Record<string, unknown>).index;
    if (typeof index === "number" && Number.isInteger(index) && index >= 0) manualMapping[role] = index;
  }
  const verified = await readCsvDataset(sourceBytes.buffer as ArrayBuffer, {
    sourceName: name,
    mapping: manualMapping,
    delimiter,
    previewRows: 0,
  });
  if (!verified.inspection.canStage || !verified.inspection.mapping.keyword) {
    return controlJson({ error: "dataset_server_validation_failed", message: "서버에서 CSV와 keyword 열을 검증하지 못했습니다." }, 400);
  }
  if (typeof source.sha256 === "string" && source.sha256 !== verified.inspection.sha256) {
    return controlJson({ error: "dataset_sha_mismatch", message: "서버가 계산한 원본 SHA-256과 일치하지 않습니다." }, 409);
  }

  const repositories = await createRepositoryServices({ request });
  let objectKey = datasetObjectKey(verified.inspection.sha256);
  if (!repositories.developmentFixture) {
    try {
      const { env } = await import("cloudflare:workers");
      if (!env.DATASETS) {
        return controlJson({
          error: "dataset_object_storage_required",
          message: "원본 데이터셋을 보존할 R2 DATASETS binding이 필요합니다.",
          state: "configuration_required",
        }, 503);
      }
      objectKey = await persistDatasetSource(env.DATASETS, sourceBytes, verified.inspection.sha256);
    } catch (error) {
      console.error("[RiskShield dataset registration] object persistence failed", error instanceof Error ? error.name : "unknown_error");
      return controlJson({
        error: "dataset_object_write_failed",
        message: "검증된 원본 데이터셋을 불변 저장소에 기록하지 못했습니다.",
      }, 503);
    }
  }
  const result = await repositories.datasets.register({
    name,
    sha256: verified.inspection.sha256,
    byteSize: verified.inspection.byteSize,
    rowCount: verified.inspection.rowCount,
    encoding: "utf-8",
    delimiter: verified.inspection.delimiter,
    headers: verified.inspection.headers,
    keywordColumn: verified.inspection.mapping.keyword.header,
    objectKey,
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
    sha256: verified.inspection.sha256,
    message: result.data.message,
  });
}
