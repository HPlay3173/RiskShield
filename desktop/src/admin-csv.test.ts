import { describe, expect, it } from "vitest";
import {
  exportFallbackRulesCsv,
  parseFallbackRulesCsv,
} from "./admin-csv";

describe("fallback rule CSV", () => {
  it("accepts English and Korean headers", () => {
    const result = parseFallbackRulesCsv([
      "표현,범주,위험도,이유,활성",
      "새 은어,숨은 은어,높음,\"쉼표, 포함 이유\",예",
    ].join("\n"));
    expect(result.issues).toEqual([]);
    expect(result.rules).toEqual([{
      expression: "새 은어",
      category: "숨은 은어",
      severity: "high",
      reason: "쉼표, 포함 이유",
      enabled: true,
      source: "csv",
    }]);
  });

  it("rejects missing expressions and invalid severities", () => {
    const result = parseFallbackRulesCsv([
      "expression,severity",
      ",high",
      "표현,extreme",
    ].join("\n"));
    expect(result.rules).toEqual([]);
    expect(result.issues).toHaveLength(2);
  });

  it("round-trips exported rules", () => {
    const csv = exportFallbackRulesCsv([{
      expression: "표현, 하나",
      category: "범주",
      severity: "review",
      reason: "설명 \"인용\"",
      enabled: false,
      source: "missed",
    }]);
    const parsed = parseFallbackRulesCsv(csv);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rules[0]).toMatchObject({
      expression: "표현, 하나",
      severity: "review",
      enabled: false,
    });
  });
});
