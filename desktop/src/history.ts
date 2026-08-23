import type { AnalysisEngine, AnalysisRecord } from "./types";

export function effectiveHistoryEngine(record: AnalysisRecord): AnalysisEngine {
  if (record.engine === "rules" && record.mode === "hybrid" && record.ai) {
    return record.ai.model?.toLocaleLowerCase().includes("gemma") ? "gemma" : "codex";
  }
  return record.engine;
}
