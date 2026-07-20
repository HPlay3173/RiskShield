import { principalFromRequest, requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject, repositoryFailure } from "../../../../../lib/http/control-response";
import { createRepositoryServices } from "../../../../../lib/repositories";
import { readCsvDataset } from "../../../../../lib/datasets/csv";
import { decodeSourceBase64 } from "../../../../../lib/datasets/source-bytes";
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
  const sourceBytes = decodeSourceBase64(body?.sourceBytesBase64);
  const datasetVersionId = typeof body?.datasetVersionId === "string" && body.datasetVersionId.trim()
    ? body.datasetVersionId.trim().slice(0, 200)
    : null;
  if (!sourceBytes || !datasetVersionId) {
    return controlJson({ error: "invalid_training_input", message: "검증된 dataset version, SHA-256과 1~10,000개 expression 행이 필요합니다." }, 400);
  }

  const versionMatch = /^(.+)_v([1-9][0-9]*)$/u.exec(datasetVersionId);
  const datasetId = versionMatch?.[1] ?? "";
  const versionNumber = Number(versionMatch?.[2] ?? 0);
  if (!datasetId || !Number.isSafeInteger(versionNumber)) {
    return controlJson({ error: "invalid_dataset_version", message: "등록된 Dataset Version이 필요합니다." }, 400);
  }
  const registeredDataset = await repositories.datasets.getById(datasetId);
  if (registeredDataset.status !== "ready") return repositoryFailure(registeredDataset);
  if (
    !registeredDataset.data
    || !["staging", "ready"].includes(registeredDataset.data.status)
    || registeredDataset.data.versionCount !== versionNumber
    || !registeredDataset.data.latestSha256
    || !registeredDataset.data.latestKeywordColumn
  ) {
    return controlJson({
      error: "dataset_version_mismatch",
      message: "Dataset Version과 source SHA-256을 확인할 수 없습니다.",
    }, 409);
  }

  const preliminary = await readCsvDataset(sourceBytes.buffer as ArrayBuffer, { previewRows: 0 });
  const keywordIndex = preliminary.inspection.headers.indexOf(registeredDataset.data.latestKeywordColumn);
  if (keywordIndex < 0) {
    return controlJson({ error: "dataset_mapping_mismatch", message: "등록된 keyword 열이 원본 CSV에 없습니다." }, 409);
  }
  const verified = await readCsvDataset(sourceBytes.buffer as ArrayBuffer, {
    mapping: { keyword: keywordIndex },
    delimiter: preliminary.inspection.delimiter,
    previewRows: 0,
  });
  const sourceSha256 = verified.inspection.sha256;
  if (
    registeredDataset.data.latestSha256 !== sourceSha256
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
