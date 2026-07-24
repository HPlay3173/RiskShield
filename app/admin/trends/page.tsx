import { ProductMetricGrid } from "../../../components/data-display/ProductData";
import { AdminShell } from "../../../components/shell/AreaShells";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";

export async function renderAdminTrendsPage(returnTo = "/admin/trends") {
  const { presentation, repositories } = await protectedProductPage(returnTo, "candidate:read");
  const runs = await repositories.training.listRuns();
  const recentRun = runs.status === "ready" ? runs.data.items[0] : null;

  return (
    <AdminShell
      currentHref="/admin/trends"
      principal={presentation}
      title="표현 변화"
      description="기간과 자료원이 확인된 표현군만 보여줍니다. 수집 데이터가 없을 때는 차트나 수치를 추정하지 않습니다."
    >
      <ProductMetricGrid
        label="표현 변화 데이터 준비 상태"
        metrics={[
          { key: "clusters", label: "신규 표현군", value: "제공되지 않음", detail: "cluster 저장소 필요" },
          { key: "samples", label: "검증된 표본", value: "제공되지 않음", detail: "dataset lineage 필요" },
          { key: "pipeline", label: "최근 pipeline", value: recentRun?.status ?? "기록 없음", detail: recentRun?.updatedAt ?? "실행 이력이 없습니다." },
        ]}
      />
      <StatePanel
        state={runs.status === "configuration_required" ? "configuration-required" : "empty"}
        title="실제 trend 데이터가 아직 없습니다."
        description="기간별 사용량, 플랫폼·자료원 분포, 직접 사용·인용·비판·풍자·자조 비율을 표시하려면 검증된 dataset version과 cluster 결과가 필요합니다."
      >
        <p>Collector, DatasetRepository, cluster lineage가 연결된 뒤 실제 표본만 이 화면에 나타납니다.</p>
      </StatePanel>
    </AdminShell>
  );
}

export default function AdminTrendsPage() {
  return renderAdminTrendsPage();
}
