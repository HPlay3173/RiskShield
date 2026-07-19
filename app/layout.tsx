import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "RiskShield | 말하기 전에, 위험을 읽습니다";
const betaTitle = "RiskShield Public Analyzer v0.5";
const description =
  "단어·문장·광고 문구의 위험 신호와 문맥을 정리해 사람의 최종 판단을 돕는 공개 RiskShield Analyzer";

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
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "RiskShield Public Beta Analyzer" }],
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
