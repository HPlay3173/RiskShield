export type ObservationContextLabel =
  | "direct_attack"
  | "group_discrimination"
  | "threat"
  | "coded_reference"
  | "quotation"
  | "warning"
  | "definition"
  | "benign"
  | "uncertain";

export type QualificationDisposition = "reject" | "monitor" | "review";

export type ExpressionSemanticRole =
  | "harmful_expression"
  | "coded_expression"
  | "target_entity"
  | "proper_noun"
  | "common_word"
  | "quantity_or_date"
  | "reaction"
  | "unknown";

export type SearchVerificationDecision = "reject" | "monitor" | "send_to_review";
export type StoredVerificationDecision = SearchVerificationDecision | "error";
const DAY_MS = 24 * 60 * 60 * 1_000;

export function verificationNextCheckAt(decision: StoredVerificationDecision, errorCount: number, now: string) {
  const started = Date.parse(now);
  const delay = decision === "reject" ? 30 * DAY_MS
    : decision === "monitor" || decision === "send_to_review" ? 3 * DAY_MS
      : [60 * 60 * 1_000, 6 * 60 * 60 * 1_000, DAY_MS][Math.min(Math.max(errorCount - 1, 0), 2)];
  return new Date(started + delay).toISOString();
}

export function verificationShouldRun(previous: { decision: StoredVerificationDecision; nextCheckAt: string; verifiedObservationCount: number } | null, observationCount: number, now: string) {
  if (!previous) return true;
  if (previous.decision === "send_to_review") return false;
  if (Date.parse(previous.nextCheckAt) > Date.parse(now)) return false;
  if (previous.decision === "monitor" && observationCount < previous.verifiedObservationCount + 2) return false;
  return true;
}

export function verificationDecisionToPersist(decision: SearchVerificationDecision, passed: boolean) {
  if (decision === "reject") return "reject" as const;
  return passed ? decision : "monitor" as const;
}

export type QualificationGateInput = {
  observationCount: number;
  distinctAuthorCount: number;
  distinctSourceCount: number;
  directEvidenceCount: number;
  contextualEvidenceCount: number;
  confidence: number;
  disposition: QualificationDisposition;
};

const REACTION_ONLY = /^(?:(?:[\u110f\u1112\u116e\u1172\u314b\u314e\u315c\u3160]){2,}|(?:ha?){2,})$/iu;
const QUANTITY_OR_DATE = /^\d+(?:[.,]\d+)?(?:건|개|명|회|일|주|개월|월|년|만|천|억|원|%|퍼센트)$/u;
const COMMON_TERMS = new Set([
  "\ud544\uc694\ud558\ub2e4", "\uac8c\uc784", "\uc601\uc0c1", "\uc5c5\ub370\uc774\ud2b8", "\uc628\ub77c\uc778", "\uc0ac\ud68c", "\ucd5c\uadfc",
  "\uaddc\uc81c", "\uc5f0\uad6c", "\ubd84\uc11d", "\ud45c\ud604", "\ud610\uc624", "\ube44\ud558", "\uc740\uc5b4", "\uc0ac\uc6a9", "\uc0ac\ub78c",
  "\ub313\uae00", "\uc624\ub298", "\uc9c4\uc9dc", "\uadf8\ub0e5", "\ubb38\uc81c", "\uacf5\uac1c", "\uc815\ubcf4", "\uc11c\ube44\uc2a4",
]);

export function normalizeCollectedExpression(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

export function isHardRejectedExpression(value: string) {
  const normalized = normalizeCollectedExpression(value);
  if (!normalized || normalized.length < 2 || normalized.length > 24) return true;
  if (REACTION_ONLY.test(normalized) || COMMON_TERMS.has(normalized)) return true;
  if (/^\d+$/u.test(normalized) || QUANTITY_OR_DATE.test(normalized)) return true;
  return false;
}

export function roleCanBecomeCandidate(role: ExpressionSemanticRole) {
  return role === "harmful_expression" || role === "coded_expression";
}

export function searchVerificationGate(input: {
  decision: SearchVerificationDecision;
  role: ExpressionSemanticRole;
  confidence: number;
  directUseSupported: boolean;
  groundedSourceCount: number;
  strongLocalEvidence: boolean;
}) {
  if (input.decision !== "send_to_review" || !roleCanBecomeCandidate(input.role) || input.confidence < 0.8) return false;
  return (input.directUseSupported && input.groundedSourceCount >= 1) || input.strongLocalEvidence;
}

export function qualificationGate(input: QualificationGateInput) {
  const totalLabeled = input.directEvidenceCount + input.contextualEvidenceCount;
  const contextualRatio = totalLabeled ? input.contextualEvidenceCount / totalLabeled : 1;
  const crossSourceSupport = input.distinctSourceCount >= 2 && input.observationCount >= 2;
  const enoughObservations = input.observationCount >= 3 || crossSourceSupport;
  return input.disposition === "review"
    && enoughObservations
    && input.distinctAuthorCount >= 2
    && input.directEvidenceCount >= 2
    && contextualRatio <= 0.4
    && input.confidence >= 0.78;
}

export function newestNumericId(values: string[], fallback: string | null) {
  const numeric = values.filter((value) => /^\d+$/u.test(value));
  if (!numeric.length) return fallback;
  return numeric.reduce((latest, current) => BigInt(current) > BigInt(latest) ? current : latest);
}

export function buildXRecentQuery(query: string) {
  const trimmed = query.trim();
  const language = /(?:^|\s)lang:/iu.test(trimmed) ? "" : " lang:ko";
  const retweets = /(?:^|\s)-?is:retweet/iu.test(trimmed) ? "" : " -is:retweet";
  return `(${trimmed})${language}${retweets}`.trim();
}

export function parseApprovedFeedEntries(body: string) {
  const blocks = [...body.matchAll(/<(item|article)\b[^>]*>([\s\S]*?)<\/\1>/giu)].map((match) => match[2]);
  return blocks.map((block) => {
    const strip = (value: string) => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
    const title = strip(block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? "");
    const description = strip(block.match(/<(?:description|content)\b[^>]*>([\s\S]*?)<\/(?:description|content)>/iu)?.[1] ?? "");
    const link = strip(block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/iu)?.[1] ?? "");
    return { text: [title, description].filter(Boolean).join(" / "), link: link || null };
  }).filter((entry) => entry.text);
}
