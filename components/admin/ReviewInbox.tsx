"use client";

import { useEffect, useMemo, useState } from "react";
import { ProductDataTable, ProductDefinitionList, ProductMetricGrid } from "../data-display/ProductData";
import { Pressable } from "../interaction/Pressable";
import { ModalSheet } from "../interaction/ModalSheet";
import { SplitPane } from "../interaction/SplitPane";
import { StatePanel } from "../states/StatePanel";

export type ReviewCandidateStatus = "pending" | "held" | "approved" | "merged" | "rejected";
export type ReviewDecision = "approve" | "approve_with_edits" | "merge" | "hold" | "reject";

export type ReviewInboxSummary = {
  total: number | null;
  pending: number | null;
  highNovelty: number | null;
  modelConflicts: number | null;
};

export type ReviewUsageDistribution = {
  unit: "count" | "percent";
  directUse: number | null;
  quotation: number | null;
  criticism: number | null;
  satire: number | null;
  selfDirected: number | null;
  sampleSize: number | null;
};

export type ReviewSource = {
  id: string;
  title: string;
  sourceType: string;
  url: string | null;
  publishedAt: string | null;
  excerpt: string | null;
};

export type ReviewEvidence = {
  id: string;
  text: string;
  context: string | null;
  sourceId: string | null;
};

export type ReviewRegressionCase = {
  id: string;
  input: string;
  expected: string;
  actual: string | null;
  passed: boolean | null;
};

export type ReviewRedTeamCase = {
  id: string;
  scenario: string;
  outcome: "pass" | "fail" | "review" | "not_run";
  note: string | null;
};

export type ReviewCandidate = {
  id: string;
  representativeExpression: string;
  candidateType: string;
  reviewReason: string;
  riskDomain: string;
  noveltyPercent: number | null;
  confidencePercent: number | null;
  sourceCount: number | null;
  createdAt: string;
  status: ReviewCandidateStatus;
  expressionGroup: string[];
  meaningSummary: string;
  contextSummary: string;
  usageDistribution: ReviewUsageDistribution;
  estimatedTarget: string | null;
  similarSkill: {
    id: string;
    name: string;
    similarityPercent: number | null;
  } | null;
  skillDiff: string[];
  sources: ReviewSource[];
  evidence: ReviewEvidence[];
  positiveTests: ReviewRegressionCase[];
  negativeTests: ReviewRegressionCase[];
  redTeam: ReviewRedTeamCase[];
  modelConflicts: string[];
  policyChange: {
    required: boolean | null;
    summary: string;
  };
  autoInclusionBlockedReason: string;
  draft: {
    title: string;
    riskSummary: string;
    riskFamily: string;
    riskDomain: string;
    matchMode: "atomic_lexeme" | "trigger_and_context";
    triggerPatterns: string[];
    contextPatterns: string[];
    exclusionPatterns: string[];
    severityFloor: number;
    safeRewrite: string[];
  } | null;
};

export type ReviewInboxProps = {
  summary: ReviewInboxSummary;
  candidates: ReviewCandidate[];
  decisionEndpoint: string;
  csrfToken: string;
  initialCandidateId?: string;
  developmentFixture?: boolean;
  degradedMessage?: string | null;
};

type DecisionAcknowledgement = {
  acknowledged: true;
  decisionId: string | null;
  candidateStatus: ReviewCandidateStatus | null;
  message: string;
};

type DecisionState =
  | { state: "idle" }
  | { state: "submitting"; candidateId: string; decision: ReviewDecision }
  | { state: "success"; candidateId: string; acknowledgement: DecisionAcknowledgement }
  | { state: "error"; candidateId: string; message: string };

const statusLabels: Record<ReviewCandidateStatus, string> = {
  pending: "검토 대기",
  held: "보류",
  approved: "승인",
  merged: "병합",
  rejected: "반려",
};

const decisionLabels: Record<ReviewDecision, string> = {
  approve: "승인",
  approve_with_edits: "수정 후 승인",
  merge: "기존 스킬에 병합",
  hold: "보류",
  reject: "반려",
};

