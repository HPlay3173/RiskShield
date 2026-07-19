import type {
  CurrentPrincipal,
  Role,
} from "../auth/current-principal.ts";
import type {
  AnalysisResult,
  ReviewStatus,
  RiskSkill,
  SeverityRules,
} from "../riskshield.ts";
import type {
  SessionClaims,
} from "../auth/session.ts";

export type RepositorySource = "d1" | "local_fixture" | "local_file" | "code";

export type RepositoryResult<T> =
  | {
      status: "ready";
      data: T;
      source: RepositorySource;
      fixture: boolean;
      label?: string;
    }
  | {
      status: "unavailable";
      code: string;
      message: string;
    }
  | {
      status: "configuration_required";
      code: string;
      message: string;
      missing: readonly string[];
    };

export function ready<T>(
  data: T,
  source: RepositorySource,
  options: { fixture?: boolean; label?: string } = {},
): RepositoryResult<T> {
  return {
    status: "ready",
    data,
    source,
    fixture: options.fixture ?? false,
    ...(options.label ? { label: options.label } : {}),
  };
}

export function unavailable<T>(code: string, message: string): RepositoryResult<T> {
  return { status: "unavailable", code, message };
}

export function configurationRequired<T>(
  code: string,
  message: string,
  missing: readonly string[],
): RepositoryResult<T> {
  return { status: "configuration_required", code, message, missing };
}

export type RepositoryPage<T> = {
  items: readonly T[];
  nextCursor: string | null;
};

export type SkillAdminRecord = {
  id: string;
  category: string;
  reviewStatus: ReviewStatus | "invalid";
  severityFloor: number;
  dominantRisk: boolean;
  revision: number | null;
  updatedAt: string;
  active: boolean | null;
  sourceCount: number | null;
  payload: RiskSkill | null;
  skill: RiskSkill | null;
  validationIssues: readonly string[];
};

export type CandidateRecord = {
  id: string;
  expression: string;
  riskDomain: string;
  status: "pending" | "approved" | "merged" | "held" | "rejected";
  noveltyScore: number | null;
  confidence: number | null;
  sourceCount: number | null;
  createdAt: string;
  expressionGroup?: readonly string[];
  contextSummary?: string | null;
  usageDistribution?: {
    direct: number | null;
    quoted: number | null;
    critical: number | null;
    satire: number | null;
    selfDirected: number | null;
  };
  target?: string | null;
  similarity?: number | null;
  skillDiff?: string | null;
  sources?: readonly {
    title: string;
    url: string;
    date: string;
  }[];
  evidence?: readonly string[];
  positiveTests?: readonly string[];
  negativeTests?: readonly string[];
  redTeam?: string | null;
  modelConflict?: boolean | null;
  policyChange?: boolean | null;
  autoInclusionBlockedReason?: string | null;
};

export type CandidateDecisionInput = {
  candidateId: string;
  decision: "approve" | "approve_with_edits" | "merge" | "hold" | "reject";
  note: string | null;
  mergeSkillId: string | null;
  actorId: string;
};

export type CandidateDecisionAcknowledgement = {
  decisionId: string;
  candidateStatus: CandidateRecord["status"];
  message: string;
  persisted: boolean;
};

export type GeneratedCandidateRecordInput = Omit<
  CandidateRecord,
  "status" | "createdAt"
> & {
  createdAt?: string;
};

export type SkillRevisionInput = {
  skillId: string;
  baseRevision: number;
  summary: string;
  rationale: string;
  proposedPayload: Record<string, unknown>;
  actorId: string;
};

export type SkillRevisionAcknowledgement = {
  revisionId: string;
  proposedRevision: number;
  message: string;
  persisted: boolean;
};

export type DatasetRecord = {
  id: string;
  name: string;
  sourceKind: "csv" | "connector" | "unknown";
  status: "staging" | "ready" | "invalid" | "unavailable";
  versionCount: number | null;
  latestSha256: string | null;
  updatedAt: string | null;
  owner?: string | null;
  license?: string | null;
  allowedPurpose?: string | null;
  retention?: string | null;
};

export type DatasetRegistrationInput = {
  name: string;
  sha256: string;
  byteSize: number;
  rowCount: number;
  encoding: "utf-8";
  delimiter: string;
  headers: readonly string[];
  keywordColumn: string;
  owner: string;
  license: string;
  allowedPurpose: string;
  retention: string;
  actorId: string;
};

export type DatasetRegistrationAcknowledgement = {
  datasetId: string;
  versionId: string;
  status: "staging";
  message: string;
  persisted: boolean;
};

