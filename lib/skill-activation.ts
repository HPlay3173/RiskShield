import {
  analyzeText,
  type RiskSkill,
  type RiskSkillRegressionCase,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./riskshield.ts";

export type SkillActivationCheck = RiskSkillRegressionCase & {
  actual: "match" | "no_match";
  passed: boolean;
};

export type SkillActivationResult = {
  passed: boolean;
  checks: SkillActivationCheck[];
  passedCount: number;
  totalCount: number;
};

function baselineCases(skill: RiskSkill): RiskSkillRegressionCase[] {
  const positiveInput = skill.matchMode === "atomic_lexeme"
    ? skill.triggerPatterns[0]
    : `${skill.triggerPatterns[0]} ${skill.contextPatterns[0]}`;
  return [
    {
      id: "activation:baseline-positive",
      input: positiveInput,
      expected: "match",
      contextSlice: "활성화 전 기본 양성 검사",
    },
    {
      id: "activation:baseline-warning",
      input: `“${positiveInput}”라는 표현은 사용하지 마세요.`,
      expected: "no_match",
      contextSlice: "활성화 전 기본 경고 문맥 검사",
    },
  ];
}

export function activationCases(skill: RiskSkill): RiskSkillRegressionCase[] {
  const unique = new Map<string, RiskSkillRegressionCase>();
  for (const regressionCase of [...baselineCases(skill), ...(skill.regressionTests ?? [])]) {
    const input = regressionCase.input.trim();
    if (!input) continue;
    const key = `${regressionCase.expected}\u0000${input}`;
    if (!unique.has(key)) unique.set(key, { ...regressionCase, input });
  }
  return [...unique.values()];
}

export function runSkillActivationRegression(skill: RiskSkill): SkillActivationResult {
  const checks = activationCases(skill).map((regressionCase): SkillActivationCheck => {
    const actual = analyzeText(regressionCase.input, [skill]).matches.length > 0
      ? "match"
      : "no_match";
    return { ...regressionCase, actual, passed: actual === regressionCase.expected };
  });
  const passedCount = checks.filter((check) => check.passed).length;
  return {
    passed: passedCount === checks.length,
    checks,
    passedCount,
    totalCount: checks.length,
  };
}
