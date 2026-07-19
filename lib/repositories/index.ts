import {
  developmentPrincipalForHost,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../auth/dev-principal.ts";
import {
  getAuthRuntime,
  type AuthRuntime,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../auth/runtime.ts";
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
  configurationRequired,
  ready,
  type AuditRepository,
  type CandidateRepository,
  type DatasetRepository,
  type EvaluationRepository,
  type ModelRecord,
  type ModelRepository,
  type RepositoryServices,
  type TrainingRepository,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./contracts.ts";
import {
  D1AnalyzerService,
  D1PrincipalRepository,
  D1SkillRepository,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./d1.ts";

type RepositoryFactoryContext = {
  request?: Request;
  host?: string | null;
  runtime?: AuthRuntime;
  nodeEnv?: string;
};

const currentModel: ModelRecord = {
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

function configuration<T>(area: string, missing: readonly string[]) {
  return configurationRequired<T>(
    `${area}_configuration_required`,
    `${area} backend가 구성되지 않았습니다.`,
    missing,
  );
}

function unconfiguredCandidates(): CandidateRepository {
  return {
    list: async () => configuration("candidate", ["skill_candidates migration"]),
    getById: async () => configuration("candidate", ["skill_candidates migration"]),
    decide: async () => configuration("candidate", ["skill_candidates migration", "candidate decision audit"]),
    saveGenerated: async () => configuration("candidate", ["skill_candidates migration", "candidate lineage"]),
  };
}

function unconfiguredDatasets(): DatasetRepository {
  return {
    list: async () => configuration("dataset", ["datasets migration", "dataset_versions migration", "R2"]),
    getById: async () => configuration("dataset", ["datasets migration", "dataset_versions migration", "R2"]),
    register: async () => configuration("dataset", ["datasets migration", "dataset_versions migration", "R2"]),
  };
}

function unconfiguredTraining(): TrainingRepository {
  return {
    listRuns: async () => configuration("training", ["pipeline_runs migration", "local or external runner"]),
    getRun: async () => configuration("training", ["pipeline_runs migration", "local or external runner"]),
  };
}

function unconfiguredEvaluation(): EvaluationRepository {
  return {
    listRuns: async () => configuration("evaluation", ["evaluation_runs migration", "evaluation result manifest"]),
    getRun: async () => configuration("evaluation", ["evaluation_runs migration", "evaluation result manifest"]),
  };
}

function codeModels(): ModelRepository {
  return {
    list: async () => ready({ items: [currentModel], nextCursor: null }, "code"),
    getActive: async () => ready(currentModel, "code"),
  };
}

function unconfiguredAudit(): AuditRepository {
  return {
    list: async () => configuration("audit", ["audit_logs migration"]),
  };
}

function serverHost(context: RepositoryFactoryContext) {
  if (context.request) return new URL(context.request.url).host;
  return context.host ?? null;
}

export async function createRepositoryServices(
  context: RepositoryFactoryContext = {},
): Promise<RepositoryServices> {
  if (typeof window !== "undefined") {
    throw new Error("repository_factory_server_only");
  }

  let runtime = context.runtime;
  if (!runtime) {
    try {
      runtime = await getAuthRuntime();
    } catch {
      runtime = {};
    }
  }

  const developmentPrincipal = developmentPrincipalForHost({
    runtime,
    host: serverHost(context),
    nodeEnv: context.nodeEnv,
  });
  if (developmentPrincipal) {
    // @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
    const { createLocalRepositoryServices } = await import("./local.ts");
    return createLocalRepositoryServices(developmentPrincipal);
  }

  const skills = new D1SkillRepository(runtime.DB);
  return {
    analyzer: new D1AnalyzerService(skills),
    skills,
    candidates: unconfiguredCandidates(),
    datasets: unconfiguredDatasets(),
    training: unconfiguredTraining(),
    evaluation: unconfiguredEvaluation(),
    models: codeModels(),
    audit: unconfiguredAudit(),
    principals: new D1PrincipalRepository(runtime.DB),
    developmentFixture: false,
  };
}

export type {
  AnalyzerService,
  AuditRepository,
  CandidateRepository,
  DatasetRepository,
  EvaluationRepository,
  ModelRepository,
  PrincipalRepository,
  RepositoryResult,
  RepositoryServices,
  SkillRepository,
  TrainingRepository,
  CandidateDecisionAcknowledgement,
  CandidateDecisionInput,
  DatasetRegistrationAcknowledgement,
  DatasetRegistrationInput,
  SkillRevisionAcknowledgement,
  SkillRevisionInput,
  GeneratedCandidateRecordInput,
} from "./contracts.ts";