export type TrainingRunStatus =
  | "not_configured"
  | "queued"
  | "running"
  | "waiting_review"
  | "succeeded"
  | "degraded"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export type TrainingRunRecord = {
  id: string;
  datasetVersionId: string | null;
  status: TrainingRunStatus;
  currentStage: string | null;
  itemCount: number | null;
  warningCount: number | null;
  estimatedCost: number | null;
  latencyMs: number | null;
  updatedAt: string | null;
};

export type EvaluationRunRecord = {
  id: string;
  codeSha: string;
  modelVersion: string;
  promptVersion: string;
  schemaVersion: string;
  datasetVersion: string | null;
  testCount: number;
  passed: number;
  failed: number;
  status: "passed" | "failed" | "running" | "unavailable";
  measuredAt: string | null;
};

export type ModelRecord = {
  id: string;
  provider: string;
  modelName: string;
  promptVersion: string;
  schemaVersion: string;
  timeoutMs: number;
  maxRetryCount: number;
  status: "active" | "candidate" | "disabled";
};

export type AuditRecord = {
  id: string;
  occurredAt: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  result: "succeeded" | "denied" | "failed";
};

export type PrincipalRecord = {
  id: string;
  identityProvider: "google" | "development_fixture" | "unknown";
  externalSubject: string;
  normalizedEmail: string;
  role: Role | "invalid";
  status: "active" | "disabled" | "invalid";
  roleVersion: number;
  sessionNotBefore: string | null;
  updatedAt: string | null;
};

export interface AnalyzerService {
  analyze(text: string): Promise<RepositoryResult<AnalysisResult>>;
}

export interface SkillRepository {
  listReviewed(): Promise<RepositoryResult<readonly RiskSkill[]>>;
  readSeverityRules(): Promise<RepositoryResult<SeverityRules>>;
  listAdmin(input?: { limit?: number; cursor?: string }): Promise<RepositoryResult<RepositoryPage<SkillAdminRecord>>>;
  getById(id: string): Promise<RepositoryResult<SkillAdminRecord | null>>;
  proposeRevision(input: SkillRevisionInput): Promise<RepositoryResult<SkillRevisionAcknowledgement>>;
}

export interface CandidateRepository {
  list(): Promise<RepositoryResult<RepositoryPage<CandidateRecord>>>;
  getById(id: string): Promise<RepositoryResult<CandidateRecord | null>>;
  decide(input: CandidateDecisionInput): Promise<RepositoryResult<CandidateDecisionAcknowledgement>>;
  saveGenerated(records: readonly GeneratedCandidateRecordInput[]): Promise<RepositoryResult<{ savedIds: readonly string[] }>>;
}

export interface DatasetRepository {
  list(): Promise<RepositoryResult<RepositoryPage<DatasetRecord>>>;
  getById(id: string): Promise<RepositoryResult<DatasetRecord | null>>;
  register(input: DatasetRegistrationInput): Promise<RepositoryResult<DatasetRegistrationAcknowledgement>>;
}

export interface TrainingRepository {
  listRuns(): Promise<RepositoryResult<RepositoryPage<TrainingRunRecord>>>;
  getRun(id: string): Promise<RepositoryResult<TrainingRunRecord | null>>;
}

export interface EvaluationRepository {
  listRuns(): Promise<RepositoryResult<RepositoryPage<EvaluationRunRecord>>>;
  getRun(id: string): Promise<RepositoryResult<EvaluationRunRecord | null>>;
}

export interface ModelRepository {
  list(): Promise<RepositoryResult<RepositoryPage<ModelRecord>>>;
  getActive(): Promise<RepositoryResult<ModelRecord | null>>;
}

export interface AuditRepository {
  list(): Promise<RepositoryResult<RepositoryPage<AuditRecord>>>;
}

export interface PrincipalRepository {
  list(): Promise<RepositoryResult<RepositoryPage<PrincipalRecord>>>;
  findForGoogleIdentity(identity: {
    subject: string;
    email: string;
  }): Promise<RepositoryResult<PrincipalRecord | null>>;
  resolveSession(session: SessionClaims): Promise<RepositoryResult<CurrentPrincipal | null>>;
}

export type RepositoryServices = {
  analyzer: AnalyzerService;
  skills: SkillRepository;
  candidates: CandidateRepository;
  datasets: DatasetRepository;
  training: TrainingRepository;
  evaluation: EvaluationRepository;
  models: ModelRepository;
  audit: AuditRepository;
  principals: PrincipalRepository;
  developmentFixture: boolean;
  label?: string;
};
