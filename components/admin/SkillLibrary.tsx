"use client";

import { useMemo, useState } from "react";
import { ProductDataTable, ProductDefinitionList, ProductMetricGrid } from "../data-display/ProductData";
import { Pressable } from "../interaction/Pressable";
import { SplitPane } from "../interaction/SplitPane";
import { StatePanel } from "../states/StatePanel";

export type SerializableJson = null | boolean | number | string | SerializableJson[] | {
  [key: string]: SerializableJson;
};

export type SkillReviewStatus = "draft" | "reviewed" | "rejected";

export type SkillRegressionCase = {
  id: string;
  input: string;
  expected: string;
  actual: string | null;
  passed: boolean | null;
  contextSlice: string | null;
};

export type SkillLibraryItem = {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  reviewStatus: SkillReviewStatus;
  score: number | null;
  sourceCount: number | null;
  revision: number;
  updatedAt: string;
  active: boolean;
  payload: SerializableJson;
  regressionTests: SkillRegressionCase[];
};

export type SkillLibraryProps = {
  skills: SkillLibraryItem[];
  revisionEndpoint: string;
  csrfToken: string;
  initialSkillId?: string;
  developmentFixture?: boolean;
  degradedMessage?: string | null;
};

type SortKey = "updated_desc" | "updated_asc" | "name_asc" | "score_desc" | "revision_desc";

type RevisionDraft = {
  summary: string;
  rationale: string;
  payload: string;
};

type RevisionState =
  | { state: "idle" }
  | { state: "submitting"; skillId: string }
  | { state: "success"; skillId: string; message: string; revisionId: string | null; proposedRevision: number | null }
  | { state: "error"; skillId: string; message: string };

const reviewStatusLabels: Record<SkillReviewStatus, string> = {
  draft: "초안",
  reviewed: "검토 완료",
  rejected: "반려",
};

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
  if (resolved.origin !== window.location.origin) throw new Error("허용되지 않은 revision endpoint입니다.");
  return `${resolved.pathname}${resolved.search}`;
}

function defaultDraft(skill: SkillLibraryItem): RevisionDraft {
  return {
    summary: "",
    rationale: "",
    payload: JSON.stringify(skill.payload, null, 2),
  };
}

function compareSkills(left: SkillLibraryItem, right: SkillLibraryItem, sort: SortKey) {
  if (sort === "name_asc") return left.name.localeCompare(right.name, "ko-KR");
  if (sort === "score_desc") return (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY);
  if (sort === "revision_desc") return right.revision - left.revision;
  const leftTime = Date.parse(left.updatedAt) || 0;
  const rightTime = Date.parse(right.updatedAt) || 0;
  return sort === "updated_asc" ? leftTime - rightTime : rightTime - leftTime;
}

function RegressionPanel({ tests }: { tests: SkillRegressionCase[] }) {
  const passed = tests.filter((test) => test.passed === true).length;
  const failed = tests.filter((test) => test.passed === false).length;
  const pending = tests.filter((test) => test.passed === null).length;
  const columns = [
    { key: "input", header: "입력", rowHeader: true, render: (test: SkillRegressionCase) => test.input },
    { key: "expected", header: "기대", render: (test: SkillRegressionCase) => test.expected },
    { key: "actual", header: "실제", render: (test: SkillRegressionCase) => test.actual ?? "미실행" },
    { key: "slice", header: "Context slice", render: (test: SkillRegressionCase) => test.contextSlice ?? "미지정" },
    {
      key: "result",
      header: "결과",
      render: (test: SkillRegressionCase) => test.passed === null ? "미실행" : test.passed ? "통과" : "실패",
    },
  ] as const;

  return (
    <section className="skillRegressionPanel" aria-labelledby="skill-regression-title">
      <h3 id="skill-regression-title">관련 회귀 테스트</h3>
      <ProductMetricGrid
        label="회귀 테스트 요약"
        metrics={[
          { key: "total", label: "전체", value: tests.length, numeric: true },
          { key: "passed", label: "통과", value: passed, numeric: true, tone: "positive" },
          { key: "failed", label: "실패", value: failed, numeric: true, tone: failed ? "critical" : "neutral" },
          { key: "pending", label: "미실행", value: pending, numeric: true, tone: pending ? "warning" : "neutral" },
        ]}
      />
      <ProductDataTable
        caption="스킬 회귀 테스트"
        columns={columns}
        rows={tests}
        getRowKey={(test) => test.id}
        emptyContent="연결된 회귀 테스트가 없습니다."
      />
    </section>
  );
}

