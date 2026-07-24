import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "RiskShield | 글 속에 숨은 위험까지, 맥락으로 읽습니다";
const betaTitle = "RiskShield Context Risk Analyzer";
const description = "과장·기만, 혐오·차별, 욕설·공격, 숨은 은어와 폭력·위협을 글 전체의 맥락과 근거 구간으로 분석합니다.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host") || "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const socialImage = new URL("/og-v05.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: {
      title: betaTitle,
      description,
      type: "website",
      locale: "ko_KR",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "RiskShield 맥락 기반 텍스트 위험 분석기" }],
    },
    twitter: {
      card: "summary_large_image",
      title: betaTitle,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
