import {
  DEFAULT_SEVERITY_RULES,
  analyzeText,
  starterSkills,
} from "../../lib/riskshield";
import type { RulesAnalysis } from "./types";

export function analyzeWithReviewedRules(input: string): RulesAnalysis {
  const reviewed = starterSkills.filter((skill) => skill.reviewStatus === "reviewed");
  return analyzeText(input, reviewed, { severityRules: DEFAULT_SEVERITY_RULES });
}
