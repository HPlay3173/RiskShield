export const TRAINING_STAGE_IDS = [
  "collector",
  "cleaner",
  "cluster",
  "novelty_detector",
  "context_analyst",
  "skill_generator",
  "red_team",
  "confidence_router",
  "feedback_learner",
] as const;

export const TRAINING_RUN_STATES = [
  "not_configured",
  "queued",
  "running",
  "waiting_review",
  "succeeded",
  "degraded",
  "failed",
  "cancel_requested",
  "cancelled",
] as const;

export type TrainingStageId = (typeof TRAINING_STAGE_IDS)[number];
export type TrainingRunState = (typeof TRAINING_RUN_STATES)[number];

export interface TrainingSourceRow {
  id: string;
  expression: string;
  root?: string | null;
  category?: string | null;
  sourceRow?: number;
  flags?: readonly string[];
}

export interface TrainingSkillReference {
  id: string;
  reviewStatus: "draft" | "reviewed" | "rejected";
  category?: string;
  surfaceMeaning?: string;
  triggerPatterns?: readonly string[];
  contextPatterns?: readonly string[];
}

export interface CleanedExpression {
  id: string;
  expression: string;
  normalizedExpression: string;
  root: string | null;
  category: string | null;
  sourceRowIds: string[];
}

export interface ExpressionGroup {
  id: string;
  key: string;
  label: string;
  category: string | null;
  memberIds: string[];
  sourceRowIds: string[];
  representativeExpression: string;
}

export interface SimilarSkill {
  skillId: string;
  score: number;
}

export interface GeneratedCandidateTest {
  id: string;
  type: "positive" | "negative";
  input: string;
  expectedBehavior: "match" | "not_high";
}

export interface TrainingDraft {
  candidateId: string;
  title: string;
  riskSummary: string;
  triggerPatterns: string[];
  contextPatterns: string[];
  safeRewrite: string[];
}

export interface TrainingCandidate {
  id: string;
  status: "pending_review";
  groupId: string;
  representativeExpression: string;
  category: string | null;
  memberCount: number;
  sourceRowIds: string[];
  nearestReviewedSkill: SimilarSkill | null;
  noveltyScore: number;
  draft: TrainingDraft | null;
  tests: GeneratedCandidateTest[];
  warnings: string[];
}

export interface CandidateBatch {
  id: string;
  candidateIds: string[];
}

export interface TrainingDraftBatchRequest {
  runId: string;
  datasetVersionId: string;
  batchId: string;
  candidates: Array<{
    candidateId: string;
    representativeExpression: string;
    category: string | null;
    nearestReviewedSkill: SimilarSkill | null;
    positiveTest: string;
    negativeTest: string;
  }>;
}

export interface TrainingDraftBatchResponse {
  drafts: TrainingDraft[];
}

/**
 * A configured implementation must make the real provider call here. The MVP never
 * substitutes deterministic text for an unavailable LLM response.
 */
export interface TrainingDraftProvider {
  readonly id: string;
  readonly configured: boolean;
  generateBatch(
    request: TrainingDraftBatchRequest,
    signal: AbortSignal,
  ): Promise<TrainingDraftBatchResponse>;
}

export interface WaitingReviewSaveContext {
  runId: string;
  datasetVersionId: string;
  sourceSha256: string;
}

export interface WaitingReviewSaveResult {
  savedCandidateIds: string[];
}

/** A production implementation should make this operation atomic and idempotent. */
export interface WaitingReviewRepository {
  readonly configured: boolean;
  saveWaitingReview(
    candidates: readonly TrainingCandidate[],
    context: WaitingReviewSaveContext,
    signal: AbortSignal,
  ): Promise<WaitingReviewSaveResult>;
}

export interface TrainingStageReport {
  id: TrainingStageId;
  label: string;
  state: TrainingRunState;
  history: TrainingRunState[];
  attempts: number;
  itemCount: number | null;
  warnings: string[];
  errorCode: string | null;
}

export interface TrainingRunMetrics {
  inputRows: number;
  cleanedExpressions: number;
  quarantinedRows: number;
  exactDuplicates: number;
  normalizedDuplicates: number;
  groups: number;
  candidates: number;
  draftedCandidates: number;
  savedCandidates: number;
}

export interface TrainingRunResult {
  runId: string;
  status: TrainingRunState;
  datasetVersionId: string;
  sourceSha256: string;
  stages: TrainingStageReport[];
  cleaned: CleanedExpression[];
  groups: ExpressionGroup[];
  batches: CandidateBatch[];
  candidates: TrainingCandidate[];
  persistedCandidateIds: string[];
  metrics: TrainingRunMetrics;
  errors: string[];
}

