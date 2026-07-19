import type {
  EvaluationRunRecord,
} from "../repositories/contracts.ts";

/**
 * Code-backed record of the clean repository test run completed before this
 * manifest was added. It is development evidence, not a synthetic product
 * metric and not a substitute for a production evaluation store.
 */
export const VERIFIED_REPOSITORY_TEST_RUN: EvaluationRunRecord = {
  id: "repository-tests-2026-07-20-bfdf5a5",
  baselineVersion: null,
  candidateVersion: null,
  codeSha: "bfdf5a51f6491333d8cfe8f9ceff2f38e6e53c1a",
  modelVersion: "gemma-4-26b-a4b-it",
  promptVersion: "riskshield-interpreter-2026-07-19-v0.4.1-r2",
  schemaVersion: "1.1.0",
  datasetVersion: "repo-fixtures@bfdf5a5",
  testCount: 100,
  passed: 100,
  failed: 0,
  status: "passed",
  measuredAt: "2026-07-20T04:23:30+09:00",
  metrics: {
    falseHigh: null,
    falseNegative: null,
    unnecessaryReview: null,
    noMatch: null,
    jsonSuccessRate: null,
    providerFallbackRate: null,
    latencyP50Ms: null,
    latencyP95Ms: null,
    estimatedCostUsd: null,
  },
  profileSlices: null,
  contextSlices: null,
};
