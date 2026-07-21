import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject, repositoryFailure } from "../../../../../lib/http/control-response";
import { createRepositoryServices } from "../../../../../lib/repositories";
import { readCsvDataset } from "../../../../../lib/datasets/csv";
import { decodeSourceBase64 } from "../../../../../lib/datasets/source-bytes";
import { readDatasetSource } from "../../../../../lib/datasets/object-store";
import { GoogleTrainingDraftProvider } from "../../../../../lib/training/google-draft-provider";
import {
  runTrainingMvp,
  type TrainingSourceRow,
  type WaitingReviewRepository,
} from "../../../../../lib/training/mvp";

const MAX_ROWS = 10_000;
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

export async function runTrainingRequest(request: Request, allowProduction: boolean) {
  const denied = await requireApiCapability(request, "training:run");
  if (denied) return denied;
  const integrityFailure = await requireMutationIntegrity(request);
  if (integrityFailure) return integrityFailure;
  const repositories = await createRepositoryServices({ request });
  const principal = await principalFromRequest(request);
  if (!principal) return controlJson({ error: "authentication_required" }, 401);
  if (!allowProduction) {
    if (!repositories.developmentFixture) {
      return controlJson({
        error: "training_runner_unavailable",
        message: "Production training runner is available only through the unified management API.",
        state: "configuration_required",
      }, 503);
    }
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return controlJson({ error: "training_payload_too_large", message: "한 실행은 10,000행과 3MiB 이하만 지원합니다." }, 413);
  }
  const body = await readJsonObject(request, MAX_REQUEST_BYTES);
  if (body === JSON_BODY_TOO_LARGE) {
    return controlJson({ error: "training_payload_too_large", message: "한 실행은 10,000행과 3MiB 이하만 지원합니다." }, 413);
  }
  const datasetVersionId = typeof body?.datasetVersionId === "string" && body.datasetVersionId.trim()
    ? body.datasetVersionId.trim().slice(0, 200)
    : null;
  if (!datasetVersionId) {
    return controlJson({ error: "invalid_training_input", message: "검증된 dataset version이 필요합니다." }, 400);
  }

  const registeredVersion = await repositories.datasets.getVersion(datasetVersionId);
  if (registeredVersion.status !== "ready") return repositoryFailure(registeredVersion);
  if (!registeredVersion.data) {
    return controlJson({ error: "invalid_dataset_version", message: "불변 원본에 연결된 Dataset Version을 찾지 못했습니다." }, 409);
  }
  const datasetId = registeredVersion.data.datasetId;
  const registeredDataset = await repositories.datasets.getById(datasetId);
  if (registeredDataset.status !== "ready") return repositoryFailure(registeredDataset);
  if (
    !registeredDataset.data
    || !["staging", "ready"].includes(registeredDataset.data.status)
  ) {
    return controlJson({
      error: "dataset_version_mismatch",
      message: "Dataset Version과 source SHA-256을 확인할 수 없습니다.",
    }, 409);
  }

  let sourceBytes: Uint8Array | null = null;
  if (repositories.developmentFixture) {
    sourceBytes = decodeSourceBase64(body?.sourceBytesBase64);
  } else {
    try {
      const { env } = await import("cloudflare:workers");
      if (!env.DATASETS) {
        return controlJson({
          error: "dataset_object_storage_required",
          message: "학습 원본을 읽을 R2 DATASETS binding이 필요합니다.",
          state: "configuration_required",
        }, 503);
      }
      sourceBytes = await readDatasetSource(
        env.DATASETS,
        registeredVersion.data.objectKey,
        registeredVersion.data.sha256,
      );
    } catch (error) {
      console.error("[RiskShield training] immutable dataset read failed", error instanceof Error ? error.name : "unknown_error");
      return controlJson({ error: "dataset_object_read_failed", message: "등록된 불변 데이터셋 원본을 읽지 못했습니다." }, 503);
    }
  }
  if (!sourceBytes) {
    return controlJson({ error: "dataset_source_required", message: "개발 실행에는 등록 당시와 동일한 원본 CSV가 필요합니다." }, 400);
  }

  const preliminary = await readCsvDataset(sourceBytes.buffer as ArrayBuffer, { previewRows: 0 });
  const keywordIndex = preliminary.inspection.headers.indexOf(registeredVersion.data.keywordColumn);
  if (keywordIndex < 0) {
    return controlJson({ error: "dataset_mapping_mismatch", message: "등록된 keyword 열이 원본 CSV에 없습니다." }, 409);
  }
  const verified = await readCsvDataset(sourceBytes.buffer as ArrayBuffer, {
    mapping: { keyword: keywordIndex },
    delimiter: registeredVersion.data.delimiter as "," | ";" | "\t" | "|",
    previewRows: 0,
  });
  const sourceSha256 = verified.inspection.sha256;
  if (
    registeredVersion.data.sha256 !== sourceSha256
    || registeredVersion.data.byteSize !== verified.inspection.byteSize
    || registeredVersion.data.rowCount !== verified.inspection.rowCount
    || !verified.inspection.canStage
    || !verified.rows.length
    || verified.rows.length > MAX_ROWS
  ) {
    return controlJson({
      error: "dataset_source_mismatch",
      message: "원본 CSV 바이트, SHA-256 또는 등록된 열 매핑이 Dataset Version과 일치하지 않습니다.",
    }, 409);
  }
  const sourcePrefix = sourceSha256.slice(0, 16);
  const rows: TrainingSourceRow[] = verified.rows.map((row) => ({
    id: `${sourcePrefix}:${row.rowNumber}`,
    expression: row.mapped.keyword?.trim() ?? "",
    root: null,
    category: null,
    sourceRow: row.rowNumber,
    flags: [...row.flags],
  }));
  if (rows.some((row) => !row.expression)) {
    return controlJson({ error: "invalid_training_rows", message: "서버 검증을 통과한 keyword 행이 필요합니다." }, 400);
  }

  const reviewed = await repositories.skills.listReviewed();
  if (reviewed.status !== "ready") return repositoryFailure(reviewed);
  let apiKey = "";
  try {
    const { env } = await import("cloudflare:workers");
    apiKey = typeof env.RISKSHIELD_INTERPRETER_API_KEY === "string" ? env.RISKSHIELD_INTERPRETER_API_KEY : "";
  } catch {
    apiKey = "";
  }
  const draftProvider = new GoogleTrainingDraftProvider(apiKey);
  const waitingReviewRepository: WaitingReviewRepository = {
        configured: true,
        async saveWaitingReview(candidates, context, signal) {
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
          const result = await repositories.candidates.saveGenerated(candidates.map((candidate) => ({
            id: candidate.id,
            expression: candidate.representativeExpression,
            riskDomain: candidate.category ?? "unclassified",
            noveltyScore: candidate.noveltyScore,
            confidence: null,
            sourceCount: candidate.sourceRowIds.length,
            expressionGroup: [candidate.representativeExpression],
            contextSummary: "결정적 grouping 결과입니다. 의미 문맥 adapter는 아직 구성되지 않았습니다.",
            similarity: candidate.nearestReviewedSkill?.score ?? null,
            skillDiff: candidate.nearestReviewedSkill
              ? `검토 스킬 ${candidate.nearestReviewedSkill.skillId}와 lexical similarity ${candidate.nearestReviewedSkill.score.toFixed(3)}`
              : "비교 가능한 reviewed skill이 없습니다.",
            positiveTests: candidate.tests.filter((test) => test.type === "positive").map((test) => test.input),
            negativeTests: candidate.tests.filter((test) => test.type === "negative").map((test) => test.input),
            redTeam: "생성된 양성·음성 경계 테스트는 사람의 Red-Team 검토가 필요합니다.",
            modelConflict: null,
            policyChange: null,
            draft: candidate.draft ? {
              title: candidate.draft.title,
              riskSummary: candidate.draft.riskSummary,
              triggerPatterns: candidate.draft.triggerPatterns,
              contextPatterns: candidate.draft.contextPatterns,
              safeRewrite: candidate.draft.safeRewrite,
            } : null,
            lineage: {
              runId: context.runId,
              datasetVersionId: context.datasetVersionId,
              sourceSha256: context.sourceSha256,
            },
            sources: [{
              title: `Dataset ${context.datasetVersionId}`,
              url: "",
              date: new Date().toISOString().slice(0, 10),
            }],
            autoInclusionBlockedReason: "pipeline 후보는 관리자 승인 전 active skill로 편입되지 않습니다.",
          })));
          if (result.status !== "ready") throw Object.assign(new Error(result.code), { code: result.code });
          return { savedCandidateIds: [...result.data.savedIds] };
        },
      };

  const startedAt = Date.now();
  const result = await runTrainingMvp({
    datasetVersionId,
    sourceSha256,
    rows,
    skills: reviewed.data.map((skill) => ({
      id: skill.id,
      reviewStatus: skill.reviewStatus,
      category: skill.category,
      surfaceMeaning: skill.surfaceMeaning,
      triggerPatterns: skill.triggerPatterns,
      contextPatterns: skill.contextPatterns,
    })),
  }, {
    signal: request.signal,
    draftProvider: draftProvider.configured ? draftProvider : undefined,
    waitingReviewRepository,
    maxRetries: 1,
  });

  const activeStage = [...result.stages].reverse().find((stage) => stage.state !== "not_configured");
  const runPersistence = await repositories.training.saveRun({
    id: result.runId,
    datasetVersionId,
    status: result.status,
    currentStage: activeStage?.id ?? null,
    itemCount: result.metrics.candidates,
    warningCount: result.stages.reduce((sum, stage) => sum + stage.warnings.length, 0),
    estimatedCost: null,
    latencyMs: Date.now() - startedAt,
    updatedAt: new Date().toISOString(),
  }, principal.userId);
  if (runPersistence.status !== "ready") return repositoryFailure(runPersistence);
  if (!runPersistence.data.persisted) {
    return controlJson({ error: "training_run_not_persisted" }, 409);
  }

  return controlJson({
    acknowledged: true,
    providerConfigured: draftProvider.configured,
    candidatePersistenceConfigured: true,
    runPersisted: true,
    result,
  });
}

export async function POST(request: Request) {
  return runTrainingRequest(request, false);
}