export interface TrainingMvpInput {
  datasetVersionId: string;
  sourceSha256: string;
  rows: readonly TrainingSourceRow[];
  skills?: readonly TrainingSkillReference[];
}

export interface TrainingMvpOptions {
  runId?: string;
  batchSize?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  draftProvider?: TrainingDraftProvider;
  waitingReviewRepository?: WaitingReviewRepository;
}

const STAGE_LABELS: Record<TrainingStageId, string> = {
  collector: "Collector",
  cleaner: "Cleaner",
  cluster: "Cluster",
  novelty_detector: "Novelty Detector",
  context_analyst: "Context Analyst",
  skill_generator: "Skill Generator",
  red_team: "Red-Team",
  confidence_router: "Confidence Router",
  feedback_learner: "Feedback Learner",
};

const QUARANTINE_FLAGS = new Set(["formula_candidate", "pii_candidate", "replacement_character"]);

export class RetryableTrainingError extends Error {
  readonly code: string;
  readonly retryable = true;

  constructor(code: string) {
    super(code);
    this.name = "RetryableTrainingError";
    this.code = code;
  }
}

class TrainingCancelledError extends Error {
  constructor() {
    super("training_cancelled");
    this.name = "TrainingCancelledError";
  }
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeTrainingText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, "ko-KR");
}

function assertNotCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new TrainingCancelledError();
}

function stageReports() {
  return TRAINING_STAGE_IDS.map<TrainingStageReport>((id) => ({
    id,
    label: STAGE_LABELS[id],
    state: "queued",
    history: ["queued"],
    attempts: 0,
    itemCount: null,
    warnings: [],
    errorCode: null,
  }));
}

function transition(
  stages: TrainingStageReport[],
  id: TrainingStageId,
  state: TrainingRunState,
  patch: Partial<Pick<TrainingStageReport, "attempts" | "itemCount" | "warnings" | "errorCode">> = {},
) {
  const stage = stages.find((entry) => entry.id === id);
  if (!stage) return;
  stage.state = state;
  if (stage.history.at(-1) !== state) stage.history.push(state);
  if (patch.attempts !== undefined) stage.attempts = patch.attempts;
  if (patch.itemCount !== undefined) stage.itemCount = patch.itemCount;
  if (patch.warnings !== undefined) stage.warnings = [...patch.warnings];
  if (patch.errorCode !== undefined) stage.errorCode = patch.errorCode;
}

interface CleanResult {
  expressions: CleanedExpression[];
  exactDuplicates: number;
  normalizedDuplicates: number;
  quarantinedRows: number;
}

function cleanRows(rows: readonly TrainingSourceRow[], signal: AbortSignal): CleanResult {
  const sorted = rows
    .map((row) => ({
      ...row,
      exact: row.expression.trim(),
      normalized: normalizeTrainingText(row.expression),
    }))
    .sort((left, right) =>
      compareText(left.normalized, right.normalized) ||
      compareText(left.exact, right.exact) ||
      compareText(left.id, right.id),
    );
  const exactKeys = new Set<string>();
  const normalizedOwners = new Map<string, CleanedExpression>();
  let exactDuplicates = 0;
  let normalizedDuplicates = 0;
  let quarantinedRows = 0;

  sorted.forEach((row, index) => {
    if (index % 256 === 0) assertNotCancelled(signal);
    if (
      !row.normalized ||
      row.flags?.some((flag) => QUARANTINE_FLAGS.has(flag))
    ) {
      quarantinedRows += 1;
      return;
    }

    const owner = normalizedOwners.get(row.normalized);
    if (exactKeys.has(row.exact)) {
      exactDuplicates += 1;
      if (owner && !owner.sourceRowIds.includes(row.id)) owner.sourceRowIds.push(row.id);
      return;
    }
    exactKeys.add(row.exact);
    if (owner) {
      normalizedDuplicates += 1;
      if (!owner.sourceRowIds.includes(row.id)) owner.sourceRowIds.push(row.id);
      return;
    }

    normalizedOwners.set(row.normalized, {
      id: `expression_${stableHash(row.normalized)}`,
      expression: row.exact,
      normalizedExpression: row.normalized,
      root: row.root?.trim() || null,
      category: row.category?.trim() || null,
      sourceRowIds: [row.id],
    });
  });

  const expressions = [...normalizedOwners.values()]
    .map((entry) => ({ ...entry, sourceRowIds: [...entry.sourceRowIds].sort(compareText) }))
    .sort((left, right) => compareText(left.id, right.id));
  return { expressions, exactDuplicates, normalizedDuplicates, quarantinedRows };
}

