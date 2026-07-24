export const RISK_FAMILIES = [
  "health_claim",
  "financial_guarantee",
  "income_claim",
  "education_outcome",
  "legal_outcome",
  "privacy_intrusion",
  "hate_discrimination",
  "abusive_language",
  "coded_expression",
  "violent_threat",
  "urgency",
  "general_substantiation",
  "none",
] as const;

export type RiskFamily = typeof RISK_FAMILIES[number];
export type ScorableRiskFamily = Exclude<RiskFamily, "none">;

/**
 * Stable compatibility mapping for legacy matcher pattern types.
 * New managed skills persist riskFamily directly; category labels are never
 * used as scoring identifiers.
 */
export function riskFamilyForPatternType(patternType: string): ScorableRiskFamily {
  const value = patternType.toLowerCase();
  if (/(health|medical|disease|symptom|body|weight)/u.test(value)) return "health_claim";
  if (/(income|side_job|earnings|salary)/u.test(value)) return "income_claim";
  if (/(financial|investment|return_or_loss)/u.test(value)) return "financial_guarantee";
  if (/(education|admission|exam)/u.test(value)) return "education_outcome";
  if (/(legal|lawsuit|sentence)/u.test(value)) return "legal_outcome";
  if (/(privacy|personal_data|surveillance|tracking|concealment|access_or_export)/u.test(value)) {
    return "privacy_intrusion";
  }
  if (/(hate|discrimination|protected_group|degrading_generalization|regional_slur)/u.test(value)) return "hate_discrimination";
  if (/(abuse|profanity|personal_attack|sexual_degradation|harassment)/u.test(value)) return "abusive_language";
  if (/(coded|dog_whistle|ilbe|community_slang|altered_spelling)/u.test(value)) return "coded_expression";
  if (/(violent|threat|death_threat|physical_harm)/u.test(value)) return "violent_threat";
  if (/(urgency|deadline|purchase_or_application)/u.test(value)) return "urgency";
  return "general_substantiation";
}
