import { ReviewInbox, type ReviewCandidate } from "../../../components/admin/ReviewInbox";
import { AdminShell } from "../../../components/shell/AreaShells";
import { StatePanel } from "../../../components/states/StatePanel";
import { protectedProductPage } from "../../../lib/product-page";
import type { CandidateRecord } from "../../../lib/repositories/contracts";

function candidateView(record: CandidateRecord): ReviewCandidate {
  const sources = (record.sources ?? []).map((source, index) => ({
    id: `${record.id}-source-${index + 1}`,
    title: source.title,
    sourceType: "provided",
    url: source.url,
    publishedAt: source.date,
    excerpt: null,
  }));
  return {
    id: record.id,
    representativeExpression: record.expression,
    candidateType: record.origin?.type === "collector" || record.reportType === "collector_discovery" ? "자동 수집 후보" : "표현군 후보",
    reviewReason: record.autoInclusionBlockedReason ?? "자동 편입이 차단되어 사람 검토가 필요합니다.",
    riskDomain: record.riskDomain,
    noveltyPercent: record.noveltyScore === null ? null : Math.round(record.noveltyScore * 100),
    confidencePercent: record.qualification ? Math.round(record.qualification.confidence * 100) : record.confidence === null ? null : Math.round(record.confidence * 100),
    searchConfidencePercent: record.searchVerification ? Math.round(record.searchVerification.confidence * 100) : null,
    sourceCount: record.sourceCount,
    createdAt: record.createdAt,
    status: record.status,
    expressionGroup: [...(record.expressionGroup ?? [record.expression])],
    meaningSummary: record.searchVerification?.meaning ?? record.contextSummary ?? "의미 요약이 아직 제공되지 않았습니다.",
    contextSummary: record.contextSummary ?? "문맥 분석 backend가 아직 제공되지 않았습니다.",
    usageDistribution: {
      unit: "count",
      directUse: record.qualification?.directUseCount ?? record.usageDistribution?.direct ?? null,
      quotation: record.usageDistribution?.quoted ?? null,
      criticism: record.usageDistribution?.critical ?? null,
      satire: record.usageDistribution?.satire ?? null,
      selfDirected: record.usageDistribution?.selfDirected ?? null,
      sampleSize: record.qualification?.observationCount ?? null,
    },
    estimatedTarget: record.target ?? null,
    similarSkill: null,
    skillDiff: record.skillDiff ? [record.skillDiff] : [],
    sources,
    evidence: (record.evidence ?? []).map((text, index) => ({ id: `${record.id}-evidence-${index + 1}`, text, context: null, sourceId: null })),
    positiveTests: (record.positiveTests ?? []).map((input, index) => ({ id: `${record.id}-positive-${index + 1}`, input, expected: "match", actual: null, passed: null })),
    negativeTests: (record.negativeTests ?? []).map((input, index) => ({ id: `${record.id}-negative-${index + 1}`, input, expected: "not_high", actual: null, passed: null })),
    redTeam: record.redTeam ? [{ id: `${record.id}-red-team`, scenario: record.redTeam, outcome: "not_run", note: "실행 결과 없음" }] : [],
    modelConflicts: record.modelConflict === true ? ["모델 충돌이 보고되었습니다."] : [],
    policyChange: {
      required: record.policyChange ?? null,
      summary: record.policyChange === null || record.policyChange === undefined ? "정책 변경 여부가 평가되지 않았습니다." : record.policyChange ? "정책 변경 검토가 필요합니다." : "정책 변경이 필요하지 않은 것으로 표시되었습니다.",
    },
    autoInclusionBlockedReason: record.autoInclusionBlockedReason ?? "사람의 명시적 결정 전에는 active skill로 편입하지 않습니다.",
    qualification: record.qualification ? {
      disposition: record.qualification.disposition,
      role: record.qualification.role,
      reason: record.qualification.reason,
      confidencePercent: Math.round(record.qualification.confidence * 100),
      directUseCount: record.qualification.directUseCount ?? null,
      distinctAuthorCount: record.qualification.distinctAuthorCount,
      distinctPlatformCount: record.qualification.distinctPlatformCount ?? null,
      observationCount: record.qualification.observationCount,
    } : null,
    searchVerification: record.searchVerification ? {
      decision: record.searchVerification.decision,
      role: record.searchVerification.role,
      meaning: record.searchVerification.meaning,
      reason: record.searchVerification.reason,
      confidencePercent: Math.round(record.searchVerification.confidence * 100),
      directUseSupported: record.searchVerification.directUseSupported,
      queries: [...record.searchVerification.queries],
      sources: record.searchVerification.sources.map((source) => ({ ...source })),
      verifiedAt: record.searchVerification.verifiedAt ?? null,
      qualityGateVersion: record.origin?.type === "collector" ? record.origin.qualityGateVersion : record.qualityGateVersion ?? null,
    } : null,
    draft: record.draft ? {
      title: record.draft.title,
      riskSummary: record.draft.riskSummary,
      riskFamily: record.draft.riskFamily ?? record.riskFamily ?? "general_substantiation",
      riskDomain: record.draft.riskDomain ?? record.riskDomain,
      matchMode: record.draft.matchMode ?? (record.draft.contextPatterns.length ? "trigger_and_context" : "atomic_lexeme"),
      triggerPatterns: [...record.draft.triggerPatterns],
      contextPatterns: [...record.draft.contextPatterns],
      exclusionPatterns: [...(record.draft.exclusionPatterns ?? [])],
      severityFloor: record.draft.severityFloor ?? 60,
      safeRewrite: [...record.draft.safeRewrite],
    } : null,
  };
}

