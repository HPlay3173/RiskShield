import { ProductDataTable } from "../../../components/data-display/ProductData";
import { AdminShell } from "../../../components/shell/AreaShells";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";
import type { AuditRecord } from "../../../lib/repositories/contracts";

const columns = [
  { key: "time", header: "시각", render: (row: AuditRecord) => row.occurredAt, rowHeader: true },
  { key: "actor", header: "주체", render: (row: AuditRecord) => row.actorId },
  { key: "action", header: "사건", render: (row: AuditRecord) => row.action },
  { key: "resource", header: "대상", render: (row: AuditRecord) => `${row.resourceType} · ${row.resourceId}` },
  { key: "result", header: "결과", render: (row: AuditRecord) => row.result },
] as const;

export async function renderAdminAuditPage(returnTo = "/admin/audit") {
  const { presentation, repositories } = await protectedProductPage(returnTo, "audit:read_admin");
  const result = await repositories.audit.list();

  return (
    <AdminShell
      currentHref="/admin/audit"
      principal={presentation}
      title="관리 감사"
      description="후보 결정, 스킬 수정·병합, 승인·반려, rollback과 자동 편입 표본 감사를 실제 사건만으로 확인합니다."
    >
      {result.status === "ready" && result.data.items.length > 0 ? (
        <ProductDataTable
          caption="관리자 감사 사건"
          columns={columns}
          rows={result.data.items}
          getRowKey={(row) => row.id}
        />
      ) : (
        <StatePanel
          state={result.status === "configuration_required" ? "configuration-required" : result.status === "unavailable" ? "unavailable" : "empty"}
          title={result.status === "ready" ? "기록된 관리자 감사 사건이 없습니다." : "감사 저장소를 사용할 수 없습니다."}
          description={result.status === "ready" ? "없는 사건을 만들어 표시하지 않습니다." : result.message}
        />
      )}
    </AdminShell>
  );
}

export default function AdminAuditPage() {
  return renderAdminAuditPage();
}
