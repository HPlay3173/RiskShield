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

export type ContextJudgmentType =
  | "direct_claim"
  | "quotation"
  | "criticism"
  | "warning"
  | "reporting"
  | "educational"
  | "conditional"
  | "unclear";

export type ContextJudgment = {
  type: ContextJudgmentType;
  explanation: string;
};

export type ReviewReport = {
  verdict: string;
  keyIssues: string[];
  potentialRisks: string[];
  recommendation: string;
  rewrite: string | null;
};

export type AiAnalysis = {
  summary: string;
  riskScore?: number;
  contextJudgment?: ContextJudgment;
  suggestedRewrite?: string | null;
  /** v0.8.0 history compatibility only. New analyses do not request this report. */
  reviewReport?: ReviewReport;
  findings: AiFinding[];
  model: string | null;
};

export type AnalysisEngine = "codex" | "gemma" | "rules";

export type AnalysisFocus = "balanced" | "claim" | "context";

export type FallbackRuleSeverity = "low" | "review" | "high";

export type FallbackRule = {
  id: string;
  expression: string;
  category: string;
  severity: FallbackRuleSeverity;
  reason: string;
  enabled: boolean;
  source: "missed" | "csv";
  createdAt: string;
  updatedAt: string;
};

export type FallbackRuleInput = Omit<FallbackRule, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

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
  focus: AnalysisFocus;
  engine: AnalysisEngine;
  validationIssues: ValidationIssue[];
};
