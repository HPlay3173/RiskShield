import { CommunityCollector } from "../../../components/developer/CommunityCollector";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

export default async function ManageCollectPage() {
  const { principal, presentation } = await protectedProductPage("/manage/collect", "dataset:manage");
  return (
    <DeveloperShell currentHref="/manage/collect" principal={presentation} title="커뮤니티 자료 수집" description="허용된 공개 API를 정기적으로 확인하고, 많은 글을 소수의 새 표현 후보로 압축해 검토함에 보냅니다.">
      <section className="managementCard collectorGuide"><h2>자동 수집 원칙</h2><ol><li>Bluesky·Mastodon 공개 API는 토큰 없이 정기 수집합니다.</li><li>X·Threads는 공식 API 자격 증명이 있을 때만 선택적으로 연결합니다.</li><li>원문 전체 대신 개인정보를 가린 짧은 문맥만 저장하고 30일 뒤 삭제합니다.</li><li>반복·변형 신호를 표현군으로 압축하며, 사람 검토와 회귀 테스트 전에는 분석 규칙이 되지 않습니다.</li></ol></section>
      <CommunityCollector csrfToken={principal.csrfToken} />
    </DeveloperShell>
  );
}
