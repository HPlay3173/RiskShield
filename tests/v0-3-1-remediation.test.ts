import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeText,
  parseCsv,
  type RiskSkill,
  type SeverityRules,
// @ts-expect-error Node strips TypeScript directly and requires this runtime extension.
} from "../lib/riskshield.ts";

const snapshot = JSON.parse(
  readFileSync(new URL("../artifacts/v0.3-final/postmerge-d1-snapshot.json", import.meta.url), "utf8"),
) as { skills: RiskSkill[]; severityRules: SeverityRules };
const reviewedSkills = snapshot.skills.filter((skill) => skill.reviewStatus === "reviewed");

function csvRecords(relativeUrl: string) {
  const [headers, ...rows] = parseCsv(
    readFileSync(new URL(relativeUrl, import.meta.url), "utf8").replace(/^\uFEFF/u, ""),
  );
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  return { headers, rows, column };
}

function resultFor(text: string) {
  return analyzeText(text, snapshot.skills, { severityRules: snapshot.severityRules });
}

test("the common post-match guard suppresses warnings while preserving reversal promotions", () => {
  const guarded = [
    "보장할 수 있는 투자는 없습니다.",
    "고수익과 원금 보장을 내세운 사기를 주의하세요.",
    "과장 수익 앱을 피해야 합니다.",
    "부업 소득 보장 광고를 주의하세요.",
    "몰래 위치 추적 피해를 예방해야 합니다.",
    "‘원금 보장’이라는 문구는 사용 금지입니다.",
  ];
  for (const input of guarded) {
    assert.notEqual(resultFor(input).status, "high", input);
  }

  for (const input of [
    "불법이지만 몰래 추적해 드립니다.",
    "사기라고 의심받지만 수익은 반드시 보장됩니다.",
  ]) {
    assert.equal(resultFor(input).status, "high", input);
  }
});

test("Korean variants preserve semantic combinations instead of single-word highs", () => {
  const highCases = [
    "이 제품은 부작용이 하나도 없습니다.",
    "이 시술의 안전성을 100% 보장합니다.",
    "수강생을 모두 합격시켜 줍니다.",
    "이 과정은 특채를 보장합니다.",
    "감시 앱은 아이콘을 숨겨 실행합니다.",
    "앱 목록에 표시되지 않는 추적 프로그램입니다.",
    "상대방 모르게 메시지를 읽는 방법을 제공합니다.",
  ];
  for (const input of highCases) assert.equal(resultFor(input).status, "high", input);

  for (const input of [
    "부작용 사례를 집계합니다.",
    "안전 교육을 진행합니다.",
    "특채 전형 일정을 안내합니다.",
    "앱 아이콘 디자인을 변경합니다.",
    "설치 미술 작품의 아이콘을 숨겨 배치했습니다.",
  ]) {
    assert.notEqual(resultFor(input).status, "high", input);
  }
});

test("adjacent matching is capped at two sentences in the same paragraph", () => {
  assert.notEqual(resultFor("72시간 한정입니다. 지금 구매하세요.").status, "no_match");
  assert.equal(resultFor("승소 가능성은 90%입니다. 결과를 책임지겠습니다.").status, "high");
  assert.equal(
    resultFor("72시간 한정입니다. 제품 설명입니다. 배송 안내입니다. 지금 구매하세요.").status,
    "no_match",
  );
  assert.equal(resultFor("72시간 한정입니다.\n\n지금 구매하세요.").status, "no_match");
});

