import { ProductDataTable, ProductDefinitionList, ProductMetricGrid } from "../../../components/data-display/ProductData";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";
import type { EvaluationRunRecord } from "../../../lib/repositories/contracts";

const columns = [
  { key: "id", header: "실행", render: (row: EvaluationRunRecord) => row.id, rowHeader: true },
  { key: "baseline", header: "Baseline", render: (row: EvaluationRunRecord) => row.baselineVersion ?? "비교 실행 아님" },
  { key: "candidate", header: "Candidate", render: (row: EvaluationRunRecord) => row.candidateVersion ?? "비교 실행 아님" },
  { key: "sha", header: "Code SHA", render: (row: EvaluationRunRecord) => row.codeSha },
  { key: "model", header: "모델 / Prompt", render: (row: EvaluationRunRecord) => `${row.modelVersion} / ${row.promptVersion}` },
  { key: "schema", header: "Schema", render: (row: EvaluationRunRecord) => row.schemaVersion },
  { key: "dataset", header: "Dataset", render: (row: EvaluationRunRecord) => row.datasetVersion ?? "제공되지 않음" },
  { key: "tests", header: "테스트", render: (row: EvaluationRunRecord) => `${row.passed}/${row.testCount}`, numeric: true },
  { key: "status", header: "결과", render: (row: EvaluationRunRecord) => row.status },
] as const;

type ProfileSlice = NonNullable<EvaluationRunRecord["profileSlices"]>[number];
type ContextSlice = NonNullable<EvaluationRunRecord["contextSlices"]>[number];

const profileSliceColumns = [
  { key: "profile", header: "Profile", render: (row: ProfileSlice) => row.profile, rowHeader: true },
  { key: "passed", header: "통과", render: (row: ProfileSlice) => row.passed, numeric: true },
  { key: "failed", header: "실패", render: (row: ProfileSlice) => row.failed, numeric: true },
] as const;

const contextSliceColumns = [
  { key: "context", header: "Context", render: (row: ContextSlice) => row.context, rowHeader: true },
  { key: "passed", header: "통과", render: (row: ContextSlice) => row.passed, numeric: true },
  { key: "failed", header: "실패", render: (row: ContextSlice) => row.failed, numeric: true },
] as const;

function measured(value: number | null, suffix = "") {
  return value === null ? "측정되지 않음" : `${value.toLocaleString("ko-KR")}${suffix}`;
}

export default async function EvaluationPage() {
  const { presentation, repositories } = await protectedProductPage("/manage/evaluation", "evaluation:run");
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
      <ProductDefinitionList
        label="Baseline과 candidate 식별"
        items={[
          { key: "baseline", term: "Baseline", description: latest?.baselineVersion ?? "비교 실행 아님" },
          { key: "candidate", term: "Candidate", description: latest?.candidateVersion ?? "비교 실행 아님" },
          { key: "sha", term: "Code SHA", description: latest?.codeSha ?? "제공되지 않음" },
          { key: "dataset", term: "Dataset Version", description: latest?.datasetVersion ?? "제공되지 않음" },
          { key: "model", term: "Model", description: latest?.modelVersion ?? "제공되지 않음" },
          { key: "prompt", term: "Prompt", description: latest?.promptVersion ?? "제공되지 않음" },
          { key: "schema", term: "Schema", description: latest?.schemaVersion ?? "제공되지 않음" },
        ]}
      />
      <ProductDefinitionList
        label="품질, fallback, latency와 비용"
        items={[
          { key: "false-high", term: "False high", description: measured(latest?.metrics.falseHigh ?? null) },
          { key: "false-negative", term: "False negative", description: measured(latest?.metrics.falseNegative ?? null) },
          { key: "review", term: "Unnecessary review", description: measured(latest?.metrics.unnecessaryReview ?? null) },
          { key: "no-match", term: "no_match", description: measured(latest?.metrics.noMatch ?? null) },
          { key: "json", term: "JSON 성공률", description: measured(latest?.metrics.jsonSuccessRate ?? null, "%") },
          { key: "fallback", term: "Provider fallback", description: measured(latest?.metrics.providerFallbackRate ?? null, "%") },
          { key: "p50", term: "Latency p50", description: measured(latest?.metrics.latencyP50Ms ?? null, " ms") },
          { key: "p95", term: "Latency p95", description: measured(latest?.metrics.latencyP95Ms ?? null, " ms") },
          { key: "cost", term: "Estimated cost", description: latest?.metrics.estimatedCostUsd === null || latest?.metrics.estimatedCostUsd === undefined ? "측정되지 않음" : `$${latest.metrics.estimatedCostUsd.toFixed(4)}` },
        ]}
      />
      {latest?.profileSlices?.length ? (
        <ProductDataTable caption="Profile별 결과" columns={profileSliceColumns} rows={latest.profileSlices} getRowKey={(row) => row.profile} />
      ) : (
        <StatePanel state="empty" title="Profile slice 결과가 없습니다." description="balanced·advertising·context별 실제 evaluation 결과가 기록되면 표시합니다." compact />
      )}
      {latest?.contextSlices?.length ? (
        <ProductDataTable caption="Context별 결과" columns={contextSliceColumns} rows={latest.contextSlices} getRowKey={(row) => row.context} />
      ) : (
        <StatePanel state="empty" title="Context slice 결과가 없습니다." description="인용·비판·부정·보고 문맥별 실제 evaluation 결과가 기록되면 표시합니다." compact />
      )}
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
