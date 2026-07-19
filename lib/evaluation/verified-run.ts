import type {
  EvaluationRunRecord,
} from "../repositories/contracts.ts";

/**
 * Code-backed record of the clean repository test run completed before this
 * manifest was added. It is development evidence, not a synthetic product
 * metric and not a substitute for a production evaluation store.
 */
export const VERIFIED_REPOSITORY_TEST_RUN: EvaluationRunRecord = {
  id: "repository-tests-2026-07-20-abee502",
  baselineVersion: null,
  candidateVersion: null,
  codeSha: "abee50248c8e06795e294b7d079014e021c15030",
  modelVersion: "gemma-4-26b-a4b-it",
  promptVersion: "riskshield-interpreter-2026-07-19-v0.4.1-r2",
  schemaVersion: "1.1.0",
  datasetVersion: "repo-fixtures@abee502",
  testCount: 103,
  passed: 103,
  failed: 0,
  status: "passed",
  measuredAt: "2026-07-20T04:33:54+09:00",
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