const supportedDecisions: ReviewDecision[] = ["approve", "approve_with_edits", "merge", "hold", "reject"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayNumber(value: number | null, suffix = "") {
  return value === null ? "자료 없음" : `${value.toLocaleString("ko-KR")}${suffix}`;
}

function displayDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(parsed);
}

function sameOriginEndpoint(endpoint: string) {
  const resolved = new URL(endpoint, window.location.href);
  if (resolved.origin !== window.location.origin) throw new Error("허용되지 않은 결정 endpoint입니다.");
  return `${resolved.pathname}${resolved.search}`;
}

function testColumns() {
  return [
    { key: "input", header: "입력", rowHeader: true, render: (item: ReviewRegressionCase) => item.input },
    { key: "expected", header: "기대", render: (item: ReviewRegressionCase) => item.expected },
    { key: "actual", header: "실제", render: (item: ReviewRegressionCase) => item.actual ?? "미실행" },
    {
      key: "result",
      header: "결과",
      render: (item: ReviewRegressionCase) =>
        item.passed === null ? "미실행" : item.passed ? "통과" : "실패",
    },
  ] as const;
}

function CandidateDetail({ candidate, instance = "desktop" }: { candidate: ReviewCandidate; instance?: "desktop" | "sheet" }) {
  const usageSuffix = candidate.usageDistribution.unit === "percent" ? "%" : "건";
  const positiveColumns = testColumns();
  const negativeColumns = testColumns();
  const domId = `candidate-${instance}-${candidate.id}`;

  return (
    <article className="reviewCandidateDetail" aria-labelledby={`${domId}-title`}>
      <header className="reviewCandidateDetailHeader">
        <div>
          <p>{candidate.candidateType}</p>
          <h2 id={`${domId}-title`}>{candidate.representativeExpression}</h2>
        </div>
        <span className={`candidateStatus candidateStatus-${candidate.status}`}>
          {statusLabels[candidate.status]}
        </span>
      </header>

      <ProductDefinitionList
        label="후보 기본 정보"
        items={[
          { key: "reason", term: "검토 필요 이유", description: candidate.reviewReason },
          { key: "domain", term: "위험 분야", description: candidate.riskDomain },
          { key: "meaning", term: "의미 요약", description: candidate.meaningSummary },
          { key: "context", term: "문맥 요약", description: candidate.contextSummary },
          { key: "target", term: "추정 대상", description: candidate.estimatedTarget ?? "판단 근거 부족" },
          { key: "created", term: "생성 시각", description: displayDate(candidate.createdAt) },
        ]}
      />

      <details className="reviewEvidenceDetails">
        <summary><span><strong>근거·문맥·회귀 테스트</strong><small>결정 전에 필요한 상세 자료를 펼쳐 봅니다.</small></span><b>열기</b></summary>
      <section className="reviewDetailSection" aria-labelledby={`${domId}-group`}>
        <h3 id={`${domId}-group`}>표현군</h3>
        {candidate.expressionGroup.length ? (
          <ul className="expressionGroupList">
            {candidate.expressionGroup.map((expression) => <li key={expression}>{expression}</li>)}
          </ul>
        ) : (
          <p>확인된 표현군이 없습니다.</p>
        )}
      </section>

      <section className="reviewDetailSection" aria-labelledby={`${domId}-usage`}>
        <h3 id={`${domId}-usage`}>사용 문맥 분포</h3>
        <ProductMetricGrid
          label="사용 문맥 분포"
          metrics={[
            { key: "direct", label: "직접 사용", value: displayNumber(candidate.usageDistribution.directUse, usageSuffix), numeric: true },
            { key: "quotation", label: "인용", value: displayNumber(candidate.usageDistribution.quotation, usageSuffix), numeric: true },
            { key: "criticism", label: "비판", value: displayNumber(candidate.usageDistribution.criticism, usageSuffix), numeric: true },
            { key: "satire", label: "풍자", value: displayNumber(candidate.usageDistribution.satire, usageSuffix), numeric: true },
            { key: "self", label: "자조", value: displayNumber(candidate.usageDistribution.selfDirected, usageSuffix), numeric: true },
            { key: "sample", label: "표본 수", value: displayNumber(candidate.usageDistribution.sampleSize, "건"), numeric: true },
          ]}
        />
      </section>

      <section className="reviewDetailSection" aria-labelledby={`${domId}-similarity`}>
        <h3 id={`${domId}-similarity`}>기존 스킬 비교</h3>
        {candidate.similarSkill ? (
          <p>
            <strong>{candidate.similarSkill.name}</strong> ({candidate.similarSkill.id}) · 유사도{" "}
            {displayNumber(candidate.similarSkill.similarityPercent, "%")}
          </p>
        ) : (
          <p>비교 가능한 기존 스킬이 없습니다.</p>
        )}
        {candidate.skillDiff.length ? (
          <ul>{candidate.skillDiff.map((difference) => <li key={difference}>{difference}</li>)}</ul>
        ) : (
          <p>기록된 diff가 없습니다.</p>
        )}
      </section>

      <section className="reviewDetailSection" aria-labelledby={`${domId}-sources`}>
        <h3 id={`${domId}-sources`}>출처와 판단 근거</h3>
        {candidate.sources.length ? (
          <ul className="candidateSourceList">
            {candidate.sources.map((source) => (
              <li key={source.id}>
                <strong>{source.title}</strong>
                <span>{source.sourceType}{source.publishedAt ? ` · ${displayDate(source.publishedAt)}` : ""}</span>
                {source.excerpt ? <p>{source.excerpt}</p> : null}
                {source.url ? <a href={source.url} target="_blank" rel="noreferrer">출처 열기</a> : null}
              </li>
            ))}
          </ul>
        ) : <p>등록된 출처가 없습니다.</p>}
        {candidate.evidence.length ? (
          <ol className="candidateEvidenceList">
            {candidate.evidence.map((evidence) => (
              <li key={evidence.id}>
                <q>{evidence.text}</q>
                {evidence.context ? <p>{evidence.context}</p> : null}
              </li>
            ))}
          </ol>
        ) : <p>등록된 판단 근거가 없습니다.</p>}
      </section>

      <section className="reviewDetailSection" aria-labelledby={`${domId}-positive`}>
        <h3 id={`${domId}-positive`}>양성 테스트</h3>
        <ProductDataTable
          caption="후보 양성 테스트"
          columns={positiveColumns}
          rows={candidate.positiveTests}
          getRowKey={(item) => item.id}
          emptyContent="생성된 양성 테스트가 없습니다."
        />
      </section>

      <section className="reviewDetailSection" aria-labelledby={`${domId}-negative`}>
        <h3 id={`${domId}-negative`}>음성 테스트</h3>
        <ProductDataTable
          caption="후보 음성 테스트"
          columns={negativeColumns}
          rows={candidate.negativeTests}
          getRowKey={(item) => item.id}
          emptyContent="생성된 음성 테스트가 없습니다."
        />
      </section>

      <section className="reviewDetailSection" aria-labelledby={`${domId}-redteam`}>
        <h3 id={`${domId}-redteam`}>Red-Team 결과</h3>
        {candidate.redTeam.length ? (
          <ul className="redTeamList">
            {candidate.redTeam.map((item) => (
              <li key={item.id} data-outcome={item.outcome}>
                <strong>{item.scenario}</strong><span>{item.outcome}</span>
                {item.note ? <p>{item.note}</p> : null}
              </li>
            ))}
          </ul>
        ) : <p>실행된 Red-Team 결과가 없습니다.</p>}
      </section>

      <section className="reviewDetailSection reviewDecisionContext" aria-labelledby={`${domId}-governance`}>
        <h3 id={`${domId}-governance`}>충돌과 정책 영향</h3>
        <ProductDefinitionList
          items={[
            {
              key: "conflict",
              term: "모델 충돌",
              description: candidate.modelConflicts.length ? candidate.modelConflicts.join(" · ") : "확인된 충돌 없음",
            },
            {
              key: "policy",
              term: "정책 변경",
              description: `${candidate.policyChange.required === null ? "판단 대기" : candidate.policyChange.required ? "필요" : "불필요"} · ${candidate.policyChange.summary}`,
            },
            {
              key: "blocked",
              term: "자동 편입 차단 이유",
              description: candidate.autoInclusionBlockedReason,
            },
          ]}
        />
      </section>
      </details>
    </article>
  );
}