function groupExpressions(expressions: readonly CleanedExpression[], signal: AbortSignal) {
  const grouped = new Map<string, CleanedExpression[]>();
  expressions.forEach((expression, index) => {
    if (index % 256 === 0) assertNotCancelled(signal);
    const root = normalizeTrainingText(expression.root || expression.expression);
    const category = normalizeTrainingText(expression.category || "uncategorized");
    const key = `${category}\u241f${root}`;
    const members = grouped.get(key) ?? [];
    members.push(expression);
    grouped.set(key, members);
  });

  return [...grouped.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map<ExpressionGroup>(([key, members]) => {
      const sortedMembers = [...members].sort((left, right) =>
        compareText(left.normalizedExpression, right.normalizedExpression),
      );
      const sourceRowIds = [...new Set(sortedMembers.flatMap((member) => member.sourceRowIds))].sort(compareText);
      const representative = sortedMembers[0];
      return {
        id: `group_${stableHash(key)}`,
        key,
        label: representative.root || representative.expression,
        category: representative.category,
        memberIds: sortedMembers.map((member) => member.id),
        sourceRowIds,
        representativeExpression: representative.expression,
      };
    });
}

function tokensFor(value: string) {
  const normalized = normalizeTrainingText(value);
  const words = normalized.match(/[\p{L}\p{N}%]+/gu) ?? [];
  const compact = normalized.replace(/\s+/gu, "");
  const bigrams: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    bigrams.push(compact.slice(index, index + 2));
  }
  return new Set([...words, ...bigrams]);
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function nearestReviewedSkill(
  expression: string,
  skills: readonly TrainingSkillReference[],
): SimilarSkill | null {
  const expressionTokens = tokensFor(expression);
  const reviewed = skills
    .filter((skill) => skill.reviewStatus === "reviewed")
    .map((skill) => ({
      skill,
      tokens: tokensFor([
        skill.surfaceMeaning ?? "",
        ...(skill.triggerPatterns ?? []),
        ...(skill.contextPatterns ?? []),
      ].join(" ")),
    }))
    .sort((left, right) => compareText(left.skill.id, right.skill.id));

  let best: SimilarSkill | null = null;
  for (const entry of reviewed) {
    const score = Number(jaccard(expressionTokens, entry.tokens).toFixed(4));
    if (!best || score > best.score || (score === best.score && compareText(entry.skill.id, best.skillId) < 0)) {
      best = { skillId: entry.skill.id, score };
    }
  }
  return best && best.score > 0 ? best : null;
}

function generatedTests(candidateId: string, expression: string): GeneratedCandidateTest[] {
  return [
    {
      id: `test_${stableHash(`${candidateId}:positive`)}`,
      type: "positive",
      input: expression,
      expectedBehavior: "match",
    },
    {
      id: `test_${stableHash(`${candidateId}:negative`)}`,
      type: "negative",
      input: `“${expression}”이라는 표현은 사용하지 마세요.`,
      expectedBehavior: "not_high",
    },
  ];
}

function createCandidates(
  groups: readonly ExpressionGroup[],
  skills: readonly TrainingSkillReference[],
  signal: AbortSignal,
) {
  return groups.map<TrainingCandidate>((group, index) => {
    if (index % 256 === 0) assertNotCancelled(signal);
    const nearest = nearestReviewedSkill(group.representativeExpression, skills);
    const id = `candidate_${stableHash(group.key)}`;
    return {
      id,
      status: "pending_review",
      groupId: group.id,
      representativeExpression: group.representativeExpression,
      category: group.category,
      memberCount: group.memberIds.length,
      sourceRowIds: [...group.sourceRowIds],
      nearestReviewedSkill: nearest,
      noveltyScore: Number((1 - (nearest?.score ?? 0)).toFixed(4)),
      draft: null,
      tests: generatedTests(id, group.representativeExpression),
      warnings: [],
    };
  });
}

function createBatches(candidates: readonly TrainingCandidate[], requestedSize: number) {
  const size = Math.max(1, Math.min(100, Math.floor(requestedSize)));
  const batches: CandidateBatch[] = [];
  for (let index = 0; index < candidates.length; index += size) {
    batches.push({
      id: `batch_${String(batches.length + 1).padStart(4, "0")}`,
      candidateIds: candidates.slice(index, index + size).map((candidate) => candidate.id),
    });
  }
  return batches;
}

function isDraft(value: unknown): value is TrainingDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<TrainingDraft>;
  return (
    typeof draft.candidateId === "string" &&
    typeof draft.title === "string" && draft.title.trim().length > 0 &&
    typeof draft.riskSummary === "string" && draft.riskSummary.trim().length > 0 &&
    Array.isArray(draft.triggerPatterns) && draft.triggerPatterns.every((item) => typeof item === "string") &&
    Array.isArray(draft.contextPatterns) && draft.contextPatterns.every((item) => typeof item === "string") &&
    Array.isArray(draft.safeRewrite) && draft.safeRewrite.every((item) => typeof item === "string")
  );
}

