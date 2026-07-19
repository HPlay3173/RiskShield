import { ProductDataTable } from "../../../components/data-display/ProductData";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";
import type { AuditRecord } from "../../../lib/repositories/contracts";

const columns = [
  { key: "time", header: "시각", render: (row: AuditRecord) => row.occurredAt, rowHeader: true },
  { key: "action", header: "Lifecycle 사건", render: (row: AuditRecord) => row.action },
  { key: "resource", header: "대상", render: (row: AuditRecord) => `${row.resourceType} · ${row.resourceId}` },
  { key: "actor", header: "주체", render: (row: AuditRecord) => row.actorId },
  { key: "result", header: "결과", render: (row: AuditRecord) => row.result },
] as const;

export default async function DeveloperAuditPage() {
  const { presentation, repositories } = await protectedProductPage("/dev/audit", "audit:read_dev");
  const result = await repositories.audit.list();
  return (
    <DeveloperShell currentHref="/dev/audit" principal={presentation} title="개발 감사" description="dataset 등록, validation, pipeline, evaluation, model·prompt version, release와 rollback의 실제 기록입니다.">
      {result.status === "ready" && result.data.items.length ? (
        <ProductDataTable caption="개발 lifecycle 감사" columns={columns} rows={result.data.items} getRowKey={(row) => row.id} />
      ) : (
        <StatePanel state={result.status === "ready" ? "empty" : result.status === "configuration_required" ? "configuration-required" : "unavailable"} title={result.status === "ready" ? "기록된 개발 사건이 없습니다." : "감사 backend가 준비되지 않았습니다."} description={result.status === "ready" ? "실제 사건이 기록되기 전에는 표를 만들지 않습니다." : result.message} />
      )}
    </DeveloperShell>
  );
}
