import type { ReactNode } from "react";
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

const adminNavigation = [
  { href: "/admin/review", label: "후보 검토", description: "AI 후보와 결정" },
  { href: "/admin/skills", label: "스킬 라이브러리", description: "스킬과 revision" },
  { href: "/admin/trends", label: "표현 변화", description: "신규 표현과 변화" },
  { href: "/admin/audit", label: "관리 감사", description: "검토와 변경 이력" },
] as const;

const developerNavigation = [
  { href: "/dev/datasets", label: "데이터셋", description: "등록과 검증" },
  { href: "/dev/training", label: "Training Pipeline", description: "단계와 실행 상태" },
  { href: "/dev/evaluation", label: "평가", description: "회귀와 품질 지표" },
  { href: "/dev/models", label: "모델·프롬프트", description: "버전과 설정" },
  { href: "/dev/audit", label: "개발 감사", description: "lifecycle 이력" },
] as const;

const ownerNavigation = [
  { href: "/owner/access", label: "사용자·역할", description: "접근과 session 관리" },
] as const;

function normalizedPath(href: string) {
  const path = href.split(/[?#]/u, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/u, "") : path;
}

function navigationFor(
  items: ReadonlyArray<{ href: string; label: string; description: string }>,
  currentHref: string,
): ManagementNavItem[] {
  const current = normalizedPath(currentHref);
  return items.map((item) => ({
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

type AreaFrameProps = AreaShellProps & {
  areaLabel: string;
  brandLabel: string;
  eyebrow: string;
  navigation: ReadonlyArray<{ href: string; label: string; description: string }>;
};

function AreaFrame({
  currentHref,
  principal,
  title,
  description,
  children,
  actions,
  navigationFooter,
  className,
  areaLabel,
  brandLabel,
  eyebrow,
  navigation,
}: AreaFrameProps) {
  return (
    <ManagementShell
      areaLabel={areaLabel}
      brandLabel={brandLabel}
      eyebrow={eyebrow}
      title={title}
      description={description}
      navigation={navigationFor(navigation, currentHref)}
      identity={identityFor(principal)}
      actions={actions}
      navigationFooter={navigationFooter}
      className={className}
    >
      {children}
    </ManagementShell>
  );
}

export function AdminShell(props: AreaShellProps) {
  return (
    <AreaFrame
      {...props}
      areaLabel="관리자 메뉴"
      brandLabel="RiskShield Admin"
      eyebrow="ADMIN REVIEW"
      navigation={adminNavigation}
    />
  );
}

export function DeveloperShell(props: AreaShellProps) {
  return (
    <AreaFrame
      {...props}
      areaLabel="개발자 메뉴"
      brandLabel="RiskShield Developer"
      eyebrow="DEVELOPER CONTROL"
      navigation={developerNavigation}
    />
  );
}

export function OwnerShell(props: AreaShellProps) {
  return (
    <AreaFrame
      {...props}
      areaLabel="Owner 메뉴"
      brandLabel="RiskShield Owner"
      eyebrow="OWNER ACCESS"
      navigation={ownerNavigation}
    />
  );
}
