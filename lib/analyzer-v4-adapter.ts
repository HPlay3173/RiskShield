import {
  analyzeText,
  parseBundleFiles,
  type AnalysisResult,
  type BundleFiles,
  type RiskSkill,
  type SeverityRules,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "./riskshield.ts";

export interface AnalyzerV4Adapter {
  readonly reviewedSkillCount: number;
  readonly severityRules: SeverityRules;
  analyze(text: string): AnalysisResult;
}

export function loadAnalyzerV4Adapter(
  files: Partial<BundleFiles>,
): AnalyzerV4Adapter {
  const parsed = parseBundleFiles(files);
  if (parsed.issues.length > 0) {
    throw new Error(`Analyzer v4 bundle import failed: ${parsed.issues.join(" ")}`);
  }

  const reviewedSkills: RiskSkill[] = parsed.skills.filter(
    (skill) => skill.reviewStatus === "reviewed",
  );
  if (reviewedSkills.length === 0) {
    throw new Error(
      "Analyzer v4 bundle import failed: at least one valid reviewed skill is required.",
    );
  }

  const severityRules = parsed.severityRules;
  return {
    reviewedSkillCount: reviewedSkills.length,
    severityRules,
    analyze(text: string) {
      return analyzeText(text, reviewedSkills, { severityRules });
    },
  };
}
