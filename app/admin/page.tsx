import Link from "next/link";

export default function AdminPage() {
  return (
    <main className="protectedShell">
      <span>REVIEW CONTROL</span>
      <h1>관리자 검토 영역</h1>
      <p>후보 검토, 스킬 조회, 트렌드와 감사 기능은 권한별 후속 화면에서 제공합니다.</p>
      <Link href="/">공개 Analyzer로 돌아가기</Link>
    </main>
  );
}
