import type { AnalysisResult } from "../../lib/riskshield";

export type RulesAnalysis = AnalysisResult;

export type AccountInfo = {
  connected: boolean;
  email: string | null;
  planType: string | null;
  authMode: string | null;
};

export type LoginChallenge = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
};

export type RateWindow = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
};

export type RateLimits = {
  primary: RateWindow | null;
  secondary: RateWindow | null;
  reachedType: string | null;
};

export type AiFinding = {
  category: string;
  severity: "low" | "review" | "high";
  evidence: string;
  explanation: string;
  rewrite: string | null;
  confidence: number;
};

export type AiAnalysis = {
  summary: string;
  findings: AiFinding[];
  model: string | null;
};

export type AnalysisEngine = "codex" | "gemma" | "rules";

export type ValidationIssue = {
  code: "missing_evidence" | "invented_number" | "invalid_shape";
  message: string;
};

export type AnalysisRecord = {
  id: number;
  createdAt: string;
  input: string;
  rules: RulesAnalysis | null;
  ai: AiAnalysis | null;
  mode: "hybrid" | "rules-only";
  engine: AnalysisEngine;
  validationIssues: ValidationIssue[];
};
