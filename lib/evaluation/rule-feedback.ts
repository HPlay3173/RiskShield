export function evaluationEnabledForRuleFeedback(decision: "approve" | "reject") {
  return decision === "approve" ? 1 : 0;
}
