import {
  starterSkills,
  validateManagedSkill,
  validateSkill,
  type RiskSkill,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./riskshield.ts";

export type StoredSkillPayloadRow = {
  id: string;
  review_status: string;
  payload: string;
};

function parseReviewedSkill(row: StoredSkillPayloadRow): RiskSkill | null {
  if (row.review_status !== "reviewed") return null;
  try {
    const parsed = JSON.parse(row.payload) as RiskSkill;
    return parsed.reviewStatus === "reviewed" && validateManagedSkill(parsed).length === 0
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * D1 owns lifecycle decisions, while the built-in v4 skills remain the
 * compatibility kernel. A D1 draft or rejection suppresses the matching
 * built-in skill; a missing or malformed reviewed row falls back safely to
 * the validated kernel definition.
 */
export function resolveActiveReviewedSkills(
  rows: readonly StoredSkillPayloadRow[],
  compatibilitySkills: readonly RiskSkill[] = starterSkills,
) {
  const lifecycleById = new Map(rows.map((row) => [row.id, row.review_status]));
  const compatibilityIds = new Set(compatibilitySkills.map((skill) => skill.id));
  const active = new Map<string, RiskSkill>();

  for (const row of rows) {
    // Built-in v4 skills are the locked compatibility kernel. D1 owns their
    // lifecycle state, but an older persisted payload must not replace the
    // currently verified matcher definition.
    if (compatibilityIds.has(row.id)) continue;
    const parsed = parseReviewedSkill(row);
    if (parsed) active.set(parsed.id, parsed);
  }

  for (const skill of compatibilitySkills) {
    const lifecycle = lifecycleById.get(skill.id);
    if (lifecycle !== undefined && lifecycle !== "reviewed") continue;
    if (skill.reviewStatus !== "reviewed" || validateSkill(skill).length > 0) continue;
    active.set(skill.id, skill);
  }

  return [...active.values()];
}
