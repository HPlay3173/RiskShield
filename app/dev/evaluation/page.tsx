import { ProductDataTable, ProductMetricGrid } from "../../../components/data-display/ProductData";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";
import type { EvaluationRunRecord } from "../../../lib/repositories/contracts";

const columns = [
  { key: "id", header: "실행", render: (row: EvaluationRunRecord) => row.id, rowHeader: true },
  { key: "sha", header: "Code SHA", render: (row: EvaluationRunRecord) => row.codeSha },
  { key: "model", header: "모델 / Prompt", render: (row: EvaluationRunRecord) => `${row.modelVersion} / ${row.promptVersion}` },
  { key: "schema", header: "Schema", render: (row: EvaluationRunRecord) => row.schemaVersion },
  { key: "tests", header: "테스트", render: (row: EvaluationRunRecord) => `${row.passed}/${row.testCount}`, numeric: true },
  { key: "status", header: "결과", render: (row: EvaluationRunRecord) => row.status },
] as const;

export default async function EvaluationPage() {
  const { presentation, repositories } = await protectedProductPage("/dev/evaluation", "evaluation:run");
  const result = await repositories.evaluation.listRuns();
  const latest = result.status === "ready" ? result.data.items[0] : null;

  return (
    <DeveloperShell
      currentHref="/dev/evaluation"
      principal={presentation}
      title="평가"
      description="baseline과 candidate를 같은 code·model·prompt·schema·dataset version으로 비교합니다. 측정되지 않은 지표는 0으로 대체하지 않습니다."
    >
      <ProductMetricGrid
        label="최근 검증 결과"
        metrics={[
          { key: "tests", label: "실제 test count", value: latest ? latest.testCount : "제공되지 않음", numeric: Boolean(latest), detail: latest?.measuredAt ?? "검증 manifest 필요" },
          { key: "passed", label: "통과", value: latest ? latest.passed : "제공되지 않음", numeric: Boolean(latest) },
          { key: "failed", label: "실패", value: latest ? latest.failed : "제공되지 않음", numeric: Boolean(latest), tone: latest?.failed ? "critical" : "neutral" },
          { key: "metrics", label: "품질·latency·비용", value: "측정 전", detail: "실제 evaluation runner 결과만 표시" },
        ]}
      />
      {result.status === "ready" && result.data.items.length > 0 ? (
        <ProductDataTable caption="평가 실행" columns={columns} rows={result.data.items} getRowKey={(row) => row.id} />
      ) : (
        <StatePanel
          state={result.status === "configuration_required" ? "configuration-required" : result.status === "unavailable" ? "unavailable" : "empty"}
          title={result.status === "ready" ? "검증된 평가 실행이 없습니다." : "평가 결과 저장소가 준비되지 않았습니다."}
          description={result.status === "ready" ? "clean test 결과 manifest가 생성되면 실제 수치만 표시합니다." : result.message}
        />
      )}
    </DeveloperShell>
  );
}
