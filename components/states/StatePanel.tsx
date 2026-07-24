import type { ReactNode } from "react";

export type ProductState =
  | "loading"
  | "revalidating"
  | "empty"
  | "filter-empty"
  | "success"
  | "degraded"
  | "error"
  | "cancelled"
  | "forbidden"
  | "unavailable"
  | "configuration-required";

export type StatePanelProps = {
  state: ProductState;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  compact?: boolean;
};

const stateLabels: Record<ProductState, string> = {
  loading: "불러오는 중",
  revalidating: "새로 확인하는 중",
  empty: "데이터 없음",
  "filter-empty": "검색 결과 없음",
  success: "완료",
  degraded: "제한된 상태",
  error: "오류",
  cancelled: "취소됨",
  forbidden: "접근할 수 없음",
  unavailable: "사용할 수 없음",
  "configuration-required": "설정 필요",
};

const assertiveStates = new Set<ProductState>([
  "error",
  "forbidden",
]);

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function StatePanel({
  state,
  title,
  description,
  action,
  children,
  className,
  compact = false,
}: StatePanelProps) {
  const assertive = assertiveStates.has(state);
  const busy = state === "loading" || state === "revalidating";

  return (
    <section
      className={classes("statePanel", `statePanel-${state}`, compact && "statePanelCompact", className)}
      data-state={state}
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
      aria-busy={busy || undefined}
    >
      <span className="statePanelMarker" aria-hidden="true" />
      <div className="statePanelCopy">
        <p className="statePanelLabel">{stateLabels[state]}</p>
        <h2>{title}</h2>
        {description ? <div className="statePanelDescription">{description}</div> : null}
        {children ? <div className="statePanelDetails">{children}</div> : null}
      </div>
      {action ? <div className="statePanelAction">{action}</div> : null}
    </section>
  );
}
