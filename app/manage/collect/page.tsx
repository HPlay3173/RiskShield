import { CommunityCollector } from "../../../components/developer/CommunityCollector";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

export default async function ManageCollectPage() {
  const { principal, presentation } = await protectedProductPage("/manage/collect", "dataset:manage");
  return (
    <DeveloperShell currentHref="/manage/collect" principal={presentation} title="커뮤니티 자료 수집" description="공식 검색 API와 팀이 검토한 공개 주소를 주기적으로 확인하고, 새 글을 자동으로 후보 검토함에 보냅니다.">
      <section className="managementCard collectorGuide"><h2>자동 수집 원칙</h2><ol><li>X·Threads는 공식 키워드 검색 API 자격 증명을 사용합니다.</li><li>디시인사이드는 팀이 확인한 공개 주소만 낮은 빈도로 확인합니다.</li><li>개인정보 패턴이 발견된 글은 후보로 저장하지 않습니다.</li><li>자동 수집 결과도 사람 검토와 회귀 테스트 전에는 분석 규칙이 되지 않습니다.</li></ol></section>
      <CommunityCollector csrfToken={principal.csrfToken} />
    </DeveloperShell>
  );
}
