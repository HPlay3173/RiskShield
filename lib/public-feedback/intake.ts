import type { QualificationAssessment, QualificationGroup } from "../collectors/google-qualification-provider";
import type { SearchVerification } from "../collectors/google-search-verification-provider";
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
import { isHardRejectedExpression, roleCanBecomeCandidate, searchVerificationGate } from "../collectors/quality.ts";

export const PUBLIC_FEEDBACK_GATE_VERSION = "public-feedback-semantic-search-v1";

export type PublicFeedbackVerification =
  | { status: "rejected"; qualification: QualificationAssessment | null; searchVerification: SearchVerification | null; reason: string }
  | { status: "monitor"; qualification: QualificationAssessment; searchVerification: SearchVerification | null; reason: string }
  | { status: "promoted"; qualification: QualificationAssessment; searchVerification: SearchVerification; reason: string };

export type PublicFeedbackVerificationProviders = {
  qualify(groups: QualificationGroup[], signal: AbortSignal): Promise<QualificationAssessment[]>;
  verify(input: { expression: string; normalized: string; evidence: Array<{ id: string; excerpt: string }> }, signal: AbortSignal): Promise<SearchVerification>;
};

export function normalizePublicFeedbackExpression(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

export function compactPublicFeedbackText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function expressionAppearsInContext(expression: string, context: string) {
  const needle = compactPublicFeedbackText(expression);
  return Boolean(needle) && compactPublicFeedbackText(context).includes(needle);
}

const POSITIVE_LABELS = new Set(["direct_attack", "group_discrimination", "threat", "coded_reference", "deceptive_claim"]);
const NEGATIVE_LABELS = new Set(["quotation", "warning", "definition", "benign"]);

export function verifiedContextTests(contexts: readonly string[], qualification: QualificationAssessment) {
  const labels = new Map(qualification.evidenceLabels.map((item) => [item.id, item.label]));
  const positiveTests: string[] = [];
  const negativeTests: string[] = [];
  contexts.forEach((context, index) => {
    const label = labels.get(`public-feedback-context-${index + 1}`);
    if (label && POSITIVE_LABELS.has(label)) positiveTests.push(context);
    else if (label && NEGATIVE_LABELS.has(label)) negativeTests.push(context);
  });
  return { positiveTests, negativeTests };
}

export function publicFeedbackSearchPassed(verification: SearchVerification) {
  return searchVerificationGate({
    decision: verification.decision,
    role: verification.role,
    confidence: verification.confidence,
    directUseSupported: verification.directUseSupported,
    groundedSourceCount: verification.sources.length,
    strongLocalEvidence: false,
  });
}

export async function verifyPublicFeedbackExpression(
  input: { expression: string; contexts: string[] },
  providers: PublicFeedbackVerificationProviders,
  signal: AbortSignal,
): Promise<PublicFeedbackVerification> {
  const normalized = normalizePublicFeedbackExpression(input.expression);
  if (isHardRejectedExpression(normalized)) {
    return { status: "rejected", qualification: null, searchVerification: null, reason: "명백한 일반어·수량·날짜·반응 표현은 후보로 만들지 않습니다." };
  }

  const evidence = input.contexts.slice(0, 5).map((excerpt, index) => ({ id: `public-feedback-context-${index + 1}`, excerpt }));
  const assessments = await providers.qualify([{ expression: input.expression, normalized, evidence }], signal);
  const qualification = assessments.find((item) => item.normalized === normalized);
  if (!qualification) throw Object.assign(new Error("public_feedback_qualification_contract_failed"), { code: "qualification_contract_failed" });

  if (qualification.disposition === "reject" || (!roleCanBecomeCandidate(qualification.role) && qualification.role !== "unknown")) {
    return { status: "rejected", qualification, searchVerification: null, reason: qualification.reason };
  }
  if (qualification.disposition !== "review" && qualification.role !== "unknown") {
    return { status: "monitor", qualification, searchVerification: null, reason: qualification.reason };
  }

  const searchVerification = await providers.verify({ expression: input.expression, normalized, evidence }, signal);
  if (searchVerification.decision === "reject") {
    return { status: "rejected", qualification, searchVerification, reason: searchVerification.reason };
  }
  if (!publicFeedbackSearchPassed(searchVerification)) {
    return { status: "monitor", qualification, searchVerification, reason: searchVerification.reason };
  }
  return { status: "promoted", qualification, searchVerification, reason: searchVerification.reason };
}