export async function renderAdminReviewPage(returnTo = "/admin/review") {
  const { principal, presentation, repositories } = await protectedProductPage(returnTo, "candidate:read");
  const result = await repositories.candidates.list();
  if (result.status !== "ready") {
    return (
      <AdminShell currentHref="/admin/review" principal={presentation} title="후보 검토" description="자동 수집과 사용자 제보로 발견한 표현을 사람이 확인합니다.">
        <StatePanel state={result.status === "configuration_required" ? "configuration-required" : "unavailable"} title="후보 backend가 준비되지 않았습니다." description={result.message}>
          <p>제품 UI와 CandidateRepository 경계는 준비되어 있으며 production schema와 pipeline 저장 단계가 연결되면 실제 후보가 나타납니다.</p>
        </StatePanel>
      </AdminShell>
    );
  }
  const candidates = result.data.items.map(candidateView);
  const scoredNovelty = candidates.filter((candidate) => candidate.noveltyPercent !== null);
  const knownConflict = result.data.items.filter((candidate) => candidate.modelConflict !== null && candidate.modelConflict !== undefined);
  return (
    <AdminShell currentHref="/admin/review" principal={presentation} title="후보 검토" description="대표 표현과 사용 문맥을 먼저 보고, 필요한 경우 근거와 테스트를 펼쳐 승인·보류·반려합니다.">
      <ReviewInbox
        summary={{
          total: candidates.length,
          pending: candidates.filter((candidate) => candidate.status === "pending").length,
          highNovelty: scoredNovelty.length ? scoredNovelty.filter((candidate) => (candidate.noveltyPercent ?? 0) >= 80).length : null,
          modelConflicts: knownConflict.length ? knownConflict.filter((candidate) => candidate.modelConflict).length : null,
        }}
        candidates={candidates}
        decisionEndpoint="/api/manage/candidates/decision"
        csrfToken={principal.csrfToken}
        developmentFixture={result.fixture}
        degradedMessage={result.fixture ? "개발 데이터의 결정은 메모리 저장소에만 기록되며 production 스킬을 변경하지 않습니다." : null}
      />
    </AdminShell>
  );
}

export default function AdminReviewPage() {
  return renderAdminReviewPage();
}