export function ReviewInbox({
  summary,
  candidates,
  decisionEndpoint,
  csrfToken,
  initialCandidateId,
  developmentFixture = false,
  degradedMessage,
}: ReviewInboxProps) {
  const [query, setQuery] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [mobileView, setMobileView] = useState(false);
  const [status, setStatus] = useState<"all" | ReviewCandidateStatus>("pending");
  const [riskDomain, setRiskDomain] = useState("all");
  const [candidateType, setCandidateType] = useState("all");
  const initialCandidate = candidates.find((candidate) => candidate.id === initialCandidateId) ?? candidates[0] ?? null;
  const [selectedId, setSelectedId] = useState(initialCandidate?.id ?? "");
  const [decisionNote, setDecisionNote] = useState("");
  const [mergeSkillId, setMergeSkillId] = useState("");
  const [draftTitle, setDraftTitle] = useState(initialCandidate?.draft?.title ?? "");
  const [draftSummary, setDraftSummary] = useState(initialCandidate?.draft?.riskSummary ?? "");
  const [draftRiskFamily, setDraftRiskFamily] = useState(initialCandidate?.draft?.riskFamily ?? "general_substantiation");
  const [draftRiskDomain, setDraftRiskDomain] = useState(initialCandidate?.draft?.riskDomain ?? initialCandidate?.riskDomain ?? "미분류 텍스트 위험");
  const [draftMatchMode, setDraftMatchMode] = useState<"atomic_lexeme" | "trigger_and_context">(initialCandidate?.draft?.matchMode ?? "trigger_and_context");
  const [draftTriggers, setDraftTriggers] = useState(initialCandidate?.draft?.triggerPatterns.join("\n") ?? "");
  const [draftContexts, setDraftContexts] = useState(initialCandidate?.draft?.contextPatterns.join("\n") ?? "");
  const [draftExclusions, setDraftExclusions] = useState(initialCandidate?.draft?.exclusionPatterns.join("\n") ?? "");
  const [draftSeverity, setDraftSeverity] = useState(initialCandidate?.draft?.severityFloor ?? 60);
  const [draftRewrites, setDraftRewrites] = useState(initialCandidate?.draft?.safeRewrite.join("\n") ?? "");
  const [decisionState, setDecisionState] = useState<DecisionState>({ state: "idle" });

  const domains = useMemo(
    () => [...new Set(candidates.map((candidate) => candidate.riskDomain))].sort(),
    [candidates],
  );
  const types = useMemo(
    () => [...new Set(candidates.map((candidate) => candidate.candidateType))].sort(),
    [candidates],
  );
  const filteredCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return candidates.filter((candidate) => {
      const haystack = [
        candidate.representativeExpression,
        candidate.candidateType,
        candidate.reviewReason,
        candidate.riskDomain,
        candidate.meaningSummary,
        ...candidate.expressionGroup,
      ].join(" ").toLocaleLowerCase("ko-KR");
      return (status === "all" || candidate.status === status)
        && (riskDomain === "all" || candidate.riskDomain === riskDomain)
        && (candidateType === "all" || candidate.candidateType === candidateType)
        && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [candidateType, candidates, query, riskDomain, status]);
  const selectedCandidate = filteredCandidates.find((candidate) => candidate.id === selectedId)
    ?? filteredCandidates[0]
    ?? null;
  const submitting = decisionState.state === "submitting";

  function loadDraft(candidate: ReviewCandidate) {
    setDraftTitle(candidate.draft?.title ?? "");
    setDraftSummary(candidate.draft?.riskSummary ?? "");
    setDraftRiskFamily(candidate.draft?.riskFamily ?? "general_substantiation");
    setDraftRiskDomain(candidate.draft?.riskDomain ?? candidate.riskDomain);
    setDraftMatchMode(candidate.draft?.matchMode ?? "trigger_and_context");
    setDraftTriggers(candidate.draft?.triggerPatterns.join("\n") ?? "");
    setDraftContexts(candidate.draft?.contextPatterns.join("\n") ?? "");
    setDraftExclusions(candidate.draft?.exclusionPatterns.join("\n") ?? "");
    setDraftSeverity(candidate.draft?.severityFloor ?? 60);
    setDraftRewrites(candidate.draft?.safeRewrite.join("\n") ?? "");
  }

  useEffect(() => {
    const media = window.matchMedia("(max-width: 48rem)");
    const update = () => setMobileView(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  async function submitDecision(decision: ReviewDecision) {
    if (!selectedCandidate || submitting) return;
    const note = decisionNote.trim();
    if (decision !== "approve" && !note) {
      setDecisionState({ state: "error", candidateId: selectedCandidate.id, message: "결정 근거를 입력해 주세요." });
      return;
    }
    if (decision === "merge" && !mergeSkillId.trim()) {
      setDecisionState({ state: "error", candidateId: selectedCandidate.id, message: "병합할 기존 스킬 ID를 입력해 주세요." });
      return;
    }
    const editedDraft = {
      title: draftTitle.trim(),
      riskSummary: draftSummary.trim(),
      riskFamily: draftRiskFamily,
      riskDomain: draftRiskDomain.trim(),
      matchMode: draftMatchMode,
      triggerPatterns: draftTriggers.split("\n").map((value) => value.trim()).filter(Boolean),
      contextPatterns: draftContexts.split("\n").map((value) => value.trim()).filter(Boolean),
      exclusionPatterns: draftExclusions.split("\n").map((value) => value.trim()).filter(Boolean),
      severityFloor: draftSeverity,
      safeRewrite: draftRewrites.split("\n").map((value) => value.trim()).filter(Boolean),
    };
    if (
      decision === "approve_with_edits"
      && (!editedDraft.title || !editedDraft.riskSummary || !editedDraft.riskDomain || !editedDraft.triggerPatterns.length || (editedDraft.matchMode !== "atomic_lexeme" && !editedDraft.contextPatterns.length) || !editedDraft.safeRewrite.length)
    ) {
      setDecisionState({ state: "error", candidateId: selectedCandidate.id, message: "위험 분류, 제목, 요약, 탐지 패턴과 대체 문구를 확인해 주세요." });
      return;
    }

    setDecisionState({ state: "submitting", candidateId: selectedCandidate.id, decision });
    try {
      const response = await fetch(sameOriginEndpoint(decisionEndpoint), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-riskshield-csrf": csrfToken,
        },
        body: JSON.stringify({
          candidateId: selectedCandidate.id,
          decision,
          note: note || null,
          mergeSkillId: decision === "merge" ? mergeSkillId.trim() : null,
          editedDraft: decision === "approve_with_edits" ? editedDraft : null,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "결정을 저장하지 못했습니다.";
        throw new Error(message);
      }
      if (!isRecord(payload) || payload.acknowledged !== true) {
        throw new Error("서버 acknowledgement를 확인하지 못했습니다.");
      }
      const candidateStatusValue = typeof payload.candidateStatus === "string"
        && payload.candidateStatus in statusLabels
        ? payload.candidateStatus as ReviewCandidateStatus
        : null;
      setDecisionState({
        state: "success",
        candidateId: selectedCandidate.id,
        acknowledgement: {
          acknowledged: true,
          decisionId: typeof payload.decisionId === "string" ? payload.decisionId : null,
          candidateStatus: candidateStatusValue,
          message: typeof payload.message === "string" ? payload.message : "서버가 결정을 확인했습니다.",
        },
      });
    } catch (error) {
      setDecisionState({
        state: "error",
        candidateId: selectedCandidate.id,
        message: error instanceof Error ? error.message : "결정을 저장하지 못했습니다.",
      });
    }
  }

  const summaryMetrics = [
    { key: "total", label: "전체 후보", value: displayNumber(summary.total), numeric: true },
    { key: "pending", label: "검토 대기", value: displayNumber(summary.pending), numeric: true },
    { key: "novelty", label: "높은 신규성", value: displayNumber(summary.highNovelty), numeric: true },
    { key: "conflict", label: "모델 충돌", value: displayNumber(summary.modelConflicts), numeric: true },
  ];

  return (
    <section className="reviewInbox" aria-label="AI 후보 검토함">
      <div className="reviewInboxHeading">
        <ProductMetricGrid metrics={summaryMetrics} label="검토함 요약" />
        {developmentFixture ? <strong className="developmentDataBadge">개발 데이터</strong> : null}
      </div>

      {degradedMessage ? (
        <StatePanel state="degraded" title="일부 후보 데이터만 표시합니다." description={degradedMessage} compact />
      ) : null}

      <form className="reviewInboxFilters" role="search" onSubmit={(event) => event.preventDefault()}>
        <label>
          <span>후보 검색</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="표현, 분야, 검토 이유" />
        </label>
        <label>
          <span>상태</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as "all" | ReviewCandidateStatus)}>
            <option value="all">전체</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>위험 분야</span>
          <select value={riskDomain} onChange={(event) => setRiskDomain(event.target.value)}>
            <option value="all">전체 분야</option>
            {domains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}
          </select>
        </label>
        <label>
          <span>후보 유형</span>
          <select value={candidateType} onChange={(event) => setCandidateType(event.target.value)}>
            <option value="all">전체 유형</option>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
      </form>

      {candidates.length === 0 ? (
        <StatePanel state="empty" title="검토할 후보가 없습니다." description="새 후보가 생성되면 이 검토함에 표시됩니다." />
      ) : filteredCandidates.length === 0 ? (
        <StatePanel state="filter-empty" title="조건에 맞는 후보가 없습니다." description="검색어나 필터를 조정해 주세요." />
      ) : selectedCandidate ? (
        <>
          <SplitPane
            className="reviewInboxSplitPane"
            primaryLabel="후보 목록"
            secondaryLabel="후보 상세"
            separatorLabel="후보 목록과 상세 너비 조절"
            primary={
              <ul className="reviewCandidateList">
                {filteredCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <Pressable
                      className="reviewCandidateListItem"
                      aria-pressed={candidate.id === selectedCandidate.id}
                      onClick={() => {
                        setSelectedId(candidate.id);
                        if (mobileView) setMobileDetailOpen(true);
                        setDecisionState({ state: "idle" });
                        setDecisionNote("");
                        setMergeSkillId("");
                        loadDraft(candidate);
                      }}
                    >
                      <span className="reviewCandidateListTopline">
                        <strong>{candidate.representativeExpression}</strong>
                        <small>{statusLabels[candidate.status]}</small>
                      </span>
                      <span>{candidate.candidateType} · {candidate.riskDomain}</span>
                      <span>{candidate.reviewReason}</span>
                      <span className="reviewCandidateListMetrics">
                        신규성 {displayNumber(candidate.noveltyPercent, "%")} · 신뢰도 {displayNumber(candidate.confidencePercent, "%")} · 출처 {displayNumber(candidate.sourceCount)}
                      </span>
                      <time dateTime={candidate.createdAt}>{displayDate(candidate.createdAt)}</time>
                    </Pressable>
                  </li>
                ))}
              </ul>
            }
            secondary={<CandidateDetail candidate={selectedCandidate} />}
          />

          <ModalSheet
            open={mobileView && mobileDetailOpen}
            title={`${selectedCandidate.representativeExpression} 후보 상세`}
            onClose={() => setMobileDetailOpen(false)}
          >
            <CandidateDetail candidate={selectedCandidate} instance="sheet" />
          </ModalSheet>

          <section className="candidateDecisionPanel" aria-labelledby="candidate-decision-title">
            <header>
              <h2 id="candidate-decision-title">검토 결정</h2>
              <p>결정 버튼을 누른 뒤 저장 완료 안내가 나타나야 처리된 것입니다.</p>
            </header>
            <label>
              <span>결정 근거</span>
              <textarea
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
                rows={4}
                disabled={submitting}
                placeholder="수정, 병합, 보류 또는 반려의 근거를 기록하세요."
              />
            </label>
            <label>
              <span>병합할 기존 스킬 ID</span>
              <input
                value={mergeSkillId}
                onChange={(event) => setMergeSkillId(event.target.value)}
                disabled={submitting}
                placeholder="병합 결정에만 필요"
              />
            </label>
            <details className="candidateDraftDetails">
              <summary><span><strong>규칙 초안 직접 수정</strong><small>‘수정 후 승인’을 선택할 때만 확인하세요.</small></span><b>열기</b></summary>
            <fieldset className="candidateDraftEditor" disabled={submitting || !selectedCandidate.draft}>
              <legend>수정 후 승인 초안</legend>
              <label><span>제목</span><input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} /></label>
              <label><span>위험 요약</span><textarea rows={3} value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} /></label>
              <label><span>위험 범주</span><select value={draftRiskFamily} onChange={(event) => setDraftRiskFamily(event.target.value)}><option value="hate_discrimination">혐오·차별</option><option value="abusive_language">욕설·공격</option><option value="coded_expression">숨은 은어·코드 표현</option><option value="violent_threat">폭력·위협</option><option value="health_claim">의료·효능 주장</option><option value="financial_guarantee">금융 보장</option><option value="income_claim">수익·소득 주장</option><option value="general_substantiation">일반 과장·입증</option></select></label>
              <label><span>화면 표시 분야</span><input value={draftRiskDomain} onChange={(event) => setDraftRiskDomain(event.target.value)} /></label>
              <label><span>탐지 방식</span><select value={draftMatchMode} onChange={(event) => setDraftMatchMode(event.target.value as "atomic_lexeme" | "trigger_and_context")}><option value="atomic_lexeme">단일 표현</option><option value="trigger_and_context">표현 + 문맥 조합</option></select></label>
              <label><span>Trigger 패턴 · 한 줄에 하나</span><textarea rows={4} value={draftTriggers} onChange={(event) => setDraftTriggers(event.target.value)} /></label>
              <label><span>Context 패턴 · 한 줄에 하나</span><textarea rows={4} value={draftContexts} onChange={(event) => setDraftContexts(event.target.value)} /></label>
              <label><span>제외 문맥 · 한 줄에 하나</span><textarea rows={3} value={draftExclusions} onChange={(event) => setDraftExclusions(event.target.value)} /></label>
              <label><span>기본 위험도</span><input type="number" min={1} max={100} value={draftSeverity} onChange={(event) => setDraftSeverity(Number(event.target.value))} /></label>
              <label><span>대체 문구 · 한 줄에 하나</span><textarea rows={3} value={draftRewrites} onChange={(event) => setDraftRewrites(event.target.value)} /></label>
            </fieldset>
            </details>
            <div className="candidateDecisionActions" aria-label="후보 결정">
              {supportedDecisions.map((decision) => (
                <Pressable
                  key={decision}
                  className={`candidateDecisionButton candidateDecision-${decision}`}
                  disabled={submitting}
                  onClick={() => void submitDecision(decision)}
                >
                  {submitting && decisionState.state === "submitting" && decisionState.decision === decision
                    ? "서버 확인 중…"
                    : decisionLabels[decision]}
                </Pressable>
              ))}
            </div>
            <div className="candidateDecisionStatus" aria-live="polite" aria-atomic="true">
              {decisionState.state === "success" && decisionState.candidateId === selectedCandidate.id ? (
                <p className="serverAcknowledgement" data-status="success">
                  {decisionState.acknowledgement.message}
                  {decisionState.acknowledgement.decisionId ? ` · 결정 ID ${decisionState.acknowledgement.decisionId}` : ""}
                </p>
              ) : null}
              {decisionState.state === "error" && decisionState.candidateId === selectedCandidate.id ? (
                <p role="alert" data-status="error">{decisionState.message}</p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
