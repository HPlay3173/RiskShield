import { CommunityCollector } from "../../../../components/developer/CommunityCollector";
import { AdminShell } from "../../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../../lib/product-page";

export default async function ManualPublicMaterialsPage() {
  const { principal, presentation } = await protectedProductPage("/manage/materials/public", "dataset:manage");
  return (
    <AdminShell currentHref="/manage/materials" principal={presentation} title="공개 글 직접 등록" description="이용 규칙에 맞게 확보한 공개 글과 댓글을 후보 생성용 자료로 등록합니다.">
      <CommunityCollector csrfToken={principal.csrfToken} mode="manual" />
    </AdminShell>
  );
}
