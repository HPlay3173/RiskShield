import { TrainingConsole } from "../../../components/developer/TrainingConsole";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";
import { GEMMA_LIVE_PILOT_MODEL } from "../../../lib/v0-4/google-genai-provider";
import { INTERPRETER_PROMPT_VERSION, INTERPRETER_SCHEMA_VERSION } from "../../../lib/v0-4/interpreter";

export default async function ManageTrainingPage() {
  const { principal, presentation, repositories } = await protectedProductPage("/manage/training", "training:run");
  const [runs, datasets, versions] = await Promise.all([
    repositories.training.listRuns(),
    repositories.datasets.list(),
    repositories.datasets.listVersions(),
  ]);
  const datasetVersions = datasets.status === "ready" && versions.status === "ready"
    ? versions.data.items.flatMap((version) => {
      const dataset = datasets.data.items.find((item) => item.id === version.datasetId);
      return dataset && ["staging", "ready"].includes(dataset.status)
        ? [{ id: version.id, name: `${dataset.name} · v${version.versionNumber}`, sha256: version.sha256, status: dataset.status }]
        : [];
    })
    : [];
  const runnerAvailable = runs.status === "ready" && datasets.status === "ready" && versions.status === "ready";
  const configurationMessage = runnerAvailable
    ? null
    : "D1 관리 migration을 적용한 뒤 데이터셋 등록과 학습 실행을 사용할 수 있습니다.";

  return (
    <DeveloperShell
      currentHref="/manage/training"
      principal={presentation}
      title="후보 생성"
      description="등록한 자료에서 겹치는 표현을 정리하고, 새 위험 표현 후보만 사람의 검토함으로 보냅니다."
    >
      <TrainingConsole
        endpoint="/api/manage/training/run"
        csrfToken={principal.csrfToken}
        developmentFixture={repositories.developmentFixture}
        runnerAvailable={runnerAvailable}
        datasetVersions={datasetVersions}
        configurationMessage={configurationMessage}
        model={{
          selectedId: "gemma-current",
          options: [{
            id: "gemma-current",
            label: "Gemma Interpreter",
            version: GEMMA_LIVE_PILOT_MODEL,
            configured: true,
            active: true,
            description: "server secret이 있을 때만 실제 draft를 생성합니다.",
          }],
        }}
        prompt={{
          selectedId: "interpreter-current",
          options: [{
            id: "interpreter-current",
            label: "RiskShield review draft",
            version: INTERPRETER_PROMPT_VERSION,
            configured: true,
            active: true,
            description: "CSV 표현은 명령이 아닌 신뢰하지 않는 입력 데이터로 처리합니다.",
          }],
        }}
        schema={{
          selectedId: "schema-current",
          options: [{
            id: "schema-current",
            label: "Interpreter Schema",
            version: INTERPRETER_SCHEMA_VERSION,
            configured: true,
            active: true,
            description: "엄격한 function-call draft 계약을 사용합니다.",
          }],
        }}
      />
    </DeveloperShell>
  );
}
