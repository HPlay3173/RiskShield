import Link from "next/link";

export default function DevPage() {
  return (
    <main className="protectedShell">
      <span>DEVELOPER CONTROL</span>
      <h1>개발자 제어 영역</h1>
      <p>데이터셋, 평가, 모델·프롬프트와 시스템 감사 기능의 보호된 route shell입니다.</p>
      <Link href="/">공개 Analyzer로 돌아가기</Link>
    </main>
  );
}
