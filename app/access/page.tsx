import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { AccessCodeLogin } from "./AccessCodeLogin";

export const metadata: Metadata = {
  title: "RiskShield 관리 접근",
  robots: { index: false, follow: false },
};

export default async function AccessPage() {
  const host = (await headers()).get("host")?.split(":", 1)[0] ?? "";
  const localDevelopment = host === "localhost" || host === "127.0.0.1";
  return (
    <main className="accessCodePage" id="access-main">
      <section className="accessCodeCard" aria-labelledby="access-title">
        <div className="accessCodeBrand" aria-hidden="true">R</div>
        <p className="accessCodeEyebrow">PROTECTED CONTROL PLANE</p>
        <h1 id="access-title">RiskShield 관리 접근</h1>
        <p>{localDevelopment ? "로컬 개발용 비밀코드로 관리 화면을 엽니다." : "허용된 Google 계정으로 관리 콘솔에 로그인합니다."}</p>
        {localDevelopment ? <AccessCodeLogin /> : (
          <Link className="pressable primaryButton" href="/api/auth/google/start?return_to=%2Fmanage">Google로 로그인</Link>
        )}
        <p className="accessCodeNotice">세션은 15분 후 만료됩니다. 운영 access code 로그인은 비활성화되어 있습니다.</p>
        <Link href="/">공개 Analyzer로 돌아가기</Link>
      </section>
    </main>
  );
}
