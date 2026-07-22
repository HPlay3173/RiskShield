import { CommunityCollector } from "../../../components/developer/CommunityCollector";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

export default async function ManageCollectPage() {
  const { principal, presentation } = await protectedProductPage("/manage/collect", "dataset:manage");
  return (
    <DeveloperShell currentHref="/manage/collect" principal={presentation} title="커뮤니티 자료 수집" description="허용된 공개 API를 정기적으로 확인하고, 많은 글을 소수의 새 표현 후보로 압축해 검토함에 보냅니다.">
      <details className="managementCard collectorGuide technicalDetails"><summary><span><strong>수집 결과가 후보가 되는 기준</strong><small>자동 수집의 품질·개인정보 원칙</small></span><b>열기</b></summary><div className="technicalDetailsBody"><ol><li>YouTube 공개 댓글을 주요 한국어 표본으로 관찰하고 Bluesky·Mastodon은 보조 신호로 사용합니다.</li><li>최근 14일 관찰을 합쳐 서로 다른 작성자와 직접 위험 문맥이 확인된 표현만 적격성 심사합니다.</li><li>AI는 정상 단어·반응·설명 문맥을 기각하거나 모니터링할 수 있으며, 실패하면 후보로 승격하지 않습니다.</li><li>원문 전체 대신 개인정보를 가린 짧은 문맥만 30일 보존하고 사람 검토·회귀 테스트 전에는 규칙이 되지 않습니다.</li></ol></div></details>
      <CommunityCollector csrfToken={principal.csrfToken} />
    </DeveloperShell>
  );
}
