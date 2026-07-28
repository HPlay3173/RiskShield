import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AccountInfo,
  AiAnalysis,
  AnalysisRecord,
  LoginChallenge,
  RateLimits,
  RulesAnalysis,
  ValidationIssue,
} from "./types";

export function accountRead(): Promise<AccountInfo> {
  return invoke("account_read");
}

export function loginStart(): Promise<LoginChallenge> {
  return invoke("login_start");
}

export function logout(): Promise<void> {
  return invoke("logout");
}

export function rateLimitsRead(): Promise<RateLimits> {
  return invoke("rate_limits_read");
}

export function codexAnalyze(input: string, rules: RulesAnalysis): Promise<AiAnalysis> {
  return invoke("codex_analyze", { input, rules });
}

export function saveAnalysis(payload: {
  input: string;
  rules: RulesAnalysis;
  ai: AiAnalysis | null;
  mode: "hybrid" | "rules-only";
  validationIssues: ValidationIssue[];
}): Promise<number> {
  return invoke("save_analysis", { payload });
}

export function listHistory(): Promise<AnalysisRecord[]> {
  return invoke("list_history");
}

export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}
