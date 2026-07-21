import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeText,
  buildExportBundle,
  buildHighlightSegments,
  parseCsv,
  starterSkills,
  validateSkill,
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";

const behaviorCsv = readFileSync(
  new URL("./fixtures/test_cases_expected_behavior.csv", import.meta.url),
  "utf8",
);
const [behaviorHeaders, ...behaviorRows] = parseCsv(behaviorCsv.replace(/^\uFEFF/u, ""));
const behaviorIndex = Object.fromEntries(behaviorHeaders.map((header, index) => [header, index]));
const positiveCases = behaviorRows.map((row) => ({
  text: row[behaviorIndex.input_text],
  category: row[behaviorIndex.expected_category],
  patternType: row[behaviorIndex.expected_pattern_type],
  minimum: Number(row[behaviorIndex.expected_min_score]),
}));

test("the eight handoff cases match reusable two-part skills at their required floors", () => {
  for (const expected of positiveCases) {
    const result = analyzeText(expected.text, starterSkills);
    const match = result.matches.find(
      (candidate) => candidate.skill.patternType === expected.patternType,
    );

    assert.ok(match, `expected ${expected.patternType} for: ${expected.text}`);
    assert.equal(match.skill.category, expected.category);
    assert.ok(result.finalScore >= expected.minimum);
    assert.ok(match.score >= expected.minimum);
    assert.deepEqual(new Set(match.hits.map((hit) => hit.role)), new Set(["trigger", "context"]));
    assert.equal(match.hits[0].sentenceIndex, match.hits[1].sentenceIndex);
    assert.ok(
      match.hits[0].end <= match.hits[1].start || match.hits[1].end <= match.hits[0].start,
      "semantic groups must use distinct evidence spans",
    );
    for (const hit of match.hits) {
      assert.equal(hit.text, expected.text.slice(hit.start, hit.end));
    }
  }
});

const negativeCases = [
  ["보장", "a single general word is not a combination"],
  ["할인", "a single commerce word is not a sensitive context"],
  ["15초 만에 상담 신청을 접수합니다.", "time claim without a legal judgment"],
  ["형량 분석에는 사실관계 검토가 필요합니다.", "legal judgment without a short-time claim"],
  ["배송 지연 시 100% 환불해 드립니다.", "refund without a legal outcome"],
  ["잊지말자 6·25, 희생을 기억합니다.", "historical remembrance without commerce"],
  ["625% 성장률을 기록했습니다.", "percentage without historical memory"],
  ["침투하자 더 깊게 — 모의 해킹 교육 실습", "explicit security-training exclusion"],
  ["고객의 필요를 더 깊게 이해합니다.", "suggestive phrase without aggression"],
  ["합격을 목표로 맞춤 학습을 제공합니다.", "education outcome without guarantee"],
  ["합격을 보장하지 않습니다.", "explicitly denied education guarantee"],
  ["합격자 발표 일정과 품질 보장 정책을 안내합니다.", "compound boundary and unrelated guarantee"],
  ["치료비를 100% 지원합니다.", "support rate rather than a medical effect"],
  ["100% 완치를 보장할 수 없습니다.", "explicitly denied medical guarantee"],
  ["지난달 월 수익을 공개하지만 수익을 보장하지 않습니다.", "explicitly denied return guarantee"],
  ["몰래카메라 탐지기의 위치를 분석합니다.", "몰래 must not match inside 몰래카메라"],
  ["동의 없이 위치 정보를 수집하지 않습니다.", "explicit denial of nonconsensual collection"],
] as const;

test("meaningful negative and false-positive cases do not become active findings", () => {
  for (const [text, reason] of negativeCases) {
    const result = analyzeText(text, starterSkills);
    assert.equal(result.finalScore, 0, `${reason}: ${text}`);
    assert.equal(result.grade, "미탐지", `${reason}: ${text}`);
    assert.equal(result.matches.length, 0, `${reason}: ${text}`);
    assert.match(result.recommendation, /자동 승인이나 안전 보장을 의미하지 않습니다/);
  }
});

test("reviewed coded expressions match atomically while warning context is suppressed", () => {
  const direct = analyzeText("느개미", starterSkills);
  assert.equal(direct.primaryMatch?.skill.riskFamily, "coded_expression");
  assert.ok(direct.finalScore >= 78);

  const warning = analyzeText("느개미라는 표현은 사용하지 마세요", starterSkills);
  assert.equal(warning.matches.length, 0);
  assert.equal(warning.finalScore, 0);
});

test("required groups never combine across sentence boundaries", () => {
  const result = analyzeText(
    "15초만에 상담 접수가 끝났습니다. 형량 분석은 별도로 진행됩니다.",
    starterSkills,
  );
  assert.equal(result.finalScore, 0);
});

test("one occurrence cannot satisfy both semantic groups", () => {
  const base = starterSkills.find((skill) => skill.id === "risk_education_000001");
  assert.ok(base);
  const sameSpanSkill: RiskSkill = {
    ...base,
    id: "risk_distinct_span_test",
    triggerPatterns: ["보장"],
    contextPatterns: ["보장"],
  };
  const result = analyzeText("보장", [sameSpanSkill]);
  assert.equal(result.finalScore, 0);
});

test("normalization preserves original UTF-16 highlight offsets", () => {
  const input = "🔥 １００％ 완치";
  const result = analyzeText(input, starterSkills);
  assert.equal(result.primaryMatch?.skill.id, "risk_medical_000001");
  const hits = result.primaryMatch?.hits ?? [];
  const segments = buildHighlightSegments(input, hits);

  assert.equal(segments.map((segment) => segment.text).join(""), input);
  for (const hit of hits) assert.equal(hit.text, input.slice(hit.start, hit.end));
  assert.ok(hits.some((hit) => hit.text === "１００％"));
});

test("exports are stably sorted and JSONL ends with exactly one newline", () => {
  const fixedTime = new Date("2026-07-17T12:34:56.000Z");
  const forward = buildExportBundle(starterSkills, fixedTime);
  const reversed = buildExportBundle([...starterSkills].reverse(), fixedTime);

  assert.deepEqual(reversed, forward);
  assert.ok(forward.riskSkillsJsonl.endsWith("\n"));
  assert.ok(!forward.riskSkillsJsonl.endsWith("\n\n"));
  const records = forward.riskSkillsJsonl.trimEnd().split("\n").map((line) => JSON.parse(line));
  const ids = records.map((record) => record.id as string);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(records.length, starterSkills.filter((skill) => skill.reviewStatus === "reviewed").length);
});

test("drafts may retain unverified sources but reviewed exports may not", () => {
  const reviewed = starterSkills[0];
  const unverifiedDraft: RiskSkill = {
    ...reviewed,
    id: "risk_unverified_draft",
    reviewStatus: "draft",
    source: {
      title: "Mock interpreter output",
      url: "",
      date: "",
      sourceId: "mock_1",
      provenanceStatus: "synthetic_unverified",
    },
  };
  assert.deepEqual(validateSkill(unverifiedDraft), []);

  const invalidReviewed = { ...unverifiedDraft, reviewStatus: "reviewed" as const };
  assert.ok(validateSkill(invalidReviewed).some((error) => error.includes("검증되지 않은 합성 출처")));
  assert.equal(buildExportBundle([invalidReviewed], new Date(0)).riskSkillsJsonl, "");
});
