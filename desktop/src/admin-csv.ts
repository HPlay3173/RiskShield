import type {
  FallbackRuleInput,
  FallbackRuleSeverity,
} from "./types";

export type FallbackRuleCsvResult = {
  rules: FallbackRuleInput[];
  issues: string[];
};

function parseRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\"") {
      if (quoted && text[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizedHeader(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/gu, "");
  const aliases: Record<string, string> = {
    표현: "expression",
    위험표현: "expression",
    expression: "expression",
    범주: "category",
    카테고리: "category",
    category: "category",
    위험도: "severity",
    severity: "severity",
    이유: "reason",
    설명: "reason",
    reason: "reason",
    활성: "enabled",
    enabled: "enabled",
  };
  return aliases[normalized] ?? normalized;
}

function parseSeverity(value: string): FallbackRuleSeverity | null {
  const normalized = value.trim().toLowerCase();
  if (["high", "높음", "높은위험"].includes(normalized)) return "high";
  if (["review", "검토", "추가검토", "주의"].includes(normalized)) return "review";
  if (["low", "낮음", "낮은위험"].includes(normalized)) return "low";
  return null;
}

function parseEnabled(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return !["false", "0", "아니오", "비활성", "off"].includes(normalized);
}

export function parseFallbackRulesCsv(text: string): FallbackRuleCsvResult {
  const rows = parseRows(text.replace(/^\uFEFF/u, ""));
  if (rows.length === 0) return { rules: [], issues: ["CSV가 비어 있습니다."] };
  const headers = rows[0].map(normalizedHeader);
  const expressionIndex = headers.indexOf("expression");
  if (expressionIndex < 0) {
    return { rules: [], issues: ["expression 또는 표현 열이 필요합니다."] };
  }

  const categoryIndex = headers.indexOf("category");
  const severityIndex = headers.indexOf("severity");
  const reasonIndex = headers.indexOf("reason");
  const enabledIndex = headers.indexOf("enabled");
  const rules: FallbackRuleInput[] = [];
  const issues: string[] = [];

  rows.slice(1).forEach((row, index) => {
    const expression = row[expressionIndex]?.trim() ?? "";
    if (!expression) {
      issues.push(`${index + 2}행: 표현이 비어 있습니다.`);
      return;
    }
    const severity = parseSeverity(row[severityIndex] ?? "review");
    if (!severity) {
      issues.push(`${index + 2}행: 위험도는 low/review/high 중 하나여야 합니다.`);
      return;
    }
    const category = row[categoryIndex]?.trim() || "관리자 보완 규칙";
    rules.push({
      expression,
      category,
      severity,
      reason: row[reasonIndex]?.trim() || `${category} 위험 표현으로 관리자 검토 후 추가됨`,
      enabled: parseEnabled(row[enabledIndex] ?? ""),
      source: "csv",
    });
  });

  return { rules, issues };
}

function escapeCsv(value: string) {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value;
}

export function exportFallbackRulesCsv(rules: FallbackRuleInput[]) {
  const lines = ["expression,category,severity,reason,enabled"];
  for (const rule of rules) {
    lines.push([
      rule.expression,
      rule.category,
      rule.severity,
      rule.reason,
      String(rule.enabled),
    ].map(escapeCsv).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
