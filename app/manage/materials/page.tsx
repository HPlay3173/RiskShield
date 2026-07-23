import Link from "next/link";
import { AdminShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

export default async function MaterialsPage() {
  const { presentation } = await protectedProductPage("/manage/materials", "dataset:manage");
  return (
    <AdminShell currentHref="/manage/materials" principal={presentation} title="자료 추가" description="새 위험 표현을 찾을 자료를 등록하고, 등록이 끝나면 후보 생성으로 이어갑니다.">
      <section className="managementTaskGrid" aria-label="자료 추가 방법">
        <Link className="managementTaskCard" href="/manage/datasets"><span>01 · CSV</span><strong>정리된 표 등록</strong><p>혐오 표현·은어·과장 문구가 정리된 CSV를 검사하고 등록합니다.</p><b>CSV 등록 →</b></Link>
        <Link className="managementTaskCard" href="/manage/collect"><span>02 · 공개 글</span><strong>글 묶음 직접 등록</strong><p>확보한 공개 글이나 댓글을 한 줄씩 등록합니다. 자동 수집은 같은 화면의 Labs 기능으로 분리됩니다.</p><b>공개 글 등록 →</b></Link>
      </section>
      <section className="manageHero"><div><span className="manageHeroEyebrow">다음 단계</span><h2>이미 자료를 등록했나요?</h2><p>등록한 Dataset Version을 선택해 새 위험 표현 후보를 생성하세요.</p></div><Link className="pressable primaryButton" href="/manage/training">이 자료에서 후보 생성</Link></section>
    </AdminShell>
  );
}
