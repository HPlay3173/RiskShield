import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_SEVERITY_RULES,
  MockInterpreter,
  RISK_SKILL_SCHEMA_VERSION,
  analyzeText,
  buildExportBundle,
  parseBundleFiles,
  parseRiskSkillsJsonl,
  starterSkills,
  type BundleFiles,
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";

const fixedTime = new Date("2026-07-17T12:34:56.000Z");

function filesFor(bundle: ReturnType<typeof buildExportBundle>): BundleFiles {
  return {
    "risk_skills.jsonl": bundle.riskSkillsJsonl,
    "trend_context.json": JSON.stringify(bundle.trendContext),
    "severity_rules.json": JSON.stringify(bundle.severityRules),
    "rewrite_templates.json": JSON.stringify(bundle.rewriteTemplates),
    "source_index.json": JSON.stringify(bundle.sourceIndex),
  };
}

test("the provided legacy sample JSONL migrates to the v2 condition contract", async () => {
  const source = await readFile(
    new URL("./fixtures/sample_risk_skills.jsonl", import.meta.url),
    "utf8",
  );
  const parsed = parseRiskSkillsJsonl(source);

  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.skills.length, 2);
  for (const skill of parsed.skills) {
    assert.equal(skill.schemaVersion, RISK_SKILL_SCHEMA_VERSION);
    assert.equal(skill.revision, 1);
    assert.equal(skill.conditionScope, "sentence");
    assert.equal(skill.maxDistance, 48);
    assert.ok(skill.triggerPatterns.length > 0);
    assert.ok(skill.contextPatterns.length > 0);
    assert.equal(skill.reviewStatus, "draft");
    assert.match(skill.source.sourceId ?? "", /^legacy_risk_/u);
  }
});

test("five files survive import, edit, export, and re-import without semantic loss", () => {
  const firstExport = buildExportBundle(starterSkills, fixedTime);
  const firstImport = parseBundleFiles(filesFor(firstExport));
  assert.deepEqual(firstImport.issues, []);
  assert.equal(firstImport.filesLoaded.length, 5);

  const edited = firstImport.skills.map((skill, index) => index === 0
    ? {
        ...skill,
        revision: skill.revision + 1,
        notes: "왕복 편집 확인",
        safeRewrite: [...skill.safeRewrite, "검토 근거와 조건을 함께 안내합니다."],
      }
    : skill);
  const secondExport = buildExportBundle(edited, fixedTime, firstImport.severityRules);
  const secondImport = parseBundleFiles(filesFor(secondExport));

  assert.deepEqual(secondImport.issues, []);
  assert.equal(secondImport.skills[0].notes, "왕복 편집 확인");
  assert.equal(secondImport.skills[0].revision, edited[0].revision);
  assert.deepEqual(
    buildExportBundle(secondImport.skills, fixedTime, secondImport.severityRules),
    secondExport,
  );
});

test("scope, distance, any_of, none_of, and rejected lifecycle are enforced", () => {
  const base = starterSkills.find((skill) => skill.id === "risk_education_000001");
  assert.ok(base);
  const paragraphSkill: RiskSkill = {
    ...base,
    id: "risk_scope_test",
    triggerPatterns: ["합격"],
    contextPatterns: ["보장"],
    anyOfPatterns: ["광고"],
    exclusionPatterns: ["공익 안내"],
    conditionScope: "paragraph",
    maxDistance: 80,
  };

  assert.equal(analyzeText("합격 안내입니다. 광고 문구로 보장합니다.", [paragraphSkill]).matches.length, 1);
  assert.equal(
    analyzeText("합격 안내입니다.\n\n광고 문구로 보장합니다.", [paragraphSkill]).matches.length,
    0,
    "paragraph boundary must isolate evidence",
  );
  assert.equal(analyzeText("합격 보장", [paragraphSkill]).matches.length, 0, "any_of is required");
  assert.equal(
    analyzeText("합격 광고 보장 · 공익 안내", [paragraphSkill]).matches.length,
    0,
    "none_of excludes the scoped match",
  );
  assert.equal(
    analyzeText(`합격 ${"가".repeat(100)} 광고 보장`, [paragraphSkill]).matches.length,
    0,
    "max_distance limits the widest evidence gap",
  );

  const rejected = { ...paragraphSkill, reviewStatus: "rejected" as const };
  assert.equal(
    analyzeText("합격 광고 보장", [rejected], { includeDrafts: true }).matches.length,
    0,
    "rejected skills never become active",
  );
});

test("severity policy from the bundle controls scoring and grade thresholds", () => {
  const base = starterSkills[0];
  const first: RiskSkill = {
    ...base,
    id: "risk_policy_a",
    severityFloor: 60,
    dominantRisk: false,
  };
  const second: RiskSkill = {
    ...first,
    id: "risk_policy_b",
    patternType: first.patternType + " + corroboration",
  };
  const strictPolicy = {
    ...DEFAULT_SEVERITY_RULES,
    categoryCorroborationPerPattern: 10,
    maxCategoryCorroboration: 20,
    gradeThresholds: DEFAULT_SEVERITY_RULES.gradeThresholds.map((threshold) => ({ ...threshold })),
  };

  const defaultResult = analyzeText("15초만에 형량 분석", [first, second]);
  const strictResult = analyzeText("15초만에 형량 분석", [first, second], {
    severityRules: strictPolicy,
  });
  assert.equal(defaultResult.finalScore, 62);
  assert.equal(strictResult.finalScore, 70);
  assert.equal(strictResult.grade, "주의");
});

test("bundle parser reports malformed or missing owner files", () => {
  assert.match(parseBundleFiles({}).issues.join(" "), /risk_skills\.jsonl/u);
  assert.match(
    parseBundleFiles({ "risk_skills.jsonl": "{not json}" }).issues.join(" "),
    /올바른 JSON/u,
  );
});

test("replaceable MockInterpreter creates a reviewable candidate without external AI", () => {
  const draft = MockInterpreter.interpret(
    {
      text: "새로운 캠페인 문구",
      description: "규칙 기반 후보 생성 확인",
      domain: "브랜드 평판 위험",
      occurredAt: "2026-07-17",
      sourceUrl: "",
      memo: "사람 검토 전 후보",
    },
    starterSkills,
    new Date("2026-07-17T12:00:00.000Z"),
  );

  assert.equal(MockInterpreter.id, "riskshield.mock-interpreter.v1");
  assert.equal(draft.reviewStatus, "draft");
  assert.equal(draft.notes, "사람 검토 전 후보");
  assert.ok(draft.triggerPatterns.length > 0);
  assert.ok(draft.contextPatterns.length > 0);
  assert.equal(
    analyzeText("새로운 캠페인 문구", [draft], { includeDrafts: true }).matches.length,
    1,
  );
});
