import { ProductDataTable } from "../../../components/data-display/ProductData";
import { OwnerShell } from "../../../components/shell/AreaShells";
import { Pressable } from "../../../components/interaction/Pressable";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";
import type { PrincipalRecord } from "../../../lib/repositories/contracts";

const columns = [
  { key: "user", header: "사용자", render: (row: PrincipalRecord) => <><strong>{row.normalizedEmail}</strong><br /><small>{row.externalSubject}</small></>, rowHeader: true },
  { key: "provider", header: "Identity provider", render: (row: PrincipalRecord) => row.identityProvider },
  { key: "role", header: "Role", render: (row: PrincipalRecord) => row.role },
  { key: "status", header: "상태", render: (row: PrincipalRecord) => row.status },
  { key: "version", header: "Role version", render: (row: PrincipalRecord) => row.roleVersion, numeric: true },
  { key: "checked", header: "마지막 확인", render: (row: PrincipalRecord) => row.updatedAt ?? "기록 없음" },
  { key: "revoke", header: "Session revoke", render: (row: PrincipalRecord) => row.sessionNotBefore ? `not before ${row.sessionNotBefore}` : "revocation 없음" },
] as const;

export default async function OwnerAccessPage() {
  const { presentation, repositories } = await protectedProductPage("/manage/access", "principal:manage");
  const result = await repositories.principals.list();
  return (
    <OwnerShell currentHref="/owner/access" principal={presentation} title="사용자·역할" description="Google stable sub와 D1 role lookup을 기준으로 reviewer, developer, owner 접근을 확인합니다. client query나 localStorage로 역할을 바꿀 수 없습니다.">
      {result.status === "ready" ? (
        <>
          <ProductDataTable caption="접근 주체" columns={columns} rows={result.data.items} getRowKey={(row) => row.id} emptyContent="등록된 접근 주체가 없습니다." />
          {result.fixture ? <p className="configurationNote">개발 데이터: 이 principal은 explicit localhost fixture이며 production build에서 자동 비활성입니다.</p> : null}
          <section className="managementCard" aria-labelledby="access-readiness-title">
            <h2 id="access-readiness-title">Routine release readiness</h2>
            <p>운영 OIDC secret과 reconciled auth migration이 확인되기 전에는 role 변경과 session revoke를 실행하지 않습니다.</p>
            <div className="decisionBar"><Pressable className="secondaryButton" disabled>역할 변경</Pressable><Pressable className="secondaryButton" disabled>Session revoke</Pressable></div>
          </section>
        </>
      ) : (
        <StatePanel state={result.status === "configuration_required" ? "configuration-required" : "unavailable"} title="접근 저장소를 읽을 수 없습니다." description={result.message} />
      )}
    </OwnerShell>
  );
}
