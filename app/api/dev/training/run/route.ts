import { requireApiCapability } from "../../../../../lib/auth/authorize";
import { requireMutationIntegrity } from "../../../../../lib/auth/request-integrity";
import { controlJson, JSON_BODY_TOO_LARGE, readJsonObject, repositoryFailure } from "../../../../../lib/http/control-response";
import { createRepositoryServices } from "../../../../../lib/repositories";
import { GoogleTrainingDraftProvider } from "../../../../../lib/training/google-draft-provider";
import {
  runTrainingMvp,
  type TrainingSourceRow,
  type WaitingReviewRepository,
} from "../../../../../lib/training/mvp";

const MAX_ROWS = 10_000;
const MAX_REQUEST_BYTES = 3 * 1024 * 1024;

function rowsFrom(value: unknown): TrainingSourceRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROWS) return null;
  const rows: TrainingSourceRow[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const expression = typeof row.expression === "string" ? row.expression : row.keyword;
    if (typeof expression !== "string" || !expression.trim() || expression.length > 500) return null;
    rows.push({
      id: typeof row.id === "string" && row.id ? row.id.slice(0, 200) : `row-${index + 1}`,
      expression,
      root: typeof row.root === "string" ? row.root.slice(0, 500) : null,
      category: typeof row.category === "string" ? row.category.slice(0, 200) : null,
      sourceRow: typeof row.sourceRow === "number" && Number.isInteger(row.sourceRow) ? row.sourceRow : index + 2,
      flags: Array.isArray(row.flags) ? row.flags.filter((flag): flag is string => typeof flag === "string").slice(0, 12) : [],
    });
  }
  return rows;
}

export async function POST(request: Request) {
  const denied = await requireApiCapability(request, "training:run");
  if (denied) return denied;
  const integrityFailure = await requireMutationIntegrity(request);
  if (integrityFailure) return integrityFailure;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return controlJson({ error: "training_payload_too_large", message: "한 실행은 10,000행과 3MiB 이하만 지원합니다." }, 413);
  }
  const body = await readJsonObject(request, MAX_REQUEST_BYTES);
  if (body === JSON_BODY_TOO_LARGE) {
    return controlJson({ error: "training_payload_too_large", message: "한 실행은 10,000행과 3MiB 이하만 지원합니다." }, 413);
  }
  const rows = rowsFrom(body?.rows);
  const datasetVersionId = typeof body?.datasetVersionId === "string" && body.datasetVersionId.trim()
    ? body.datasetVersionId.trim().slice(0, 200)
    : null;
  const sourceSha256 = typeof body?.sourceSha256 === "string" && /^[a-f0-9]{64}$/u.test(body.sourceSha256)
    ? body.sourceSha256
    : null;
  if (!rows || !datasetVersionId || !sourceSha256) {
    return controlJson({ error: "invalid_training_input", message: "검증된 dataset version, SHA-256과 1~10,000개 expression 행이 필요합니다." }, 400);
  }

  const repositories = await createRepositoryServices({ request });
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
  const waitingReviewRepository: WaitingReviewRepository | undefined = draftProvider.configured && repositories.developmentFixture
    ? {
        configured: true,
        async saveWaitingReview(candidates, _context, signal) {
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
            autoInclusionBlockedReason: "pipeline 후보는 관리자 승인 전 active skill로 편입되지 않습니다.",
          })));
          if (result.status !== "ready") throw Object.assign(new Error(result.code), { code: result.code });
          return { savedCandidateIds: [...result.data.savedIds] };
        },
      }
    : undefined;

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

  return controlJson({
    acknowledged: true,
    providerConfigured: draftProvider.configured,
    candidatePersistenceConfigured: Boolean(waitingReviewRepository),
    result,
  });
}