export function SkillLibrary({
  skills,
  revisionEndpoint,
  csrfToken,
  initialSkillId,
  developmentFixture = false,
  degradedMessage,
}: SkillLibraryProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | SkillReviewStatus>("all");
  const [category, setCategory] = useState("all");
  const [activity, setActivity] = useState<"all" | "active" | "inactive">("all");
  const [sort, setSort] = useState<SortKey>("updated_desc");
  const [selectedId, setSelectedId] = useState(initialSkillId ?? skills[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, RevisionDraft>>({});
  const [revisionState, setRevisionState] = useState<RevisionState>({ state: "idle" });

  const categories = useMemo(
    () => [...new Set(skills.map((skill) => skill.category))].sort((left, right) => left.localeCompare(right, "ko-KR")),
    [skills],
  );
  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return skills
      .filter((skill) => {
        const haystack = [skill.id, skill.name, skill.category, skill.subcategory ?? ""]
          .join(" ")
          .toLocaleLowerCase("ko-KR");
        return (status === "all" || skill.reviewStatus === status)
          && (category === "all" || skill.category === category)
          && (activity === "all" || (activity === "active" ? skill.active : !skill.active))
          && (!normalized || haystack.includes(normalized));
      })
      .sort((left, right) => compareSkills(left, right, sort));
  }, [activity, category, query, skills, sort, status]);
  const selectedSkill = filteredSkills.find((skill) => skill.id === selectedId)
    ?? filteredSkills[0]
    ?? null;
  const selectedDraft = selectedSkill ? drafts[selectedSkill.id] ?? defaultDraft(selectedSkill) : null;
  const submitting = revisionState.state === "submitting";

  function patchDraft(skill: SkillLibraryItem, patch: Partial<RevisionDraft>) {
    setDrafts((current) => ({
      ...current,
      [skill.id]: { ...(current[skill.id] ?? defaultDraft(skill)), ...patch },
    }));
    if (revisionState.state !== "idle") setRevisionState({ state: "idle" });
  }

  async function submitRevision() {
    if (!selectedSkill || !selectedDraft || submitting) return;
    const summary = selectedDraft.summary.trim();
    const rationale = selectedDraft.rationale.trim();
    if (!summary || !rationale) {
      setRevisionState({ state: "error", skillId: selectedSkill.id, message: "변경 요약과 제안 근거를 입력해 주세요." });
      return;
    }

    let proposedPayload: unknown;
    try {
      proposedPayload = JSON.parse(selectedDraft.payload) as unknown;
    } catch {
      setRevisionState({ state: "error", skillId: selectedSkill.id, message: "제안 payload가 올바른 JSON이 아닙니다." });
      return;
    }
    if (!isRecord(proposedPayload)) {
      setRevisionState({ state: "error", skillId: selectedSkill.id, message: "제안 payload는 JSON object여야 합니다." });
      return;
    }

    setRevisionState({ state: "submitting", skillId: selectedSkill.id });
    try {
      const response = await fetch(sameOriginEndpoint(revisionEndpoint), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-riskshield-csrf": csrfToken,
        },
        body: JSON.stringify({
          skillId: selectedSkill.id,
          baseRevision: selectedSkill.revision,
          summary,
          rationale,
          proposedPayload,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "revision 제안을 저장하지 못했습니다.";
        throw new Error(message);
      }
      if (!isRecord(payload) || payload.acknowledged !== true) {
        throw new Error("서버 acknowledgement를 확인하지 못했습니다.");
      }
      setRevisionState({
        state: "success",
        skillId: selectedSkill.id,
        message: typeof payload.message === "string" ? payload.message : "서버가 revision 제안을 확인했습니다.",
        revisionId: typeof payload.revisionId === "string" ? payload.revisionId : null,
        proposedRevision: typeof payload.proposedRevision === "number" ? payload.proposedRevision : null,
      });
    } catch (error) {
      setRevisionState({
        state: "error",
        skillId: selectedSkill.id,
        message: error instanceof Error ? error.message : "revision 제안을 저장하지 못했습니다.",
      });
    }
  }

  return (
    <section className="skillLibrary" aria-label="관리자 스킬 라이브러리">
      <div className="skillLibraryHeading">
        <ProductMetricGrid
          label="스킬 라이브러리 요약"
          metrics={[
            { key: "total", label: "전체", value: skills.length, numeric: true },
            { key: "reviewed", label: "검토 완료", value: skills.filter((skill) => skill.reviewStatus === "reviewed").length, numeric: true },
            { key: "draft", label: "초안", value: skills.filter((skill) => skill.reviewStatus === "draft").length, numeric: true },
            { key: "active", label: "활성", value: skills.filter((skill) => skill.active).length, numeric: true },
          ]}
        />
        {developmentFixture ? <strong className="developmentDataBadge">개발 데이터</strong> : null}
      </div>

      {degradedMessage ? (
        <StatePanel state="degraded" title="일부 스킬 데이터만 표시합니다." description={degradedMessage} compact />
      ) : null}

      <form className="skillLibraryFilters" role="search" onSubmit={(event) => event.preventDefault()}>
        <label>
          <span>스킬 검색</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, ID, category" />
        </label>
        <label>
          <span>검토 상태</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as "all" | SkillReviewStatus)}>
            <option value="all">전체 상태</option>
            {Object.entries(reviewStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">전체 category</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>활성 상태</span>
          <select value={activity} onChange={(event) => setActivity(event.target.value as "all" | "active" | "inactive")}>
            <option value="all">전체</option>
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
          </select>
        </label>
        <label>
          <span>정렬</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="updated_desc">최근 수정순</option>
            <option value="updated_asc">오래된 수정순</option>
            <option value="name_asc">이름순</option>
            <option value="score_desc">점수 높은순</option>
            <option value="revision_desc">Revision 높은순</option>
          </select>
        </label>
      </form>

      {skills.length === 0 ? (
        <StatePanel state="empty" title="등록된 스킬이 없습니다." description="SkillRepository가 반환한 스킬이 없습니다." />
      ) : filteredSkills.length === 0 ? (
        <StatePanel state="filter-empty" title="조건에 맞는 스킬이 없습니다." description="검색어나 filter를 조정해 주세요." />
      ) : selectedSkill && selectedDraft ? (
        <SplitPane
          className="skillLibrarySplitPane"
          primaryLabel="스킬 목록"
          secondaryLabel="스킬 상세"
          separatorLabel="스킬 목록과 상세 너비 조절"
          primary={
            <ul className="skillLibraryList">
              {filteredSkills.map((skill) => (
                <li key={skill.id}>
                  <Pressable
                    className="skillLibraryListItem"
                    aria-pressed={skill.id === selectedSkill.id}
                    onClick={() => {
                      setSelectedId(skill.id);
                      setRevisionState({ state: "idle" });
                    }}
                  >
                    <span className="skillLibraryListTopline">
                      <strong>{skill.name}</strong>
                      <small>{reviewStatusLabels[skill.reviewStatus]}</small>
                    </span>
                    <span>{skill.category}{skill.subcategory ? ` · ${skill.subcategory}` : ""}</span>
                    <span>점수 {displayNumber(skill.score)} · 출처 {displayNumber(skill.sourceCount)} · revision {skill.revision}</span>
                    <span>{skill.active ? "활성" : "비활성"} · {displayDate(skill.updatedAt)}</span>
                  </Pressable>
                </li>
              ))}
            </ul>
          }
          secondary={
            <article className="skillLibraryDetail" aria-labelledby={`skill-${selectedSkill.id}-title`}>
              <header>
                <div>
                  <p>{selectedSkill.id}</p>
                  <h2 id={`skill-${selectedSkill.id}-title`}>{selectedSkill.name}</h2>
                </div>
                <span className={`skillStatus skillStatus-${selectedSkill.reviewStatus}`}>
                  {reviewStatusLabels[selectedSkill.reviewStatus]}
                </span>
              </header>
              <ProductDefinitionList
                label="스킬 기본 정보"
                items={[
                  { key: "category", term: "Category", description: selectedSkill.category },
                  { key: "subcategory", term: "Subcategory", description: selectedSkill.subcategory ?? "미지정" },
                  { key: "score", term: "Score", description: displayNumber(selectedSkill.score) },
                  { key: "sources", term: "Source 수", description: displayNumber(selectedSkill.sourceCount) },
                  { key: "revision", term: "Revision", description: selectedSkill.revision },
                  { key: "updated", term: "수정 시각", description: displayDate(selectedSkill.updatedAt) },
                  { key: "active", term: "활성 여부", description: selectedSkill.active ? "활성" : "비활성" },
                ]}
              />

              <section className="skillPayloadPanel" aria-labelledby="skill-payload-title">
                <h3 id="skill-payload-title">기존 payload</h3>
                <p>이 payload는 권한을 확인한 관리자 화면에서만 표시합니다.</p>
                <pre tabIndex={0} aria-label={`${selectedSkill.name} 관리 payload`}>
                  <code>{JSON.stringify(selectedSkill.payload, null, 2)}</code>
                </pre>
              </section>

              <RegressionPanel tests={selectedSkill.regressionTests} />

              <section className="skillRevisionForm" aria-labelledby="skill-revision-title">
                <h3 id="skill-revision-title">새 revision 제안</h3>
                <p>현재 revision을 직접 덮어쓰지 않고 검토 가능한 제안을 생성합니다.</p>
                <label>
                  <span>변경 요약</span>
                  <input
                    value={selectedDraft.summary}
                    onChange={(event) => patchDraft(selectedSkill, { summary: event.target.value })}
                    disabled={submitting}
                  />
                </label>
                <label>
                  <span>제안 근거</span>
                  <textarea
                    value={selectedDraft.rationale}
                    onChange={(event) => patchDraft(selectedSkill, { rationale: event.target.value })}
                    rows={4}
                    disabled={submitting}
                  />
                </label>
                <label>
                  <span>제안 payload JSON</span>
                  <textarea
                    className="skillRevisionPayloadEditor"
                    value={selectedDraft.payload}
                    onChange={(event) => patchDraft(selectedSkill, { payload: event.target.value })}
                    rows={18}
                    spellCheck={false}
                    disabled={submitting}
                  />
                </label>
                <Pressable className="skillRevisionSubmit" disabled={submitting} onClick={() => void submitRevision()}>
                  {submitting ? "서버 확인 중…" : "Revision 제안 저장"}
                </Pressable>
                <div className="skillRevisionStatus" aria-live="polite" aria-atomic="true">
                  {revisionState.state === "success" && revisionState.skillId === selectedSkill.id ? (
                    <p className="serverAcknowledgement" data-status="success">
                      {revisionState.message}
                      {revisionState.revisionId ? ` · 제안 ID ${revisionState.revisionId}` : ""}
                      {revisionState.proposedRevision === null ? "" : ` · proposed revision ${revisionState.proposedRevision}`}
                    </p>
                  ) : null}
                  {revisionState.state === "error" && revisionState.skillId === selectedSkill.id ? (
                    <p role="alert" data-status="error">{revisionState.message}</p>
                  ) : null}
                </div>
              </section>
            </article>
          }
        />
      ) : null}
    </section>
  );
}
