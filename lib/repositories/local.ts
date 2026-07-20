import {
  DEVELOPMENT_PRINCIPAL_LABEL,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../auth/dev-principal.ts";
import type {
  CurrentPrincipal,
} from "../auth/current-principal.ts";
import {
  GEMMA_LIVE_PILOT_MODEL,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../v0-4/google-genai-provider.ts";
import {
  HIGH_CONFIDENCE_THRESHOLD,
  INTERPRETER_PROMPT_VERSION,
  INTERPRETER_SCHEMA_VERSION,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../v0-4/interpreter.ts";
import {
  DEFAULT_SEVERITY_RULES,
  analyzeText,
  starterSkills,
  validateSkill,
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../riskshield.ts";
import {
  candidateSkillsV03,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../v0-3-candidate-skills.ts";
import {
  ready,
  type AnalyzerService,
  type AuditRecord,
  type AuditRepository,
  type CandidateRecord,
  type CandidateDecisionAcknowledgement,
  type CandidateDecisionInput,
  type CandidateRepository,
  type DatasetRecord,
  type DatasetRegistrationAcknowledgement,
  type DatasetRegistrationInput,
  type DatasetRepository,
  type EvaluationRepository,
  type EvaluationRunRecord,
  type ModelRecord,
  type ModelRepository,
  type GeneratedCandidateRecordInput,
  type PrincipalRecord,
  type PrincipalRepository,
  type RepositoryPage,
  type RepositoryServices,
  type SkillAdminRecord,
  type SkillRepository,
  type SkillRevisionAcknowledgement,
  type SkillRevisionInput,
  type TrainingRepository,
  type TrainingRunRecord,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./contracts.ts";
import {
  VERIFIED_REPOSITORY_TEST_RUN,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../evaluation/verified-run.ts";

const fixtureOptions = { fixture: true, label: DEVELOPMENT_PRINCIPAL_LABEL } as const;
const localRevisionProposals = new Map<string, SkillRevisionInput>();
const localDatasets = new Map<string, DatasetRecord>();
const localCandidateStatuses = new Map<string, CandidateRecord["status"]>();
const localGeneratedCandidates = new Map<string, CandidateRecord>();
const localCandidateDecisions = new Map<
  string,
  CandidateDecisionInput & { candidateStatus: CandidateRecord["status"] }
>();
const localTrainingRuns = new Map<string, TrainingRunRecord>();
const localAuditRecords: AuditRecord[] = [];
let localCandidateDecisionSequence = 1;

function page<T>(items: readonly T[]): RepositoryPage<T> {
  return { items, nextCursor: null };
}

function adminRecord(skill: RiskSkill): SkillAdminRecord {
  const validationIssues = validateSkill(skill);
  return {
    id: skill.id,
    category: skill.category,
    reviewStatus: skill.reviewStatus,
    severityFloor: skill.severityFloor,
    dominantRisk: skill.dominantRisk,
    revision: skill.revision,
    updatedAt: skill.updatedAt,
    active: null,
    sourceCount: skill.source ? 1 : null,
    payload: validationIssues.length === 0 ? skill : null,
    skill: validationIssues.length === 0 ? skill : null,
    validationIssues,
  };
}

export class LocalSkillRepository implements SkillRepository {
  private readonly skills: readonly RiskSkill[];

  constructor(skills: readonly RiskSkill[] = starterSkills) {
    this.skills = skills;
  }

  async listReviewed() {
    return ready(
      this.skills.filter((skill) => skill.reviewStatus === "reviewed" && validateSkill(skill).length === 0),
      "local_fixture",
      fixtureOptions,
    );
  }

  async readSeverityRules() {
    return ready(DEFAULT_SEVERITY_RULES, "local_fixture", fixtureOptions);
  }

  async listAdmin(input: { limit?: number; cursor?: string } = {}) {
    const offset = Math.max(0, Number.parseInt(input.cursor ?? "0", 10) || 0);
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const records = this.skills.map(adminRecord);
    const items = records.slice(offset, offset + limit);
    const nextCursor = offset + items.length < records.length ? String(offset + items.length) : null;
    return ready({ items, nextCursor }, "local_fixture", fixtureOptions);
  }

  async getById(id: string) {
    const skill = this.skills.find((candidate) => candidate.id === id);
    return ready(skill ? adminRecord(skill) : null, "local_fixture", fixtureOptions);
  }


  async proposeRevision(input: SkillRevisionInput) {
    const current = this.skills.find((skill) => skill.id === input.skillId);
    if (!current || current.revision !== input.baseRevision) {
      return ready<SkillRevisionAcknowledgement>({
        revisionId: `local_revision_rejected_${input.skillId}`,
        proposedRevision: input.baseRevision + 1,
        message: "기준 revision이 현재 개발 fixture와 일치하지 않아 저장하지 않았습니다.",
        persisted: false,
      }, "local_fixture", fixtureOptions);
    }
    const acknowledgement: SkillRevisionAcknowledgement = {
      revisionId: `local_revision_${input.skillId}_${input.baseRevision + 1}`,
      proposedRevision: input.baseRevision + 1,
      message: "개발 fixture revision 제안을 메모리 저장소에 기록했습니다. production에는 반영되지 않습니다.",
      persisted: true,
    };
    localRevisionProposals.set(acknowledgement.revisionId, { ...input });
    return ready(acknowledgement, "local_fixture", fixtureOptions);
  }
}

export class RepositoryAnalyzerService implements AnalyzerService {
  private readonly skills: SkillRepository;

  constructor(skills: SkillRepository) {
    this.skills = skills;
  }

  async analyze(text: string) {
    const [skillResult, severityResult] = await Promise.all([
      this.skills.listReviewed(),
      this.skills.readSeverityRules(),
    ]);
    if (skillResult.status !== "ready") return skillResult;
    if (severityResult.status !== "ready") return severityResult;
    return ready(
      analyzeText(text, [...skillResult.data], { severityRules: severityResult.data }),
      skillResult.source,
      { fixture: skillResult.fixture, label: skillResult.label },
    );
  }
}

export class LocalCandidateRepository implements CandidateRepository {
  private readonly records: CandidateRecord[];

  constructor(skills: readonly RiskSkill[] = candidateSkillsV03) {
    this.records = skills.map((skill) => ({
      id: skill.id,
      expression: skill.surfaceMeaning,
      riskDomain: skill.riskDomain,
      status: localCandidateStatuses.get(skill.id) ?? "pending",
      noveltyScore: null,
      confidence: skill.confidence,
      sourceCount: skill.source ? 1 : null,
      createdAt: skill.createdAt,
      expressionGroup: [skill.surfaceMeaning, ...skill.triggerPatterns],
      contextSummary: skill.socialContext,
      similarity: null,
      skillDiff: null,
      sources: skill.source ? [{
        title: skill.source.title,
        url: skill.source.url,
        date: skill.source.date,
      }] : undefined,
      modelConflict: null,
      policyChange: null,
      autoInclusionBlockedReason: "개발 fixture는 자동 편입되지 않으며 사람 검토가 필요합니다.",
    }));
  }

  async list() {
    return ready(page([...this.records, ...localGeneratedCandidates.values()]), "local_fixture", fixtureOptions);
  }

  async getById(id: string) {
    return ready(this.records.find((record) => record.id === id) ?? localGeneratedCandidates.get(id) ?? null, "local_fixture", fixtureOptions);
  }


  async decide(input: CandidateDecisionInput) {
    const record = this.records.find((candidate) => candidate.id === input.candidateId)
      ?? localGeneratedCandidates.get(input.candidateId);
    if (!record) {
      return ready<CandidateDecisionAcknowledgement>({
        decisionId: `local_decision_missing_${input.candidateId}`,
        candidateStatus: "pending",
        message: "개발 후보를 찾지 못해 결정이 저장되지 않았습니다.",
        persisted: false,
      }, "local_fixture", fixtureOptions);
    }
    const candidateStatus: CandidateRecord["status"] = input.decision === "hold"
      ? "held"
      : input.decision === "reject"
        ? "rejected"
        : input.decision === "merge"
          ? "merged"
          : "approved";
    record.status = candidateStatus;
    localCandidateStatuses.set(input.candidateId, candidateStatus);
    const acknowledgement: CandidateDecisionAcknowledgement = {
      decisionId: `local_decision_${input.candidateId}_${localCandidateDecisionSequence++}`,
      candidateStatus,
      message: "개발 fixture 결정을 메모리 저장소에 기록했습니다. production에는 반영되지 않습니다.",
      persisted: true,
    };
    localCandidateDecisions.set(acknowledgement.decisionId, { ...input, candidateStatus });
    return ready(acknowledgement, "local_fixture", fixtureOptions);
  }


  async saveGenerated(records: readonly GeneratedCandidateRecordInput[]) {
    const savedIds: string[] = [];
    for (const input of records) {
      const record: CandidateRecord = {
        ...input,
        status: localCandidateStatuses.get(input.id) ?? "pending",
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      localGeneratedCandidates.set(record.id, record);
      savedIds.push(record.id);
    }
    return ready({ savedIds }, "local_fixture", fixtureOptions);
  }
}

class LocalCollectionRepository<T extends { id: string }> {
  protected readonly records: readonly T[];

  constructor(records: readonly T[]) {
    this.records = records;
  }

  protected listRecords() {
    return ready(page(this.records), "local_fixture", fixtureOptions);
  }

  protected recordById(id: string) {
    return ready(this.records.find((record) => record.id === id) ?? null, "local_fixture", fixtureOptions);
  }
}

export class LocalDatasetRepository implements DatasetRepository {
  async list() {
    return ready(page([...localDatasets.values()]), "local_fixture", fixtureOptions);
  }

  async getById(id: string) {
    return ready(localDatasets.get(id) ?? null, "local_fixture", fixtureOptions);
  }

  async register(input: DatasetRegistrationInput) {
    const datasetId = `local_dataset_${input.sha256.slice(0, 12)}`;
    const current = localDatasets.get(datasetId);
    const record: DatasetRecord = {
      id: datasetId,
      name: input.name,
      sourceKind: "csv",
      status: "staging",
      versionCount: current ? (current.versionCount ?? 0) + 1 : 1,
      latestSha256: input.sha256,
      latestKeywordColumn: input.keywordColumn,
      updatedAt: new Date().toISOString(),
      owner: input.owner,
      license: input.license,
      allowedPurpose: input.allowedPurpose,
      retention: input.retention,
    };
    localDatasets.set(datasetId, record);
    return ready<DatasetRegistrationAcknowledgement>({
      datasetId,
      versionId: `${datasetId}_v${record.versionCount}`,
      status: "staging",
      message: "개발 fixture에 metadata와 검증 결과만 등록했습니다. 원본 파일은 저장하거나 변경하지 않았습니다.",
      persisted: true,
    }, "local_fixture", fixtureOptions);
  }
}

export class LocalTrainingRepository extends LocalCollectionRepository<TrainingRunRecord> implements TrainingRepository {
  constructor(records: readonly TrainingRunRecord[] = []) {
    super(records);
  }

  async listRuns() {
    return ready(page([...this.records, ...localTrainingRuns.values()]), "local_fixture", fixtureOptions);
  }
  async getRun(id: string) {
    return ready(localTrainingRuns.get(id) ?? this.records.find((record) => record.id === id) ?? null, "local_fixture", fixtureOptions);
  }
  async saveRun(record: TrainingRunRecord, actorId: string) {
    localTrainingRuns.set(record.id, { ...record });
    localAuditRecords.unshift({
      id: `local_audit_training_${record.id}`,
      occurredAt: new Date().toISOString(),
      actorId,
      action: "training.run.saved",
      resourceType: "training_run",
      resourceId: record.id,
      result: "succeeded",
    });
    return ready({ persisted: true }, "local_fixture", fixtureOptions);
  }
}

export class LocalEvaluationRepository extends LocalCollectionRepository<EvaluationRunRecord> implements EvaluationRepository {
  constructor(records: readonly EvaluationRunRecord[] = []) {
    super(records);
  }

  async listRuns() { return this.listRecords(); }
  async getRun(id: string) { return this.recordById(id); }
}

const CURRENT_MODEL: ModelRecord = {
  id: "riskshield-interpreter-current",
  provider: "google-genai-native-rest",
  modelName: GEMMA_LIVE_PILOT_MODEL,
  promptVersion: INTERPRETER_PROMPT_VERSION,
  schemaVersion: INTERPRETER_SCHEMA_VERSION,
  timeoutMs: 15_000,
  maxRetryCount: 1,
  confidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
  scoreThreshold: 80,
  profiles: ["balanced", "advertising", "context"],
  candidateVersion: null,
  evaluationStatus: "not_run",
  status: "active",
};

export class LocalModelRepository implements ModelRepository {
  async list() {
    return ready(page([CURRENT_MODEL]), "code", fixtureOptions);
  }

  async getActive() {
    return ready(CURRENT_MODEL, "code", fixtureOptions);
  }
}

export class LocalAuditRepository implements AuditRepository {
  private readonly records: readonly AuditRecord[];

  constructor(records: readonly AuditRecord[] = []) {
    this.records = records;
  }

  async list() {
    return ready(page([...localAuditRecords, ...this.records]), "local_fixture", fixtureOptions);
  }
}

export class LocalPrincipalRepository implements PrincipalRepository {
  private readonly record: PrincipalRecord;
  private readonly principal: CurrentPrincipal;

  constructor(principal: CurrentPrincipal) {
    this.principal = principal;
    this.record = {
      id: principal.userId,
      identityProvider: "development_fixture",
      externalSubject: principal.externalSubject,
      normalizedEmail: principal.normalizedEmail,
      role: principal.role,
      status: "active",
      roleVersion: principal.roleVersion,
      sessionNotBefore: null,
      updatedAt: null,
    };
  }

  async list() {
    return ready(page([this.record]), "local_fixture", fixtureOptions);
  }

  async findForGoogleIdentity() {
    return ready(null, "local_fixture", fixtureOptions);
  }

  async resolveSession() {
    return ready(this.principal, "local_fixture", fixtureOptions);
  }
}

export function createLocalRepositoryServices(principal: CurrentPrincipal): RepositoryServices {
  const skills = new LocalSkillRepository();
  return {
    analyzer: new RepositoryAnalyzerService(skills),
    skills,
    candidates: new LocalCandidateRepository(),
    datasets: new LocalDatasetRepository(),
    training: new LocalTrainingRepository(),
    evaluation: new LocalEvaluationRepository([VERIFIED_REPOSITORY_TEST_RUN]),
    models: new LocalModelRepository(),
    audit: new LocalAuditRepository(),
    principals: new LocalPrincipalRepository(principal),
    developmentFixture: true,
    label: DEVELOPMENT_PRINCIPAL_LABEL,
  };
}
