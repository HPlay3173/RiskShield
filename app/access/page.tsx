import type { Metadata } from "next";
import Link from "next/link";
import { AccessCodeLogin } from "./AccessCodeLogin";

export const metadata: Metadata = {
  title: "RiskShield 관리 접근",
  robots: { index: false, follow: false },
};

export default function AccessPage() {
  return (
    <main className="accessCodePage" id="access-main">
      <section className="accessCodeCard" aria-labelledby="access-title">
        <div className="accessCodeBrand" aria-hidden="true">R</div>
        <p className="accessCodeEyebrow">PROTECTED CONTROL PLANE</p>
        <h1 id="access-title">RiskShield 관리 접근</h1>
        <p>운영 환경에 등록된 비밀코드로 관리자·개발자·소유자 화면을 엽니다.</p>
        <AccessCodeLogin />
        <p className="accessCodeNotice">세션은 15분 후 만료됩니다. 코드는 브라우저 저장소에 보관하지 않습니다.</p>
        <Link href="/">공개 Analyzer로 돌아가기</Link>
      </section>
    </main>
  );
}
