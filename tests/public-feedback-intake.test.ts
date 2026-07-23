import assert from "node:assert/strict";
import test from "node:test";

import {
  publicFeedbackSearchPassed,
  verifyPublicFeedbackExpression,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/public-feedback/intake.ts";
import type { QualificationAssessment } from "../lib/collectors/google-qualification-provider";
import type { SearchVerification } from "../lib/collectors/google-search-verification-provider";

const signal = AbortSignal.timeout(1_000);

function qualification(overrides: Partial<QualificationAssessment> = {}): QualificationAssessment {
  return {
    normalized: "느개미",
    disposition: "review",
    role: "coded_expression",
    riskFamily: "coded_expression",
    confidence: 0.91,
    reason: "직접 비하에 쓰이는 코드 표현 가능성이 있습니다.",
    rejectReason: null,
    evidenceLabels: [{ id: "public-feedback-context", label: "coded_reference" }],
    ...overrides,
  };
}

function search(overrides: Partial<SearchVerification> = {}): SearchVerification {
  return {
    normalized: "느개미",
    decision: "send_to_review",
    role: "coded_expression",
    riskFamily: "coded_expression",
    meaning: "온라인에서 직접 비하에 쓰이는 변형 표현",
    confidence: 0.9,
    directUseSupported: true,
    reason: "검색에서 직접 비하 용례를 확인했습니다.",
    queries: ["느개미 뜻"],
    sources: [{ uri: "https://example.test/evidence", title: "용례" }],
    ...overrides,
  };
}

test("public feedback hard-rejects obvious quantity and date expressions before provider calls", async () => {
  let calls = 0;
  const result = await verifyPublicFeedbackExpression({ expression: "2026년", context: "2026년" }, {
    async qualify() { calls += 1; return []; },
    async verify() { calls += 1; return search(); },
  }, signal);
  assert.equal(result.status, "rejected");
  assert.equal(calls, 0);
});

test("public feedback rejects proper nouns and target entities without web promotion", async () => {
  for (const [expression, role] of [["배재고", "proper_noun"], ["호남", "target_entity"], ["지향", "common_word"]] as const) {
    let searchCalls = 0;
    const result = await verifyPublicFeedbackExpression({ expression, context: `${expression} 관련 문맥` }, {
      async qualify() { return [qualification({ normalized: expression, disposition: "reject", role, riskFamily: "none" })]; },
      async verify() { searchCalls += 1; return search(); },
    }, signal);
    assert.equal(result.status, "rejected", expression);
    assert.equal(searchCalls, 0, expression);
  }
});

test("verified coded expression is promoted only with grounded direct-use evidence", async () => {
  const result = await verifyPublicFeedbackExpression({ expression: "느개미", context: "너 진짜 느개미네" }, {
    async qualify() { return [qualification()]; },
    async verify() { return search(); },
  }, signal);
  assert.equal(result.status, "promoted");
  assert.equal(result.searchVerification?.sources.length, 1);
});

test("search absence or insufficient grounding stays monitor rather than safe or promoted", async () => {
  const result = await verifyPublicFeedbackExpression({ expression: "느개미", context: "너 진짜 느개미네" }, {
    async qualify() { return [qualification()]; },
    async verify() { return search({ decision: "monitor", directUseSupported: false, sources: [], confidence: 0.62 }); },
  }, signal);
  assert.equal(result.status, "monitor");
  assert.equal(publicFeedbackSearchPassed(search({ sources: [] })), false);
});

test("deceptive claims share the same review gate", async () => {
  const result = await verifyPublicFeedbackExpression({ expression: "원금 손실 없이 월 20% 보장", context: "원금 손실 없이 월 20% 보장" }, {
    async qualify() { return [qualification({ normalized: "원금 손실 없이 월 20% 보장", role: "deceptive_claim", riskFamily: "deceptive_claim" })]; },
    async verify() { return search({ normalized: "원금 손실 없이 월 20% 보장", role: "deceptive_claim", riskFamily: "deceptive_claim" }); },
  }, signal);
  assert.equal(result.status, "promoted");
});

test("provider errors propagate so the route can persist verification_error and retry", async () => {
  await assert.rejects(() => verifyPublicFeedbackExpression({ expression: "느개미", context: "너 진짜 느개미네" }, {
    async qualify() { return [qualification()]; },
    async verify() { throw Object.assign(new Error("rate limited"), { code: "collector_search_verification_rate_limited" }); },
  }, signal), /rate limited/u);
});
