import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateRecord } from "../lib/repositories/contracts.ts";
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
import { D1CandidateRepository, visibleInDefaultCandidateInbox } from "../lib/repositories/d1.ts";

function collectorCandidate(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: "collector_candidate_test",
    expression: "느개미",
    riskDomain: "자동 수집",
    reportType: "collector_discovery",
    status: "pending",
    noveltyScore: null,
    confidence: 0.84,
    sourceCount: 3,
    createdAt: "2026-07-23T00:00:00.000Z",
    qualityGateVersion: "collector-semantic-search-v1",
    qualification: {
      disposition: "review",
      role: "coded_expression",
      confidence: 0.84,
      reason: "직접 비하 문맥이 확인됨",
      distinctAuthorCount: 3,
      observationCount: 4,
    },
    searchVerification: {
      decision: "send_to_review",
      role: "coded_expression",
      meaning: "비하 목적의 변형 은어",
      riskFamily: "coded_expression",
      confidence: 0.89,
      directUseSupported: true,
      reason: "검색에서 직접 사용을 확인함",
      queries: ["느개미 뜻"],
      sources: [{ uri: "https://example.test/evidence", title: "근거" }],
    },
    ...overrides,
  };
}

test("default candidate inbox only admits fully verified collector candidates", () => {
  assert.equal(visibleInDefaultCandidateInbox(collectorCandidate()), true);
  assert.equal(visibleInDefaultCandidateInbox(collectorCandidate({ qualityGateVersion: undefined })), false);
  assert.equal(visibleInDefaultCandidateInbox(collectorCandidate({ qualification: { ...collectorCandidate().qualification!, role: "target_entity" } })), false);
  assert.equal(visibleInDefaultCandidateInbox(collectorCandidate({ searchVerification: { ...collectorCandidate().searchVerification!, decision: "monitor" } })), false);
});

test("default candidate inbox preserves user and dataset candidates", () => {
  assert.equal(visibleInDefaultCandidateInbox(collectorCandidate({ reportType: "missed_detection", qualityGateVersion: undefined, qualification: undefined, searchVerification: undefined })), true);
  assert.equal(visibleInDefaultCandidateInbox(collectorCandidate({ reportType: undefined, qualityGateVersion: undefined, qualification: undefined, searchVerification: undefined })), true);
});

test("valid candidates are not hidden behind a full page of legacy collector rows", async () => {
  const legacy = collectorCandidate({ qualityGateVersion: undefined, qualification: undefined, searchVerification: undefined });
  const valid = collectorCandidate({ id: "dataset_candidate", reportType: undefined, qualityGateVersion: undefined, qualification: undefined, searchVerification: undefined });
  const rows = [
    ...Array.from({ length: 250 }, (_, index) => ({ id: `legacy_${index}`, status: "pending", payload: JSON.stringify({ ...legacy, id: `legacy_${index}` }), created_at: legacy.createdAt })),
    { id: valid.id, status: "pending", payload: JSON.stringify(valid), created_at: valid.createdAt },
  ];
  const db = {
    prepare() {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async all<T>() {
          const limit = Number(values[0]);
          const offset = Number(values[1]);
          return { results: rows.slice(offset, offset + limit) as T[], success: true };
        },
      };
      return statement;
    },
  } as unknown as D1Database;

  const result = await new D1CandidateRepository(db).list();
  assert.equal(result.status, "ready");
  if (result.status === "ready") assert.deepEqual(result.data.items.map((item) => item.id), ["dataset_candidate"]);
});
