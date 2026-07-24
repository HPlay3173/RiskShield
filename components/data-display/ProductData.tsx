import type { Key, ReactNode } from "react";

export type ProductDefinitionItem = {
  key: Key;
  term: ReactNode;
  description: ReactNode;
};

export type ProductDefinitionListProps = {
  items: readonly ProductDefinitionItem[];
  className?: string;
  label?: string;
};

export type ProductMetric = {
  key: Key;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "critical";
  numeric?: boolean;
};

export type ProductMetricGridProps = {
  metrics: readonly ProductMetric[];
  className?: string;
  label?: string;
};

export type ProductDataColumn<Row> = {
  key: string;
  header: ReactNode;
  render: (row: Row, index: number) => ReactNode;
  align?: "start" | "center" | "end";
  numeric?: boolean;
  rowHeader?: boolean;
};

export type ProductDataTableProps<Row> = {
  caption: ReactNode;
  columns: readonly ProductDataColumn<Row>[];
  rows: readonly Row[];
  getRowKey: (row: Row, index: number) => Key;
  emptyContent?: ReactNode;
  className?: string;
  rowClassName?: (row: Row, index: number) => string | undefined;
};

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ProductDefinitionList({
  items,
  className,
  label,
}: ProductDefinitionListProps) {
  return (
    <dl className={classes("productDefinitionList", className)} aria-label={label}>
      {items.map((item) => (
        <div className="productDefinitionItem" key={item.key}>
          <dt>{item.term}</dt>
          <dd>{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProductMetricGrid({ metrics, className, label }: ProductMetricGridProps) {
  return (
    <dl className={classes("productMetricGrid", className)} aria-label={label}>
      {metrics.map((metric) => (
        <div
          className={classes("productMetric", metric.tone && `productMetric-${metric.tone}`)}
          key={metric.key}
          data-tone={metric.tone ?? "neutral"}
        >
          <dt>{metric.label}</dt>
          <dd className={classes("productMetricValue", metric.numeric && "productNumericValue")}>
            {metric.value}
          </dd>
          {metric.detail ? <div className="productMetricDetail">{metric.detail}</div> : null}
        </div>
      ))}
    </dl>
  );
}

export function ProductDataTable<Row>({
  caption,
  columns,
  rows,
  getRowKey,
  emptyContent = "표시할 데이터가 없습니다.",
  className,
  rowClassName,
}: ProductDataTableProps<Row>) {
  return (
    <div
      className={classes("productDataTableScroller", className)}
      role="region"
      aria-label={typeof caption === "string" ? `${caption} 표` : "데이터 표"}
      tabIndex={0}
    >
      <table className="productDataTable">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={classes(
                  `productDataAlign-${column.align ?? "start"}`,
                  column.numeric && "productNumericValue",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="productDataEmptyCell" colSpan={Math.max(1, columns.length)}>
                {emptyContent}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={getRowKey(row, rowIndex)} className={rowClassName?.(row, rowIndex)}>
                {columns.map((column) => {
                  const content = column.render(row, rowIndex);
                  const cellClassName = classes(
                    `productDataAlign-${column.align ?? "start"}`,
                    column.numeric && "productNumericValue",
                  );
                  return column.rowHeader ? (
                    <th key={column.key} scope="row" className={cellClassName}>
                      {content}
                    </th>
                  ) : (
                    <td key={column.key} className={cellClassName}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
