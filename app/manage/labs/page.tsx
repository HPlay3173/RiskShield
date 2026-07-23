import Link from "next/link";
import { AdminShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

export default async function LabsPage() {
  const { presentation } = await protectedProductPage("/manage/labs", "dataset:manage");
  return (
    <AdminShell currentHref="/manage/labs" principal={presentation} title="Labs" description="발표의 핵심 흐름과 분리된 실험 기능입니다. 결과는 사람이 확인하기 전 분석 규칙에 반영되지 않습니다.">
      <section className="managementTaskGrid" aria-label="실험 기능">
        <Link className="managementTaskCard" href="/manage/collect"><span>실험 01</span><strong>자동 커뮤니티 관찰</strong><p>지정한 공개 출처를 정기 관찰하고 의미·검색 검증을 통과한 표현만 검토함으로 보냅니다.</p><b>수집 설정 →</b></Link>
        <Link className="managementTaskCard" href="/manage/models"><span>실험 02</span><strong>모델 상태</strong><p>AI 공급자와 모델 준비 상태를 확인합니다.</p><b>모델 보기 →</b></Link>
        <Link className="managementTaskCard" href="/manage/trends"><span>실험 03</span><strong>표현 추세</strong><p>충분한 관찰 데이터가 쌓였을 때 변화 추세를 탐색합니다.</p><b>추세 보기 →</b></Link>
      </section>
    </AdminShell>
  );
}
