import type { RiskSkill } from "./riskshield.ts";

/**
 * Local tests and localhost candidate preview only.
 * It does not mutate the source objects or persist anything to D1.
 */
export function activateDraftCandidatesForTest(skills: readonly RiskSkill[]): RiskSkill[] {
  return skills.map((skill) => ({
    ...skill,
    triggerPatterns: [...skill.triggerPatterns],
    contextPatterns: [...skill.contextPatterns],
    anyOfPatterns: [...skill.anyOfPatterns],
    exclusionPatterns: [...(skill.exclusionPatterns ?? [])],
    reviewStatus: "reviewed" as const,
  }));
}
