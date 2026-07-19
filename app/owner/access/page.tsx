import Link from "next/link";

export default function OwnerAccessPage() {
  return (
    <main className="protectedShell">
      <span>OWNER ONLY</span>
      <h1>사용자·역할 관리</h1>
      <p>접근 주체와 역할 변경은 owner capability와 감사 계약을 통과해야 합니다.</p>
      <Link href="/">공개 Analyzer로 돌아가기</Link>
    </main>
  );
}
