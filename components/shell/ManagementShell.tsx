import type { ReactNode } from "react";

export type ManagementNavItem = {
  href: string;
  label: string;
  description?: string;
  current?: boolean;
  badge?: ReactNode;
};

export type ManagementIdentity = {
  displayName: string;
  secondaryText?: string;
  roleLabel?: string;
  developmentFixture?: boolean;
};

export type ManagementShellProps = {
  areaLabel: string;
  brandLabel?: string;
  brandHref?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  navigation: readonly ManagementNavItem[];
  identity?: ManagementIdentity;
  actions?: ReactNode;
  navigationFooter?: ReactNode;
  children: ReactNode;
  className?: string;
  mainId?: string;
};

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ManagementShell({
  areaLabel,
  brandLabel = "RiskShield",
  brandHref = "/",
  eyebrow,
  title,
  description,
  navigation,
  identity,
  actions,
  navigationFooter,
  children,
  className,
  mainId = "management-main",
}: ManagementShellProps) {
  return (
    <div className={classes("managementShell", className)} data-management-shell="">
      <a className="skipLink managementSkipLink" href={`#${mainId}`}>
        본문으로 건너뛰기
      </a>
      <header className="managementTopBar floatingMaterial">
        <a className="managementBrand" href={brandHref} aria-label={`${brandLabel} 홈`}>
          <span className="managementBrandMark" aria-hidden="true">R</span>
          <span>{brandLabel}</span>
        </a>
        <div className="managementTopBarActions">
          {identity ? (
            <div className="managementIdentity" aria-label="현재 접근 주체">
              <span className="managementIdentityName">{identity.displayName}</span>
              {identity.secondaryText ? <span className="managementIdentitySecondary">{identity.secondaryText}</span> : null}
              {identity.roleLabel ? <span className="managementIdentityRole">{identity.roleLabel}</span> : null}
              {identity.developmentFixture ? <strong className="developmentDataBadge">개발 데이터</strong> : null}
            </div>
          ) : null}
          {actions}
        </div>
      </header>
      <div className="managementFrame">
        <aside className="managementSidebar">
          <nav className="managementNavigation" aria-label={areaLabel}>
            <ul>
              {navigation.map((item) => (
                <li key={item.href}>
                  <a
                    className={classes("managementNavItem", item.current && "managementNavItemCurrent")}
                    href={item.href}
                    aria-current={item.current ? "page" : undefined}
                  >
                    <span className="managementNavCopy">
                      <strong>{item.label}</strong>
                      {item.description ? <small>{item.description}</small> : null}
                    </span>
                    {item.badge === undefined ? null : <span className="managementNavBadge">{item.badge}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {navigationFooter ? <footer className="managementNavigationFooter">{navigationFooter}</footer> : null}
        </aside>
        <main id={mainId} className="managementMain" tabIndex={-1}>
          <header className="managementPageHeader">
            {eyebrow ? <p className="managementPageEyebrow">{eyebrow}</p> : null}
            <h1>{title}</h1>
            {description ? <div className="managementPageDescription">{description}</div> : null}
          </header>
          <div className="managementPageBody">{children}</div>
        </main>
      </div>
    </div>
  );
}
