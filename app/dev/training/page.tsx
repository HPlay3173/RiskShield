import { TrainingConsole } from "../../../components/developer/TrainingConsole";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";
import { GEMMA_LIVE_PILOT_MODEL } from "../../../lib/v0-4/google-genai-provider";
import { INTERPRETER_PROMPT_VERSION, INTERPRETER_SCHEMA_VERSION } from "../../../lib/v0-4/interpreter";

export default async function TrainingPage() {
  const { principal, presentation, repositories } = await protectedProductPage("/dev/training", "training:run");
  const [runs, datasets] = await Promise.all([
    repositories.training.listRuns(),
    repositories.datasets.list(),
  ]);
  const datasetVersions = datasets.status === "ready"
    ? datasets.data.items.flatMap((dataset) => dataset.latestSha256 && dataset.versionCount && ["staging", "ready"].includes(dataset.status)
      ? [{
          id: `${dataset.id}_v${dataset.versionCount}`,
          name: dataset.name,
          sha256: dataset.latestSha256,
          status: dataset.status,
        }]
      : [])
    : [];
  const configurationMessage = runs.status === "configuration_required"
    ? "Production pipeline runner와 run 저장소가 구성되지 않아 실행이 비활성입니다. 명시적 개발 fixture에서만 요청 단위 runner를 사용합니다."
    : null;
  return (
    <DeveloperShell currentHref="/dev/training" principal={presentation} title="Training Pipeline" description="Cleaner부터 Review Inbox까지 실행 가능한 MVP를 사용합니다. Provider와 저장소가 없으면 해당 단계를 완료된 것처럼 표시하지 않습니다.">
      <TrainingConsole
        endpoint="/api/dev/training/run"
        csrfToken={principal.csrfToken}
        developmentFixture={repositories.developmentFixture}
        runnerAvailable={repositories.developmentFixture}
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
            description: "코드 설정은 선택 가능하며 실제 LLM draft는 server secret이 있을 때만 실행됩니다.",
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
            description: "입력 표현은 명령이 아닌 untrusted data로 취급합니다.",
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
