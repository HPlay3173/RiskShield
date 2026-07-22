import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

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
        <div className="accessCodeBrandRow">
          <div className="accessCodeBrand" aria-hidden="true">R</div>
          <div><strong>RiskShield</strong><span>관리 콘솔</span></div>
        </div>
        <p className="accessCodeEyebrow">관리자 전용</p>
        <h1 id="access-title">관리자 로그인</h1>
        <p className="accessCodeDescription">{localDevelopment ? "개발 환경에서 관리 화면과 전체 작업 흐름을 확인합니다." : "허용된 Google 계정으로 로그인해 분석 지식과 수집 결과를 관리하세요."}</p>
        {localDevelopment ? (
          <Link className="pressable primaryButton accessCodePrimary" href="/manage">개발 모드로 계속하기</Link>
        ) : (
          <Link className="pressable primaryButton accessCodePrimary" href="/api/auth/google/start?return_to=%2Fmanage">Google로 계속하기</Link>
        )}
        <p className="accessCodeNotice">로그인 세션은 15분 동안 유지됩니다.</p>
        <Link className="accessCodeBack" href="/">← 공개 분석기로 돌아가기</Link>
      </section>
    </main>
  );
}
