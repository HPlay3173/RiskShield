import { ProductDataTable, ProductDefinitionList } from "../../../components/data-display/ProductData";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { Pressable } from "../../../components/interaction/Pressable";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";
import type { ModelRecord } from "../../../lib/repositories/contracts";

const columns = [
  { key: "model", header: "모델", render: (row: ModelRecord) => row.modelName, rowHeader: true },
  { key: "provider", header: "Provider", render: (row: ModelRecord) => row.provider },
  { key: "prompt", header: "Prompt", render: (row: ModelRecord) => row.promptVersion },
  { key: "schema", header: "Schema", render: (row: ModelRecord) => row.schemaVersion },
  { key: "timeout", header: "Timeout", render: (row: ModelRecord) => `${row.timeoutMs.toLocaleString("ko-KR")} ms`, numeric: true },
  { key: "retry", header: "Retry", render: (row: ModelRecord) => row.maxRetryCount, numeric: true },
  { key: "confidence", header: "Confidence", render: (row: ModelRecord) => row.confidenceThreshold === null ? "미설정" : row.confidenceThreshold.toFixed(2), numeric: true },
  { key: "score", header: "Score", render: (row: ModelRecord) => row.scoreThreshold === null ? "미설정" : row.scoreThreshold, numeric: true },
  { key: "evaluation", header: "Evaluation", render: (row: ModelRecord) => row.evaluationStatus },
  { key: "status", header: "상태", render: (row: ModelRecord) => row.status },
] as const;

export default async function ModelsPage() {
  const { presentation, repositories } = await protectedProductPage("/dev/models", "model:manage");
  const result = await repositories.models.list();
  const active = result.status === "ready" ? result.data.items.find((model) => model.status === "active") ?? null : null;

  return (
    <DeveloperShell
      currentHref="/dev/models"
      principal={presentation}
      title="모델·프롬프트"
      description="현재 Interpreter 설정과 candidate version을 비교합니다. 저장과 production 배포는 분리된 action입니다."
    >
      {result.status === "ready" ? (
        <>
          <ProductDataTable caption="코드에 연결된 모델 설정" columns={columns} rows={result.data.items} getRowKey={(row) => row.id} />
          <ProductDefinitionList
            label="Active와 candidate version 설정"
            items={[
              { key: "active", term: "Active version", description: active?.id ?? "제공되지 않음" },
              { key: "candidate", term: "Candidate version", description: active?.candidateVersion ?? "제공되지 않음" },
              { key: "diff", term: "Version diff", description: active?.candidateVersion ? "candidate repository의 diff 필요" : "비교할 candidate가 없습니다." },
              { key: "confidence", term: "Confidence threshold", description: active?.confidenceThreshold === null || active?.confidenceThreshold === undefined ? "미설정" : active.confidenceThreshold.toFixed(2) },
              { key: "score", term: "Score threshold", description: active?.scoreThreshold ?? "미설정" },
              { key: "profiles", term: "Profile 설정", description: active?.profiles.join(" · ") || "제공되지 않음" },
              { key: "evaluation", term: "Evaluation 상태", description: active?.evaluationStatus ?? "unavailable" },
            ]}
          />
          <StatePanel
            state="configuration-required"
            title="Candidate diff와 evaluation gate가 준비되지 않았습니다."
            description="실제 candidate model version과 동일 SHA의 evaluation 결과가 등록되기 전에는 저장과 production 배포를 활성화하지 않습니다."
            compact
          />
          <section className="managementCard" aria-labelledby="model-release-title">
            <h2 id="model-release-title">Version action</h2>
            <p>이 화면의 값은 현재 code-backed read adapter에서 읽었습니다. 쓰기 repository와 검증된 candidate가 없어 변경을 저장하거나 배포할 수 없습니다.</p>
            <div className="decisionBar">
              <Pressable className="secondaryButton" disabled>Candidate 저장</Pressable>
              <Pressable className="primaryButton" disabled>Production 배포</Pressable>
            </div>
            <p className="configurationNote">비활성 이유: model version 저장소, evaluation gate, release adapter가 필요합니다.</p>
          </section>
        </>
      ) : (
        <StatePanel state={result.status === "configuration_required" ? "configuration-required" : "unavailable"} title="모델 설정을 읽을 수 없습니다." description={result.message} />
      )}
    </DeveloperShell>
  );
}
