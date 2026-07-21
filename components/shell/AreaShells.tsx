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
  { href: "/manage", label: "관리 홈", description: "현재 상태와 다음 작업", group: "시작" },
  { href: "/manage/review", label: "후보 검토", description: "새 표현을 사람이 판단", group: "핵심 작업" },
  { href: "/manage/skills", label: "위험 표현 DB", description: "활성 규칙과 수정 이력", group: "핵심 작업" },
  { href: "/manage/collect", label: "커뮤니티 자료", description: "공개 글 묶음 직접 추가", group: "데이터 추가" },
  { href: "/manage/datasets", label: "CSV 등록", description: "정리된 표현 자료 추가", group: "데이터 추가" },
  { href: "/manage/training", label: "후보 생성", description: "등록 데이터에서 후보 찾기", group: "데이터 추가" },
  { href: "/manage/evaluation", label: "품질 기록", description: "저장된 검증 결과 확인", group: "확인" },
  { href: "/manage/audit", label: "변경 기록", description: "결정과 변경 이력", group: "운영" },
  { href: "/manage/access", label: "팀원·권한", description: "관리 사용자 설정", group: "운영" },
] as const;

const legacyMap: Record<string, string> = {
  "/admin/review": "/manage/review", "/admin/skills": "/manage/skills", "/admin/trends": "/manage/trends", "/admin/audit": "/manage/audit",
  "/dev/datasets": "/manage/datasets", "/dev/training": "/manage/training", "/dev/evaluation": "/manage/evaluation", "/dev/models": "/manage/models", "/dev/audit": "/manage/audit",
  "/owner/access": "/manage/access",
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
      navigationFooter={props.navigationFooter ?? <Link href="/">공개 분석기로 돌아가기</Link>}
      className={props.className}
    >{props.children}</ManagementShell>
  );
}

export function AdminShell(props: AreaShellProps) { return <UnifiedManagementShell {...props} />; }
export function DeveloperShell(props: AreaShellProps) { return <UnifiedManagementShell {...props} />; }
export function OwnerShell(props: AreaShellProps) { return <UnifiedManagementShell {...props} />; }
