import assert from "node:assert/strict";
import test from "node:test";

import {
  loadAnalyzerV4Adapter,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/analyzer-v4-adapter.ts";
import {
  buildExportBundle,
  DEFAULT_SEVERITY_RULES,
  starterSkills,
  type BundleFiles,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";

function buildFiveExportedFiles(): BundleFiles {
  const exported = buildExportBundle(
    starterSkills,
    new Date("2026-07-17T12:34:56.000Z"),
    DEFAULT_SEVERITY_RULES,
  );

  return {
    "risk_skills.jsonl": exported.riskSkillsJsonl,
    "trend_context.json": `${JSON.stringify(exported.trendContext, null, 2)}\n`,
    "severity_rules.json": `${JSON.stringify(exported.severityRules, null, 2)}\n`,
    "rewrite_templates.json": `${JSON.stringify(exported.rewriteTemplates, null, 2)}\n`,
    "source_index.json": `${JSON.stringify(exported.sourceIndex, null, 2)}\n`,
  };
}

test("Analyzer v4 imports the five builder exports and analyzes reviewed skills", () => {
  const adapter = loadAnalyzerV4Adapter(buildFiveExportedFiles());

  assert.equal(adapter.reviewedSkillCount, 8);
  assert.deepEqual(adapter.severityRules, DEFAULT_SEVERITY_RULES);

  const positive = adapter.analyze("15초만에 형량 분석");
  assert.ok(positive.finalScore >= 78);
  assert.equal(
    positive.primaryMatch?.skill.patternType,
    "short_time_claim + legal_judgment",
  );

  const safeNegative = adapter.analyze("15초 만에 상담 신청을 접수합니다.");
  assert.equal(safeNegative.finalScore, 0);
  assert.equal(safeNegative.matches.length, 0);
});

test("Analyzer v4 rejects missing or malformed risk_skills.jsonl", () => {
  assert.throws(
    () => loadAnalyzerV4Adapter({}),
    /risk_skills\.jsonl 파일이 필요합니다/u,
  );
  assert.throws(
    () => loadAnalyzerV4Adapter({ "risk_skills.jsonl": "{not-json}\n" }),
    /risk_skills\.jsonl 1행/u,
  );
});
