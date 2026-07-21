import { CommunityCollector } from "../../../components/developer/CommunityCollector";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

export default async function ManageCollectPage() {
  const { principal, presentation } = await protectedProductPage("/manage/collect", "dataset:manage");
  return (
    <DeveloperShell currentHref="/manage/collect" principal={presentation} title="커뮤니티 자료 수집" description="허용된 방식으로 확보한 공개 글 묶음을 새 위험 표현 후보의 원천 데이터로 등록합니다.">
      <section className="managementCard collectorGuide"><h2>이 페이지에서 하는 일</h2><ol><li>공개 글에서 사용자명·연락처 등 개인정보를 제거합니다.</li><li>한 줄에 글 하나씩 붙여 넣고 출처를 기록합니다.</li><li>등록 후 후보 생성에서 AI 분류를 실행합니다.</li><li>후보 검토를 통과한 표현만 위험 표현 DB에 반영합니다.</li></ol></section>
      <CommunityCollector csrfToken={principal.csrfToken} />
    </DeveloperShell>
  );
}
