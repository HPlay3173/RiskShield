import { CommunityCollector } from "../../../../components/developer/CommunityCollector";
import { DeveloperShell } from "../../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../../lib/product-page";

export default async function LabsCollectorPage() {
  const { principal, presentation } = await protectedProductPage("/manage/labs/collect", "dataset:manage");
  return (
    <DeveloperShell currentHref="/manage/labs" principal={presentation} title="자동 커뮤니티 관찰" description="실험 기능입니다. 지정한 공개 출처를 정기 관찰하고 의미·검색 검증을 통과한 표현만 검토함으로 보냅니다.">
      <CommunityCollector csrfToken={principal.csrfToken} mode="automatic" />
    </DeveloperShell>
  );
}