test("the locked frozen 100 satisfy every v0.3.1 local deployment gate", () => {
  const casesBuffer = readFileSync(new URL("../artifacts/v0.3-final/final-blind-cases.csv", import.meta.url));
  const freeze = JSON.parse(
    readFileSync(new URL("../artifacts/v0.3-final/final-blind-freeze.json", import.meta.url), "utf8"),
  ) as { casesSha256: string };
  assert.equal(createHash("sha256").update(casesBuffer).digest("hex"), freeze.casesSha256);

  const { rows, column } = csvRecords("../artifacts/v0.3-final/final-blind-cases.csv");
  assert.equal(rows.length, 100);
  const evaluated = rows.map((row) => ({ row, result: resultFor(row[column.original_text]) }));
  const risky = evaluated.filter(({ row }) => row[column.expected_class] === "risky");
  const highConfidenceRisky = risky.filter(({ row }) => row[column.label_confidence] === "high");
  const safe = evaluated.filter(({ row }) => row[column.expected_class] === "safe");

  assert.ok(
    highConfidenceRisky.filter(({ result }) => result.status !== "no_match").length
      / highConfidenceRisky.length >= 0.85,
  );
  assert.ok(safe.filter(({ result }) => result.status !== "no_match").length / safe.length <= 0.05);
  assert.equal(safe.filter(({ result }) => result.status === "high").length, 0);

  for (const domain of ["health", "finance", "education", "legal", "general", "privacy"]) {
    const domainRisky = risky.filter(({ row }) => row[column.domain] === domain);
    assert.ok(
      domainRisky.filter(({ result }) => result.status !== "no_match").length / domainRisky.length >= 0.6,
      domain,
    );
  }
});

test("the new development set is balanced, novel, and passes the clear-case gate", () => {
  const dev = csvRecords("../artifacts/v0.3.1/development-cases.csv");
  const frozen = csvRecords("../artifacts/v0.3-final/final-blind-cases.csv");
  assert.equal(dev.rows.length, 60);
  assert.deepEqual(
    Object.fromEntries(["risky", "safe", "boundary"].map((type) => [
      type,
      dev.rows.filter((row) => row[dev.column.case_type] === type).length,
    ])),
    { risky: 30, safe: 20, boundary: 10 },
  );
  const frozenTexts = new Set(frozen.rows.map((row) => row[frozen.column.original_text]));
  assert.equal(dev.rows.filter((row) => frozenTexts.has(row[dev.column.original_text])).length, 0);

  const clusters = new Set(dev.rows.map((row) => row[dev.column.cluster]));
  assert.equal(clusters.size, 10);
  for (const cluster of clusters) {
    assert.ok(
      dev.rows.filter((row) => row[dev.column.cluster] === cluster && row[dev.column.case_type] === "risky").length >= 3,
      cluster,
    );
  }

  const clear = dev.rows.filter((row) => row[dev.column.clarity] === "clear");
  const passed = clear.filter((row) => {
    const result = resultFor(row[dev.column.original_text]);
    const [min, max] = row[dev.column.expected_range].split("-").map(Number);
    const type = row[dev.column.case_type];
    const classPass = type === "risky"
      ? result.status !== "no_match"
      : type === "safe"
        ? result.status === "no_match"
        : result.status !== "high";
    return classPass && result.finalScore >= min && result.finalScore <= max;
  });
  assert.ok(passed.length / clear.length >= 0.95, `${passed.length}/${clear.length}`);
});

test("the six review-only rules remain non-dominant and cannot become primary high", () => {
  const reviewOnlyIds = new Set([
    "risk_v03_legal_substantiation",
    "risk_v03_general_substantiation",
    "risk_v03_general_urgency",
    "risk_v03_income_guarantee",
    "risk_v03_education_substantiation",
    "risk_v03_privacy_data_access_review",
  ]);
  const reviewOnly = reviewedSkills.filter((skill) => reviewOnlyIds.has(skill.id));
  assert.equal(reviewOnly.length, 6);
  assert.ok(reviewOnly.every((skill) => !skill.dominantRisk && skill.severityFloor >= 55 && skill.severityFloor <= 60));

  const { rows, column } = csvRecords("../artifacts/v0.3.1/development-cases.csv");
  for (const row of rows) {
    const result = resultFor(row[column.original_text]);
    if (result.status === "high") {
      assert.ok(!reviewOnlyIds.has(result.primaryMatch?.skill.id ?? ""), row[column.case_id]);
    }
  }
});