function errorCode(error: unknown, fallback: string) {
  if (error instanceof RetryableTrainingError) return error.code;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return fallback;
}

async function withRetry<T>(
  task: () => Promise<T>,
  maxRetries: number,
  signal: AbortSignal,
  onAttempt: () => void,
) {
  let retry = 0;
  while (true) {
    assertNotCancelled(signal);
    onAttempt();
    try {
      const value = await task();
      assertNotCancelled(signal);
      return value;
    } catch (error) {
      assertNotCancelled(signal);
      if (!(error instanceof RetryableTrainingError) || retry >= maxRetries) throw error;
      retry += 1;
    }
  }
}

function baseMetrics(inputRows: number): TrainingRunMetrics {
  return {
    inputRows,
    cleanedExpressions: 0,
    quarantinedRows: 0,
    exactDuplicates: 0,
    normalizedDuplicates: 0,
    groups: 0,
    candidates: 0,
    draftedCandidates: 0,
    savedCandidates: 0,
  };
}

export async function runTrainingMvp(
  input: TrainingMvpInput,
  options: TrainingMvpOptions = {},
): Promise<TrainingRunResult> {
  const internalController = new AbortController();
  const signal = options.signal ?? internalController.signal;
  const stages = stageReports();
  const runId = options.runId ?? `run_${stableHash(`${input.datasetVersionId}:${input.sourceSha256}`)}`;
  const maxRetries = Math.max(0, Math.min(3, Math.floor(options.maxRetries ?? 1)));
  const metrics = baseMetrics(input.rows.length);
  let activeStage: TrainingStageId = "collector";
  let cleaned: CleanedExpression[] = [];
  let groups: ExpressionGroup[] = [];
  let batches: CandidateBatch[] = [];
  let candidates: TrainingCandidate[] = [];
  let persistedCandidateIds: string[] = [];
  const errors: string[] = [];

  const result = (status: TrainingRunState): TrainingRunResult => ({
    runId,
    status,
    datasetVersionId: input.datasetVersionId,
    sourceSha256: input.sourceSha256,
    stages,
    cleaned,
    groups,
    batches,
    candidates,
    persistedCandidateIds,
    metrics,
    errors,
  });

  try {
    assertNotCancelled(signal);
    transition(stages, "collector", "not_configured", {
      warnings: ["file_import_dataset_version_used"],
      itemCount: input.rows.length,
    });

    activeStage = "cleaner";
    transition(stages, activeStage, "running", { attempts: 1 });
    const clean = cleanRows(input.rows, signal);
    cleaned = clean.expressions;
    metrics.cleanedExpressions = cleaned.length;
    metrics.quarantinedRows = clean.quarantinedRows;
    metrics.exactDuplicates = clean.exactDuplicates;
    metrics.normalizedDuplicates = clean.normalizedDuplicates;
    if (!cleaned.length) {
      transition(stages, activeStage, "failed", {
        itemCount: 0,
        errorCode: "no_clean_expressions",
      });
      errors.push("no_clean_expressions");
      return result("failed");
    }
    transition(stages, activeStage, "succeeded", {
      itemCount: cleaned.length,
      warnings: clean.quarantinedRows ? ["rows_quarantined"] : [],
    });

    activeStage = "cluster";
    transition(stages, activeStage, "running", { attempts: 1 });
    groups = groupExpressions(cleaned, signal);
    metrics.groups = groups.length;
    transition(stages, activeStage, "succeeded", {
      itemCount: groups.length,
      warnings: ["deterministic_expression_grouping"],
    });

    activeStage = "novelty_detector";
    transition(stages, activeStage, "running", { attempts: 1 });
    candidates = createCandidates(groups, input.skills ?? [], signal);
    metrics.candidates = candidates.length;
    batches = createBatches(candidates, options.batchSize ?? 25);
    transition(stages, activeStage, "succeeded", {
      itemCount: candidates.length,
      warnings: ["lexical_similarity_only", "reviewed_skills_only"],
    });

    transition(stages, "context_analyst", "not_configured", {
      itemCount: candidates.length,
      warnings: ["semantic_context_adapter_required"],
    });

    activeStage = "skill_generator";
    const provider = options.draftProvider;
    if (!provider?.configured) {
      candidates.forEach((candidate) => candidate.warnings.push("llm_draft_not_configured"));
      transition(stages, activeStage, "not_configured", {
        itemCount: candidates.length,
        warnings: ["draft_provider_required"],
      });
    } else {
      transition(stages, activeStage, "running");
      let attempts = 0;
      let failures = 0;
      for (const batch of batches) {
        assertNotCancelled(signal);
        const batchCandidates = candidates.filter((candidate) => batch.candidateIds.includes(candidate.id));
        try {
          const response = await withRetry(
            () => provider.generateBatch({
              runId,
              datasetVersionId: input.datasetVersionId,
              batchId: batch.id,
              candidates: batchCandidates.map((candidate) => ({
                candidateId: candidate.id,
                representativeExpression: candidate.representativeExpression,
                category: candidate.category,
                nearestReviewedSkill: candidate.nearestReviewedSkill,
                positiveTest: candidate.tests[0].input,
                negativeTest: candidate.tests[1].input,
              })),
            }, signal),
            maxRetries,
            signal,
            () => { attempts += 1; },
          );
          const drafts = new Map(
            response.drafts.filter(isDraft).map((draft) => [draft.candidateId, draft]),
          );
          for (const candidate of batchCandidates) {
            const draft = drafts.get(candidate.id);
            if (draft) {
              candidate.draft = {
                ...draft,
                triggerPatterns: [...draft.triggerPatterns],
                contextPatterns: [...draft.contextPatterns],
                safeRewrite: [...draft.safeRewrite],
              };
            } else {
              failures += 1;
              candidate.warnings.push("llm_draft_contract_failed");
            }
          }
        } catch (error) {
          assertNotCancelled(signal);
          failures += batchCandidates.length;
          const code = errorCode(error, "draft_provider_failed");
          errors.push(code);
          batchCandidates.forEach((candidate) => candidate.warnings.push(code));
        }
      }
      metrics.draftedCandidates = candidates.filter((candidate) => candidate.draft).length;
      transition(stages, activeStage, failures ? "degraded" : "succeeded", {
        attempts,
        itemCount: metrics.draftedCandidates,
        warnings: failures ? ["drafts_missing_or_invalid"] : [],
        errorCode: failures ? "draft_generation_incomplete" : null,
      });
    }

    activeStage = "red_team";
    transition(stages, activeStage, "running", { attempts: 1 });
    assertNotCancelled(signal);
    transition(stages, activeStage, "succeeded", {
      itemCount: candidates.reduce((sum, candidate) => sum + candidate.tests.length, 0),
      warnings: ["generated_tests_require_human_review"],
    });

    activeStage = "confidence_router";
    const repository = options.waitingReviewRepository;
    if (!repository?.configured) {
      transition(stages, activeStage, "not_configured", {
        itemCount: candidates.length,
        warnings: ["waiting_review_repository_required"],
      });
    } else {
      transition(stages, activeStage, "running");
      let attempts = 0;
      try {
        const saved = await withRetry(
          () => repository.saveWaitingReview(candidates, {
            runId,
            datasetVersionId: input.datasetVersionId,
            sourceSha256: input.sourceSha256,
          }, signal),
          maxRetries,
          signal,
          () => { attempts += 1; },
        );
        const expected = candidates.map((candidate) => candidate.id).sort(compareText);
        const actual = [...new Set(saved.savedCandidateIds)].sort(compareText);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw Object.assign(new Error("candidate_save_incomplete"), { code: "candidate_save_incomplete" });
        }
        persistedCandidateIds = actual;
        metrics.savedCandidates = actual.length;
        transition(stages, activeStage, "waiting_review", {
          attempts,
          itemCount: actual.length,
        });
      } catch (error) {
        assertNotCancelled(signal);
        const code = errorCode(error, "candidate_store_failed");
        errors.push(code);
        transition(stages, activeStage, "failed", {
          attempts,
          itemCount: 0,
          errorCode: code,
        });
        transition(stages, "feedback_learner", "not_configured", {
          warnings: ["feedback_backend_required"],
        });
        return result("failed");
      }
    }

    transition(stages, "feedback_learner", "not_configured", {
      warnings: ["feedback_backend_required"],
    });
    return result(persistedCandidateIds.length ? "waiting_review" : "degraded");
  } catch (error) {
    if (error instanceof TrainingCancelledError || signal.aborted) {
      transition(stages, activeStage, "cancel_requested");
      transition(stages, activeStage, "cancelled");
      return result("cancelled");
    }
    const code = errorCode(error, "training_failed");
    errors.push(code);
    transition(stages, activeStage, "failed", { errorCode: code });
    return result("failed");
  }
}
