import type { ReactNode } from "react";
import Link from "next/link";
import { ManagementShell, type ManagementIdentity, type ManagementNavItem } from "./ManagementShell";

export type AreaPrincipal = { displayName: string; secondaryText?: string; roleLabel: string; developmentFixture?: boolean };
export type AreaShellProps = {
  currentHref: string;
  principal: AreaPrincipal;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  navigationFooter?: ReactNode;
  className?: string;
};

const managementNavigation = [
  { href: "/manage", label: "관리 홈", description: "현재 상태와 다음 작업", group: "핵심 흐름" },
  { href: "/manage/review", label: "검토함", description: "새 표현을 사람이 판단", group: "핵심 흐름" },
  { href: "/manage/skills", label: "위험 규칙", description: "분석기에 반영된 지식", group: "핵심 흐름" },
  { href: "/manage/materials", label: "자료 추가", description: "CSV·공개 글에서 후보 생성", group: "핵심 흐름" },
  { href: "/manage/test", label: "테스트", description: "규칙 엔진 탐지 품질 확인", group: "핵심 흐름" },
] as const;

const legacyMap: Record<string, string> = {
  "/admin/review": "/manage/review", "/admin/skills": "/manage/skills", "/admin/trends": "/manage/trends", "/admin/audit": "/manage/audit",
  "/dev/datasets": "/manage/datasets", "/dev/training": "/manage/training", "/dev/evaluation": "/manage/evaluation", "/dev/models": "/manage/models", "/dev/audit": "/manage/audit",
  "/owner/access": "/manage/access",
  "/manage/datasets": "/manage/materials", "/manage/training": "/manage/materials",
  "/manage/evaluation": "/manage/test",
};

function normalizedPath(href: string) {
  const path = href.split(/[?#]/u, 1)[0] || "/";
  const normalized = path.length > 1 ? path.replace(/\/+$/u, "") : path;
  return legacyMap[normalized] ?? normalized;
}

function navigationFor(currentHref: string): ManagementNavItem[] {
  const current = normalizedPath(currentHref);
  return managementNavigation.map((item) => ({ ...item, current: current === item.href || (item.href !== "/manage" && current.startsWith(`${item.href}/`)) }));
}

function identityFor(principal: AreaPrincipal): ManagementIdentity { return { ...principal }; }

function UnifiedManagementShell(props: AreaShellProps) {
  return (
    <ManagementShell
      areaLabel="RiskShield 관리 메뉴"
      brandLabel="RiskShield Manage"
      brandHref="/manage"
      eyebrow="RISK KNOWLEDGE WORKSPACE"
      title={props.title}
      description={props.description}
      navigation={navigationFor(props.currentHref)}
      identity={identityFor(props.principal)}
      actions={props.actions}
      navigationFooter={props.navigationFooter ?? <><Link href="/manage/labs">Labs · 실험 기능</Link><Link href="/manage/settings">설정</Link><Link href="/">공개 분석기로 돌아가기</Link></>}
      className={props.className}
    >{props.children}</ManagementShell>
  );
}

export function AdminShell(props: AreaShellProps) { return <UnifiedManagementShell {...props} />; }
export function DeveloperShell(props: AreaShellProps) { return <UnifiedManagementShell {...props} />; }
export function OwnerShell(props: AreaShellProps) { return <UnifiedManagementShell {...props} />; }
