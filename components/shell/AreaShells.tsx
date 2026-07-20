import type { ReactNode } from "react";
import Link from "next/link";
import {
  ManagementShell,
  type ManagementIdentity,
  type ManagementNavItem,
} from "./ManagementShell";

export type AreaPrincipal = {
  displayName: string;
  secondaryText?: string;
  roleLabel: string;
  developmentFixture?: boolean;
};

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
  { href: "/manage/review", label: "후보 검토", description: "AI 후보와 사람의 결정" },
  { href: "/manage/skills", label: "스킬", description: "검토 상태와 revision" },
  { href: "/manage/datasets", label: "데이터셋", description: "CSV 검증과 등록" },
  { href: "/manage/training", label: "학습", description: "정제부터 검토함까지" },
  { href: "/manage/evaluation", label: "평가", description: "회귀 결과와 품질" },
  { href: "/manage/models", label: "모델", description: "Gemma와 계약 버전" },
  { href: "/manage/trends", label: "트렌드", description: "신규 표현 데이터 상태" },
  { href: "/manage/audit", label: "감사", description: "결정과 변경 이력" },
  { href: "/manage/access", label: "접근", description: "관리 세션과 권한" },
] as const;

const legacyMap: Record<string, string> = {
  "/admin/review": "/manage/review",
  "/admin/skills": "/manage/skills",
  "/admin/trends": "/manage/trends",
  "/admin/audit": "/manage/audit",
  "/dev/datasets": "/manage/datasets",
  "/dev/training": "/manage/training",
  "/dev/evaluation": "/manage/evaluation",
  "/dev/models": "/manage/models",
  "/dev/audit": "/manage/audit",
  "/owner/access": "/manage/access",
};

function normalizedPath(href: string) {
  const path = href.split(/[?#]/u, 1)[0] || "/";
  const normalized = path.length > 1 ? path.replace(/\/+$/u, "") : path;
  return legacyMap[normalized] ?? normalized;
}

function navigationFor(currentHref: string): ManagementNavItem[] {
  const current = normalizedPath(currentHref);
  return managementNavigation.map((item) => ({
    ...item,
    current: current === item.href || current.startsWith(`${item.href}/`),
  }));
}

function identityFor(principal: AreaPrincipal): ManagementIdentity {
  return {
    displayName: principal.displayName,
    secondaryText: principal.secondaryText,
    roleLabel: principal.roleLabel,
    developmentFixture: principal.developmentFixture,
  };
}

function UnifiedManagementShell(props: AreaShellProps) {
  return (
    <ManagementShell
      areaLabel="통합 관리 메뉴"
      brandLabel="RiskShield Manage"
      brandHref="/manage"
      eyebrow="UNIFIED MANAGEMENT"
      title={props.title}
      description={props.description}
      navigation={navigationFor(props.currentHref)}
      identity={identityFor(props.principal)}
      actions={props.actions}
      navigationFooter={props.navigationFooter ?? <Link href="/">공개 Analyzer로 돌아가기</Link>}
      className={props.className}
    >
      {props.children}
    </ManagementShell>
  );
}

export function AdminShell(props: AreaShellProps) {
  return <UnifiedManagementShell {...props} />;
}

export function DeveloperShell(props: AreaShellProps) {
  return <UnifiedManagementShell {...props} />;
}

export function OwnerShell(props: AreaShellProps) {
  return <UnifiedManagementShell {...props} />;
}
