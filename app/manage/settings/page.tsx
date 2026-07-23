import Link from "next/link";
import { AdminShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

export default async function SettingsPage() {
  const { presentation } = await protectedProductPage("/manage/settings", "candidate:read");
  return (
    <AdminShell currentHref="/manage/settings" principal={presentation} title="설정" description="팀 운영과 변경 이력처럼 핵심 시연 밖의 관리 기능을 모았습니다.">
      <section className="managementTaskGrid" aria-label="관리 설정">
        <Link className="managementTaskCard" href="/manage/access"><span>설정 01</span><strong>팀원·권한</strong><p>관리 사용자의 역할과 접근 범위를 확인합니다.</p><b>접근 관리 →</b></Link>
        <Link className="managementTaskCard" href="/manage/audit"><span>설정 02</span><strong>변경 기록</strong><p>후보 결정과 규칙 변경 이력을 확인합니다.</p><b>기록 보기 →</b></Link>
      </section>
    </AdminShell>
  );
}
