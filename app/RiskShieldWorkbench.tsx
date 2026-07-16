"use client";

import {
  analyzeText,
  buildExportBundle,
  buildHighlightSegments,
  createMockSkillDraft,
  parseCsv,
  starterSkills,
  summarizeCsv,
  validateSkill,
  type AnalysisResult,
  type CaseInput,
  type CsvSummary,
  type HighlightSegment,
  type RiskSkill,
} from "@/lib/riskshield";
import { useEffect, useMemo, useRef, useState } from "react";

type ViewId = "builder" | "import" | "library" | "analyzer" | "export";

const NAV_ITEMS: Array<{
  id: ViewId;
  label: string;
  short: string;
  description: string;
}> = [
  { id: "builder", label: "스킬 만들기", short: "01", description: "사례를 조합 패턴으로 변환" },
  { id: "import", label: "CSV 가져오기", short: "02", description: "대량 자료를 검토 큐로 이동" },
  { id: "library", label: "스킬 라이브러리", short: "03", description: "스킬 검색과 사람 검토" },
  { id: "analyzer", label: "Analyzer 테스트", short: "04", description: "실제 문구로 패턴 검증" },
  { id: "export", label: "내보내기", short: "05", description: "Analyzer용 파일 생성" },
];

const BUILDER_STEPS = ["자료 입력", "맥락 해석", "사람 검토", "Analyzer 검증"];

const QUICK_TESTS = [
  "15초만에 형량 분석",
  "기각 시 100% 환불",
  "잊지말자 625%",
  "100% 완치",
  "월 수익 보장",
];

const EMPTY_CASE: CaseInput = {
  text: "",
  description: "",
  domain: "법률 광고",
  occurredAt: "",
  sourceUrl: "",
  memo: "",
};

function makeBlankSkill(): RiskSkill {
  const now = new Date().toISOString();
  return {
    id: "risk_draft_" + now.replace(/[-:.TZ]/g, "").slice(0, 14),
    category: "",
    subcategory: "",
    patternType: "",
    triggerPatterns: [],
    contextPatterns: [],
    surfaceMeaning: "",
    riskSummary: "",
    socialContext: "",
    legalOrEthicIssue: "",
    riskReason: "",
    severityFloor: 55,
    dominantRisk: false,
    confidence: 0.5,
    riskDomain: "",
    recentContextTags: [],
    safeRewrite: [],
    falsePositiveNote: "",
    source: {
      title: "",
      url: "",
      date: "",
      sourceId: "manual_" + now.replace(/[-:.TZ]/g, "").slice(0, 14),
      provenanceStatus: "synthetic_unverified",
    },
    createdAt: now,
    updatedAt: now,
    reviewStatus: "draft",
  };
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatTime(value: string) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function profileName(profile: CsvSummary["profile"]) {
  if (profile === "controversy") return "논란 표현 데이터";
  if (profile === "false_advertising") return "허위·과장 광고 데이터";
  if (profile === "hate_speech") return "혐오 표현 사전";
  return "일반 CSV";
}

function gradeTone(grade: AnalysisResult["grade"]) {
  if (grade === "높음") return "critical";
  if (grade === "주의") return "warning";
  if (grade === "유의") return "notice";
  return "safe";
}

function ChipEditor({
  label,
  values,
  onChange,
  tone = "brand",
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  tone?: "brand" | "risk" | "neutral";
}) {
  const [draft, setDraft] = useState("");

  function addValue() {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft("");
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div className={cx("chipEditor", "chipEditor-" + tone)}>
        <div className="chipList" aria-label={label + " 목록"}>
          {values.map((value, index) => (
            <span className="editableChip" key={value + index}>
              <span>{value.replace(/^re:/, "정규식 · ")}</span>
              <button
                type="button"
                aria-label={value + " 삭제"}
                onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="chipInputRow">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addValue();
              }
            }}
            aria-label={label + " 추가"}
            placeholder="패턴 입력 후 Enter"
          />
          <button type="button" className="textButton" onClick={addValue}>
            추가
          </button>
        </div>
      </div>
    </div>
  );
}

function HighlightedSentence({
  result,
  compact = false,
}: {
  result: AnalysisResult;
  compact?: boolean;
}) {
  const segments: HighlightSegment[] = result.primaryMatch
    ? buildHighlightSegments(result.input, result.primaryMatch.hits)
    : [{ text: result.input, role: "plain", start: 0, end: result.input.length }];

  return (
    <div className={cx("highlightSentence", compact && "highlightSentenceCompact")}>
      <p aria-label="위험 패턴이 표시된 분석 문구">
        {segments.map((segment, index) =>
          segment.role === "plain" ? (
            <span key={segment.start + "-" + index}>{segment.text}</span>
          ) : (
            <mark
              className={"highlight-" + segment.role}
              key={segment.start + "-" + index}
              title={segment.role === "context" ? "맥락 패턴" : segment.role === "trigger" ? "트리거 패턴" : "트리거와 맥락 패턴"}
            >
              {segment.text}
            </mark>
          ),
        )}
      </p>
      <div className="highlightLegend" aria-label="하이라이트 범례">
        <span><i className="legendTrigger" />트리거</span>
        <span><i className="legendContext" />맥락</span>
      </div>
    </div>
  );
}

function AnalysisPanel({
  result,
  title = "Analyzer 미리보기",
  compact = false,
}: {
  result: AnalysisResult;
  title?: string;
  compact?: boolean;
}) {
  const primary = result.primaryMatch;
  const tone = gradeTone(result.grade);

  return (
    <section className={cx("analysisPanel", compact && "analysisPanelCompact")} aria-labelledby="analysis-result-title" data-testid="analyzer-result">
      <div className="panelHeading">
        <div>
          <span className="eyebrow">DOMINANT RISK SCORING</span>
          <h2 id="analysis-result-title">{title}</h2>
        </div>
        <span className={cx("statusBadge", "statusBadge-" + tone)}>
          {result.grade} · {result.finalScore}점
        </span>
      </div>

      <div className="scoreHero">
        <div>
          <span className="scoreLabel">최종 리스크</span>
          <strong data-testid="analyzer-score">{result.finalScore}</strong>
          <span className="scoreUnit">/ 100</span>
        </div>
        <div className="scoreMeta">
          <span className={cx("gradePill", "gradePill-" + tone)}>{result.grade}</span>
          <span>{result.recommendation}</span>
        </div>
      </div>
      <meter
        className={"riskMeter riskMeter-" + tone}
        min={0}
        max={100}
        value={result.finalScore}
        aria-label={"최종 리스크 점수 " + result.finalScore + "점"}
      >
        {result.finalScore}점
      </meter>

      <HighlightedSentence result={result} compact={compact} />

      {primary ? (
        <>
          <div className="patternPair" aria-label="탐지된 조합 패턴">
            <span>{primary.hits.find((hit) => hit.role === "trigger")?.text ?? "트리거"}</span>
            <b aria-hidden="true">+</b>
            <span>{primary.hits.find((hit) => hit.role === "context")?.text ?? "맥락"}</span>
          </div>

          <dl className="evidenceGrid">
            <div>
              <dt>가장 높은 카테고리</dt>
              <dd>{result.topCategoryScore}점</dd>
            </div>
            <div>
              <dt>Dominant floor</dt>
              <dd>{result.dominantFloor || "—"}{result.dominantFloor ? "점" : ""}</dd>
            </div>
            <div>
              <dt>적용 스킬</dt>
              <dd>{primary.skill.id}</dd>
            </div>
          </dl>

          <div className="evidenceCard">
            <div className="evidenceTitle">
              <span>판단 근거</span>
              {primary.skill.dominantRisk && <span className="dominantBadge">Dominant Risk</span>}
            </div>
            <p>{primary.skill.riskReason}</p>
            <code>{primary.skill.patternType}</code>
          </div>

          <div className="rewriteCard">
            <span>안전한 대체 문구</span>
            <p>{primary.skill.safeRewrite[0]}</p>
          </div>
        </>
      ) : (
        <div className="emptyEvidence">
          <span className="emptySymbol" aria-hidden="true">○</span>
          <div>
            <strong>강한 조합 패턴이 탐지되지 않았습니다.</strong>
            <p>낮은 점수도 자동 승인을 뜻하지 않습니다. 실제 배포 맥락은 담당자가 확인해 주세요.</p>
          </div>
        </div>
      )}

      <p className="humanNote">
        RiskShield는 문구를 자동 승인하거나 금지하지 않습니다. 최종 판단은 담당자에게 있습니다.
      </p>
    </section>
  );
}

export function RiskShieldWorkbench() {
  const [activeView, setActiveView] = useState<ViewId>("builder");
  const [skills, setSkills] = useState<RiskSkill[]>(starterSkills);
  const [activeSkill, setActiveSkill] = useState<RiskSkill>(starterSkills[0]);
  const [caseInput, setCaseInput] = useState<CaseInput>({
    text: "15초만에 형량 분석",
    description: "AI 법률 서비스의 시간 단축 표현 검토",
    domain: "법률 광고",
    occurredAt: "2026-07-17",
    sourceUrl: "",
    memo: "제공된 handoff 기대 사례",
  });
  const [builderStep, setBuilderStep] = useState(3);
  const [analysisInput, setAnalysisInput] = useState("15초만에 형량 분석");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult>(() =>
    analyzeText("15초만에 형량 분석", starterSkills, { includeDrafts: true }),
  );
  const [storageLabel, setStorageLabel] = useState("샘플 불러오는 중");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [csvSummary, setCsvSummary] = useState<CsvSummary | null>(null);
  const [csvText, setCsvText] = useState("");
  const [csvName, setCsvName] = useState("");
  const [maskSensitive, setMaskSensitive] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryStatus, setLibraryStatus] = useState<"all" | "draft" | "reviewed">("all");
  const [libraryCategory, setLibraryCategory] = useState("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills")
      .then(async (response) => {
        if (!response.ok) throw new Error("storage unavailable");
        return (await response.json()) as { skills?: RiskSkill[] };
      })
      .then((payload) => {
        if (cancelled || !payload.skills?.length) return;
        setSkills(payload.skills);
        setStorageLabel("스킬 저장소 연결됨");
      })
      .catch(() => {
        if (!cancelled) setStorageLabel("제공 샘플 · 로컬 세션");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const testSkillSet = useMemo(() => {
    return [activeSkill, ...skills.filter((skill) => skill.id !== activeSkill.id)];
  }, [activeSkill, skills]);

  const validationErrors = useMemo(() => validateSkill(activeSkill), [activeSkill]);
  const categories = useMemo(
    () => [...new Set(skills.map((skill) => skill.category).filter(Boolean))].sort(),
    [skills],
  );
  const filteredSkills = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase("ko-KR");
    return skills.filter((skill) => {
      const matchesStatus = libraryStatus === "all" || skill.reviewStatus === libraryStatus;
      const matchesCategory = libraryCategory === "all" || skill.category === libraryCategory;
      const haystack = [skill.id, skill.category, skill.subcategory, skill.patternType]
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      return matchesStatus && matchesCategory && (!query || haystack.includes(query));
    });
  }, [libraryCategory, libraryQuery, libraryStatus, skills]);

  const exportBundle = useMemo(() => buildExportBundle(skills), [skills]);
  const reviewedCount = skills.filter(
    (skill) => skill.reviewStatus === "reviewed" && validateSkill(skill).length === 0,
  ).length;

  function patchCase<K extends keyof CaseInput>(key: K, value: CaseInput[K]) {
    setCaseInput((current) => ({ ...current, [key]: value }));
  }

  function patchSkill(patch: Partial<RiskSkill>) {
    setActiveSkill((current) => ({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
  }

  function beginNewSkill() {
    setCaseInput(EMPTY_CASE);
    setActiveSkill(makeBlankSkill());
    setBuilderStep(1);
    setActiveView("builder");
    setNotice("새 초안을 열었습니다.");
  }

  function interpretCase() {
    if (!caseInput.text.trim()) {
      setNotice("논란 문구를 먼저 입력해 주세요.");
      return;
    }
    const draft = createMockSkillDraft(caseInput, skills);
    setActiveSkill(draft);
    setAnalysisInput(caseInput.text);
    setAnalysisResult(analyzeText(caseInput.text, [draft, ...skills], { includeDrafts: true }));
    setBuilderStep(3);
    setNotice("Mock 해석이 완료되었습니다. 사람이 결과를 검토해 주세요.");
  }

  function runAnalysis(value = analysisInput) {
    const text = value.trim();
    if (!text) {
      setNotice("테스트할 광고 문구를 입력해 주세요.");
      return;
    }
    setAnalysisInput(text);
    setAnalysisResult(analyzeText(text, testSkillSet, { includeDrafts: true }));
    setBuilderStep(4);
  }

  async function saveSkill(status: RiskSkill["reviewStatus"]) {
    const nextSkill: RiskSkill = {
      ...activeSkill,
      reviewStatus: status,
      updatedAt: new Date().toISOString(),
    };
    const errors = validateSkill(nextSkill);
    if (status === "reviewed" && errors.length) {
      setNotice(errors[0]);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skill: nextSkill }),
      });
      if (!response.ok) throw new Error("save failed");
      const payload = (await response.json()) as { skill?: RiskSkill };
      const saved = payload.skill ?? nextSkill;
      setActiveSkill(saved);
      setSkills((current) => [saved, ...current.filter((skill) => skill.id !== saved.id)]);
      setNotice(status === "reviewed" ? "사람 검토가 완료되었습니다." : "초안을 저장했습니다.");
    } catch {
      setActiveSkill(nextSkill);
      setSkills((current) => [nextSkill, ...current.filter((skill) => skill.id !== nextSkill.id)]);
      setNotice("저장소에 연결되지 않아 현재 세션에만 유지됩니다.");
    } finally {
      setSaving(false);
    }
  }

  async function readCsv(file?: File) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      setNotice("CSV 파일만 선택할 수 있습니다.");
      return;
    }
    const text = await file.text();
    setCsvName(file.name);
    setCsvText(text);
    setCsvSummary(summarizeCsv(text));
  }

  function stageCsvRows() {
    if (!csvText || !csvSummary) return;
    const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
    const headers = rows[0] ?? [];
    const keywordIndex = headers.findIndex((header) => /keyword|키워드/i.test(header));
    const categoryIndex = headers.findIndex((header) => /category|분류/i.test(header));
    if (keywordIndex < 0) {
      setNotice("키워드 열을 찾지 못했습니다. 열 연결을 확인해 주세요.");
      return;
    }
    const now = Date.now();
    const drafts = rows
      .slice(1, 51)
      .filter((row) => row[keywordIndex]?.trim())
      .map((row, index) =>
        createMockSkillDraft(
          {
            text: row[keywordIndex].trim(),
            description: "CSV 가져오기 · " + csvName,
            domain: row[categoryIndex]?.trim() || "분류 검토 필요",
            occurredAt: "",
            sourceUrl: "",
            memo: "CSV 검토 큐",
          },
          skills,
          new Date(now + index * 1000),
        ),
      );
    setSkills((current) => [...drafts, ...current]);
    setNotice(drafts.length + "건을 현재 세션의 검토 큐에 추가했습니다.");
    setLibraryStatus("draft");
    setActiveView("library");
  }

  function openSkill(skill: RiskSkill) {
    setActiveSkill(skill);
    setCaseInput({
      text: skill.surfaceMeaning,
      description: skill.source.title,
      domain: skill.riskDomain,
      occurredAt: skill.source.date,
      sourceUrl: skill.source.url,
      memo: "",
    });
    setBuilderStep(3);
    setActiveView("builder");
  }

  function downloadFile(name: string, content: string, type = "application/json;charset=utf-8") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice(name + " 파일을 만들었습니다.");
  }

  const exportFiles = [
    {
      name: "risk_skills.jsonl",
      description: "검토 완료된 조합형 위험 스킬",
      content: exportBundle.riskSkillsJsonl,
      type: "application/x-ndjson;charset=utf-8",
    },
    {
      name: "trend_context.json",
      description: "최근 사회적 맥락과 태그",
      content: `${JSON.stringify(exportBundle.trendContext, null, 2)}\n`,
    },
    {
      name: "severity_rules.json",
      description: "Dominant Risk 점수 규칙",
      content: `${JSON.stringify(exportBundle.severityRules, null, 2)}\n`,
    },
    {
      name: "rewrite_templates.json",
      description: "안전한 대체 문구 템플릿",
      content: `${JSON.stringify(exportBundle.rewriteTemplates, null, 2)}\n`,
    },
    {
      name: "source_index.json",
      description: "스킬별 출처와 검증 상태",
      content: `${JSON.stringify(exportBundle.sourceIndex, null, 2)}\n`,
    },
  ];

  return (
    <div className="appShell appleShell">
      <header className="siteHeader">
        <nav className="globalNav" aria-label="RiskShield 글로벌 메뉴">
          <div className="globalNavInner">
            <button type="button" className="globalBrand" onClick={() => setActiveView("builder")}>
              <span aria-hidden="true">R</span>
              <span className="visuallyHidden">RiskShield 홈</span>
            </button>
            <div className="globalNavLinks">
              <button type="button" onClick={() => setActiveView("builder")}>RiskShield</button>
              <button type="button" onClick={() => setActiveView("library")}>스킬</button>
              <button type="button" onClick={() => setActiveView("analyzer")}>Analyzer</button>
              <button type="button" onClick={() => setActiveView("export")}>전달 파일</button>
            </div>
            <div className="globalNavStatus" aria-label="현재 시스템 상태">
              <span>Mock 해석기</span>
              <span>{storageLabel}</span>
            </div>
          </div>
        </nav>

        <nav className="productNav" aria-label="RiskShield Studio 작업 메뉴">
          <div className="productNavInner">
            <button type="button" className="productName" onClick={() => setActiveView("builder")}>
              <strong>RiskShield Studio</strong>
              <span>Skill Builder</span>
            </button>
            <div className="productNavLinks">
              {NAV_ITEMS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={cx("navItem", activeView === item.id && "navItemActive")}
                  aria-current={activeView === item.id ? "page" : undefined}
                  onClick={() => setActiveView(item.id)}
                  data-view={item.id}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" className="primaryButton compactButton" onClick={beginNewSkill} data-testid="builder-new-button">
              새 스킬
            </button>
          </div>
        </nav>
      </header>

      <main className="mainArea appleMain">
        {activeView === "builder" && (
          <div className="builderLayout appleBuilder">
            <section className="builderMain" aria-labelledby="builder-title">
              <section className="pageHeading editorialHero productTileLight">
                <div>
                  <span className="editorialEyebrow">RISKSHIELD SKILL BUILDER</span>
                  <h1 id="builder-title">위험한 단어가 아닌,<br />위험해지는 맥락을 만듭니다.</h1>
                  <p>실제 사례를 조합형 위험 패턴으로 바꾸고, 사람이 검토한 결과만 Analyzer에 전달하세요.</p>
                  <div className="breadcrumb"><span>현재 스킬</span><b>/</b><span>{activeSkill.id}</span></div>
                </div>
                <div className="headingStatus">
                  <span className="sourceBadge">제공 샘플</span>
                  <span className={cx("statusBadge", activeSkill.reviewStatus === "reviewed" ? "statusBadge-safe" : "statusBadge-neutral")}>
                    {activeSkill.reviewStatus === "reviewed" ? "검토 완료" : "초안"}
                  </span>
                </div>
              </section>

              <ol className="stepper workflowStrip" aria-label="스킬 제작 단계">
                {BUILDER_STEPS.map((step, index) => (
                  <li key={step} className={cx(index + 1 <= builderStep && "stepDone", index + 1 === builderStep && "stepActive")}>
                    <button type="button" onClick={() => setBuilderStep(index + 1)}>
                      <span>{index + 1}</span>
                      <b>{step}</b>
                    </button>
                  </li>
                ))}
              </ol>

              <section className="workspaceCard inputCard productTileParchment featureSection" aria-labelledby="case-input-title">
                <div className="cardHeading">
                  <div>
                    <span className="sectionNumber">01 · SOURCE</span>
                    <h2 id="case-input-title">자료 입력</h2>
                  </div>
                  <span className="requiredNote">* 필수 입력</span>
                </div>
                <div className="field">
                  <div className="labelRow">
                    <label htmlFor="case-text">논란 문구 *</label>
                    <span>{caseInput.text.length} / 500</span>
                  </div>
                  <textarea
                    id="case-text"
                    value={caseInput.text}
                    maxLength={500}
                    rows={3}
                    onChange={(event) => patchCase("text", event.target.value)}
                    placeholder="예: 기각 시 100% 환불"
                    data-testid="builder-case-input"
                  />
                </div>
                <div className="fieldGrid">
                  <div className="field fieldWide">
                    <label htmlFor="case-description">관련 설명 *</label>
                    <input
                      id="case-description"
                      value={caseInput.description}
                      onChange={(event) => patchCase("description", event.target.value)}
                      placeholder="어떤 맥락에서 문제가 될 수 있는지 적어 주세요."
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="case-domain">분야 *</label>
                    <select id="case-domain" value={caseInput.domain} onChange={(event) => patchCase("domain", event.target.value)}>
                      <option>법률 광고</option>
                      <option>의료 광고</option>
                      <option>교육·입시 광고</option>
                      <option>금융·투자 광고</option>
                      <option>역사·기념일 민감성</option>
                      <option>재난·사고 상업화</option>
                      <option>혐오·차별·커뮤니티 밈</option>
                      <option>개인정보·감시 표현</option>
                      <option>브랜드 평판 위험</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="case-date">발생 시기</label>
                    <input id="case-date" type="date" value={caseInput.occurredAt} onChange={(event) => patchCase("occurredAt", event.target.value)} />
                  </div>
                  <div className="field fieldWide">
                    <label htmlFor="case-source">출처 URL</label>
                    <input
                      id="case-source"
                      type="url"
                      value={caseInput.sourceUrl}
                      onChange={(event) => patchCase("sourceUrl", event.target.value)}
                      placeholder="https://"
                    />
                  </div>
                </div>
                <div className="cardFooter">
                  <p><span aria-hidden="true">◇</span> Mock은 규칙 기반 시연 결과를 생성합니다. 실제 AI 분석이 아닙니다.</p>
                  <button
                    type="button"
                    className="primaryButton"
                    onClick={interpretCase}
                    data-testid="builder-interpret-button"
                  >
                    <span aria-hidden="true">✦</span> 맥락 해석하기
                  </button>
                </div>
              </section>

              <section className="workspaceCard reviewCard productTileDark featureSection" aria-labelledby="review-title">
                <div className="cardHeading">
                  <div>
                    <span className="sectionNumber">02 · HUMAN REVIEW</span>
                    <h2 id="review-title">사람 검토</h2>
                  </div>
                  <span className={cx("completionBadge", validationErrors.length === 0 && "completionBadgeComplete")}>
                    필수 항목 {validationErrors.length === 0 ? "완료" : validationErrors.length + "개 확인"}
                  </span>
                </div>
                <div className="reviewNotice">
                  <span aria-hidden="true">!</span>
                  <p><strong>담당자 검토 전에는 Analyzer에 반영되지 않습니다.</strong> 해석 결과와 출처, 오탐 가능성을 직접 확인해 주세요.</p>
                </div>

                <div className="fieldGrid">
                  <div className="field">
                    <label htmlFor="skill-category">카테고리</label>
                    <input id="skill-category" value={activeSkill.category} onChange={(event) => patchSkill({ category: event.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="skill-subcategory">세부 유형</label>
                    <input id="skill-subcategory" value={activeSkill.subcategory} onChange={(event) => patchSkill({ subcategory: event.target.value })} />
                  </div>
                  <div className="field fieldWide">
                    <label htmlFor="skill-pattern">조합 패턴</label>
                    <input id="skill-pattern" value={activeSkill.patternType} onChange={(event) => patchSkill({ patternType: event.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="skill-floor">최소 위험 점수</label>
                    <div className="numberField">
                      <input
                        id="skill-floor"
                        type="number"
                        min={0}
                        max={100}
                        value={activeSkill.severityFloor}
                        onChange={(event) => patchSkill({ severityFloor: Number(event.target.value) })}
                      />
                      <span>/ 100</span>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="skill-confidence">신뢰도</label>
                    <div className="numberField">
                      <input
                        id="skill-confidence"
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round(activeSkill.confidence * 100)}
                        onChange={(event) => patchSkill({ confidence: Number(event.target.value) / 100 })}
                      />
                      <span>%</span>
                    </div>
                  </div>
                </div>

                <div className="dominantControl">
                  <div>
                    <strong>Dominant Risk로 적용</strong>
                    <p>심각한 위험이 다른 0점 카테고리에 묻히지 않도록 최종 점수 하한을 적용합니다.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={activeSkill.dominantRisk}
                    aria-label="Dominant Risk로 적용"
                    className={cx("switchControl", activeSkill.dominantRisk && "switchControlOn")}
                    onClick={() => patchSkill({ dominantRisk: !activeSkill.dominantRisk })}
                  >
                    <span />
                  </button>
                </div>

                <div className="editorPair">
                  <ChipEditor
                    label="트리거 패턴"
                    values={activeSkill.triggerPatterns}
                    onChange={(values) => patchSkill({ triggerPatterns: values })}
                    tone="risk"
                  />
                  <div className="pairPlus" aria-hidden="true">＋</div>
                  <ChipEditor
                    label="맥락 패턴"
                    values={activeSkill.contextPatterns}
                    onChange={(values) => patchSkill({ contextPatterns: values })}
                    tone="brand"
                  />
                </div>

                <div className="field">
                  <label htmlFor="skill-reason">판단 근거</label>
                  <textarea id="skill-reason" rows={3} value={activeSkill.riskReason} onChange={(event) => patchSkill({ riskReason: event.target.value })} />
                </div>
                <div className="fieldGrid">
                  <div className="field">
                    <label htmlFor="skill-social">사회적 맥락</label>
                    <textarea id="skill-social" rows={3} value={activeSkill.socialContext} onChange={(event) => patchSkill({ socialContext: event.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="skill-ethic">법률·윤리 쟁점</label>
                    <textarea id="skill-ethic" rows={3} value={activeSkill.legalOrEthicIssue} onChange={(event) => patchSkill({ legalOrEthicIssue: event.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="skill-fp">오탐 가능성</label>
                    <textarea id="skill-fp" rows={3} value={activeSkill.falsePositiveNote} onChange={(event) => patchSkill({ falsePositiveNote: event.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="skill-rewrite">안전한 대체 문구</label>
                    <textarea
                      id="skill-rewrite"
                      rows={3}
                      value={activeSkill.safeRewrite.join("\n")}
                      onChange={(event) => patchSkill({ safeRewrite: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })}
                    />
                  </div>
                </div>
                <div className="reviewActions">
                  <span>{saving ? "저장하는 중…" : "마지막 수정 " + formatTime(activeSkill.updatedAt)}</span>
                  <div>
                    <button type="button" className="secondaryButton" onClick={() => saveSkill("draft")} disabled={saving} data-testid="builder-save-button">
                      초안 저장
                    </button>
                    <button type="button" className="primaryButton" onClick={() => saveSkill("reviewed")} disabled={saving} data-testid="builder-review-button">
                      검토 완료로 표시
                    </button>
                  </div>
                </div>
              </section>
            </section>

            <aside className="inspector productTileLight analyzerPreviewTile" aria-label="스킬 검증 패널">
              <div className="inspectorTabs" role="tablist" aria-label="검증 패널 보기">
                <button type="button" role="tab" aria-selected="true">Analyzer 미리보기</button>
                <span>현재 초안 포함</span>
              </div>
              <div className="inspectorInput">
                <label htmlFor="inspector-analysis-input">테스트할 광고 문구</label>
                <div>
                  <input
                    id="inspector-analysis-input"
                    value={analysisInput}
                    onChange={(event) => setAnalysisInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") runAnalysis();
                    }}
                  />
                  <button type="button" onClick={() => runAnalysis()} aria-label="현재 문구 분석" data-testid="analyzer-run-button">→</button>
                </div>
              </div>
              <AnalysisPanel result={analysisResult} title="실시간 검증" compact />
            </aside>
          </div>
        )}

        {activeView === "import" && (
          <section className="pageView appleView" aria-labelledby="import-title">
            <section className="pageHeading editorialHero productTileLight">
              <div>
                <span className="editorialEyebrow">DATA INTAKE</span>
                <h1 id="import-title">많은 단어보다,<br />검토할 수 있는 근거.</h1>
                <p>대량 자료를 바로 승인하지 않고 구조와 출처를 점검한 뒤 사람의 검토 큐로 보냅니다.</p>
                <div className="breadcrumb"><span>가져오기</span><b>/</b><span>CSV</span></div>
              </div>
              <span className="safetyBadge">민감 원문 보호</span>
            </section>

            <div className="importGrid productTileDark featureSection">
              <section
                className={cx("uploadZone", csvSummary && "uploadZoneComplete")}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void readCsv(event.dataTransfer.files[0]);
                }}
                aria-labelledby="upload-title"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void readCsv(event.target.files?.[0])}
                  className="visuallyHidden"
                  data-testid="csv-file-input"
                />
                <span className="uploadIcon" aria-hidden="true">{csvSummary ? "✓" : "CSV"}</span>
                <h2 id="upload-title">{csvSummary ? csvName : "CSV 파일을 놓거나 선택하세요"}</h2>
                <p>{csvSummary ? profileName(csvSummary.profile) + " · UTF-8" : "원문은 자동 승인되지 않으며 모든 결과는 사람 검토를 거칩니다."}</p>
                <button type="button" className="secondaryButton" onClick={() => fileInputRef.current?.click()}>
                  {csvSummary ? "다른 파일 선택" : "CSV 파일 선택"}
                </button>
              </section>

              <section className="workspaceCard importGuide storeUtilityCard">
                <span className="sectionNumber">SUPPORTED SCHEMAS</span>
                <h2>자동으로 열을 연결합니다</h2>
                <ul>
                  <li><b>논란 표현</b><span>Keyword · Root_Word · Category</span></li>
                  <li><b>허위 광고</b><span>Keyword · Root_Word · Category</span></li>
                  <li><b>혐오 사전</b><span>Keyword · Severity · Reason · Alternative</span></li>
                </ul>
                <div className="maskControl">
                  <div>
                    <strong>민감 원문 가리기</strong>
                    <p>혐오 표현을 목록에 대량 노출하지 않습니다.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={maskSensitive}
                    aria-label="민감 원문 가리기"
                    className={cx("switchControl", maskSensitive && "switchControlOn")}
                    onClick={() => setMaskSensitive((value) => !value)}
                  >
                    <span />
                  </button>
                </div>
              </section>
            </div>

            {csvSummary ? (
              <section className="workspaceCard csvResults productTileParchment featureSection" aria-labelledby="csv-results-title">
                <div className="cardHeading">
                  <div>
                    <span className="sectionNumber">QUALITY CHECK</span>
                    <h2 id="csv-results-title">데이터 점검 결과</h2>
                  </div>
                  <span className="completionBadge completionBadgeComplete">열 {csvSummary.headers.length}개 인식</span>
                </div>
                <div className="metricStrip">
                  <div><span>전체 행</span><strong>{csvSummary.rowCount.toLocaleString("ko-KR")}</strong></div>
                  <div><span>읽을 수 있음</span><strong>{csvSummary.validRows.toLocaleString("ko-KR")}</strong></div>
                  <div><span>중복 후보</span><strong>{csvSummary.duplicateRows.toLocaleString("ko-KR")}</strong></div>
                  <div><span>빈 필수값</span><strong>{csvSummary.invalidRows.toLocaleString("ko-KR")}</strong></div>
                  <div><span>고유 원단어</span><strong>{csvSummary.uniqueRoots.toLocaleString("ko-KR")}</strong></div>
                </div>
                <div className="mappingTable">
                  <div className="mappingHeader"><span>원본 열</span><span>연결된 필드</span><span>상태</span></div>
                  {csvSummary.headers.slice(0, 7).map((header) => (
                    <div className="mappingRow" key={header}>
                      <code>{header}</code>
                      <span>{/keyword|키워드/i.test(header) ? "원문 표현" : /root|원단어|어원/i.test(header) ? "트리거 후보" : /category|분류/i.test(header) ? "원본 분류" : /reason/i.test(header) ? "판단 근거" : /alternative/i.test(header) ? "대체 문구" : "추가 메타데이터"}</span>
                      <span className="mappingOk">연결됨</span>
                    </div>
                  ))}
                </div>
                <div className="cardFooter">
                  <p>안전을 위해 최대 50개 후보만 먼저 생성합니다. 원문은 {maskSensitive ? "가림 상태로" : "표시 상태로"} 유지됩니다.</p>
                  <button type="button" className="primaryButton" onClick={stageCsvRows} data-testid="csv-stage-button">
                    검토 큐에 추가
                  </button>
                </div>
              </section>
            ) : (
              <div className="emptyStateLine">
                <span>1</span><p><b>파일 선택</b> → 열 연결 → 데이터 점검 → 검토 큐 추가</p>
              </div>
            )}
          </section>
        )}

        {activeView === "library" && (
          <section className="pageView appleView" aria-labelledby="library-title">
            <section className="pageHeading editorialHero productTileParchment">
              <div>
                <span className="editorialEyebrow">SKILL LIBRARY</span>
                <h1 id="library-title">판단의 기준을<br />한곳에서 관리하세요.</h1>
                <p>조합 패턴, 출처, 검토 상태를 하나의 라이브러리에서 확인하고 Analyzer에 반영할 스킬을 선택합니다.</p>
                <div className="breadcrumb"><span>라이브러리</span><b>/</b><span>{skills.length} skills</span></div>
              </div>
              <button type="button" className="primaryButton" onClick={beginNewSkill}>새 스킬 만들기</button>
            </section>
            <div className="librarySummary utilityGrid">
              <div><span>전체 스킬</span><strong>{skills.length}</strong></div>
              <div><span>검토 완료</span><strong>{skills.filter((skill) => skill.reviewStatus === "reviewed").length}</strong></div>
              <div><span>검토 대기</span><strong>{skills.filter((skill) => skill.reviewStatus === "draft").length}</strong></div>
              <div><span>Dominant</span><strong>{skills.filter((skill) => skill.dominantRisk).length}</strong></div>
            </div>
            <section className="workspaceCard libraryCard productTileLight featureSection">
              <div className="filterBar">
                <label className="searchField">
                  <span className="visuallyHidden">스킬 검색</span>
                  <span aria-hidden="true">⌕</span>
                  <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="스킬 ID, 패턴, 카테고리 검색" />
                </label>
                <label>
                  <span className="visuallyHidden">검토 상태</span>
                  <select value={libraryStatus} onChange={(event) => setLibraryStatus(event.target.value as typeof libraryStatus)}>
                    <option value="all">모든 상태</option>
                    <option value="reviewed">검토 완료</option>
                    <option value="draft">초안</option>
                  </select>
                </label>
                <label>
                  <span className="visuallyHidden">카테고리</span>
                  <select value={libraryCategory} onChange={(event) => setLibraryCategory(event.target.value)}>
                    <option value="all">모든 카테고리</option>
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
              </div>
              {filteredSkills.length ? (
                <div className="tableScroll">
                  <table className="skillTable">
                    <thead>
                      <tr>
                        <th>상태</th>
                        <th>스킬 / 조합 패턴</th>
                        <th>카테고리</th>
                        <th>최소 점수</th>
                        <th>Dominant</th>
                        <th>신뢰도</th>
                        <th><span className="visuallyHidden">작업</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSkills.map((skill) => (
                        <tr key={skill.id}>
                          <td><span className={cx("tableStatus", skill.reviewStatus === "reviewed" && "tableStatusReviewed")}>{skill.reviewStatus === "reviewed" ? "검토 완료" : "초안"}</span></td>
                          <td><strong>{skill.id}</strong><code>{skill.patternType}</code></td>
                          <td>{skill.category}</td>
                          <td><b className="scoreCell">{skill.severityFloor}</b></td>
                          <td>{skill.dominantRisk ? <span className="dominantDot">적용</span> : <span className="mutedText">미적용</span>}</td>
                          <td>{Math.round(skill.confidence * 100)}%</td>
                          <td><button type="button" className="rowButton" onClick={() => openSkill(skill)} aria-label={skill.id + " 열기"}>열기</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="libraryEmpty">
                  <span aria-hidden="true">⌕</span>
                  <h2>조건과 일치하는 스킬이 없습니다.</h2>
                  <button type="button" className="secondaryButton" onClick={() => { setLibraryQuery(""); setLibraryStatus("all"); setLibraryCategory("all"); }}>필터 초기화</button>
                </div>
              )}
            </section>
          </section>
        )}

        {activeView === "analyzer" && (
          <section className="pageView appleView" aria-labelledby="analyzer-title">
            <section className="pageHeading editorialHero productTileDark">
              <div>
                <span className="editorialEyebrow">ANALYZER V4</span>
                <h1 id="analyzer-title">평균에 가려진 위험까지,<br />분명하게.</h1>
                <p>단어 하나가 아닌 표현의 조합과 사용 맥락을 읽고, 가장 지배적인 위험을 중심으로 판단합니다.</p>
                <div className="breadcrumb"><span>Analyzer v4</span><b>/</b><span>Live test</span></div>
              </div>
              <span className="engineBadge"><i />{skills.length}개 스킬 로드됨</span>
            </section>
            <div className="analyzerWorkspace productTileLight featureSection">
              <section className="workspaceCard analyzerInputCard storeUtilityCard">
                <span className="sectionNumber">TEST COPY</span>
                <h2>검토할 광고 문구</h2>
                <p>현재 초안도 포함해 패턴을 시험합니다. 결과는 자동 승인이나 금지 판단이 아닙니다.</p>
                <label htmlFor="full-analysis-input">광고 문구</label>
                <textarea
                  id="full-analysis-input"
                  rows={7}
                  value={analysisInput}
                  onChange={(event) => setAnalysisInput(event.target.value)}
                  placeholder="광고 문구를 입력해 주세요."
                  data-testid="analyzer-input"
                />
                <div className="quickTests" aria-label="빠른 테스트 예시">
                  {QUICK_TESTS.map((value) => (
                    <button type="button" key={value} onClick={() => { setAnalysisInput(value); runAnalysis(value); }}>{value}</button>
                  ))}
                </div>
                <button type="button" className="primaryButton wideButton" onClick={() => runAnalysis()} data-testid="analyzer-submit-button">
                  Dominant Risk 분석
                </button>
              </section>
              <AnalysisPanel result={analysisResult} title="분석 결과" />
            </div>
            <section className="workspaceCard categoryCard productTileParchment featureSection">
              <div className="cardHeading">
                <div><span className="sectionNumber">EVIDENCE</span><h2>카테고리별 점수</h2></div>
                <span className="requiredNote">평균 대신 최고 위험 중심</span>
              </div>
              <div className="categoryBars">
                {analysisResult.categoryScores.length ? analysisResult.categoryScores.map((category) => (
                  <div key={category.category}>
                    <div><span>{category.category}</span><b>{category.score}</b></div>
                    <span className="barTrack"><i style={{ width: category.score + "%" }} /></span>
                  </div>
                )) : <p className="mutedText">탐지된 위험 카테고리가 없습니다.</p>}
              </div>
            </section>
          </section>
        )}

        {activeView === "export" && (
          <section className="pageView appleView" aria-labelledby="export-title">
            <section className="pageHeading editorialHero productTileLight">
              <div>
                <span className="editorialEyebrow">DELIVERY</span>
                <h1 id="export-title">검토된 판단만,<br />Analyzer로.</h1>
                <p>사람의 검토를 마친 스킬만 일관된 JSONL·JSON 파일로 만들고, 출처와 상태를 함께 보존합니다.</p>
                <div className="breadcrumb"><span>Delivery</span><b>/</b><span>Analyzer files</span></div>
              </div>
              <span className="completionBadge completionBadgeComplete">5개 파일 준비</span>
            </section>
            <div className="exportHero productTileDark featureSection">
              <div>
                <span className="sectionNumber">PREFLIGHT COMPLETE</span>
                <h2>{reviewedCount}개 검토 완료 스킬이 준비되었습니다.</h2>
                <p>초안과 필수 항목이 누락된 스킬은 자동으로 제외됩니다.</p>
              </div>
              <div className="exportGauge">
                <strong>{reviewedCount}</strong><span>reviewed</span>
              </div>
            </div>
            <div className="exportList productTileLight featureSection utilityGrid">
              {exportFiles.map((file, index) => (
                <article className="exportFile storeUtilityCard" key={file.name}>
                  <div className="fileIcon" aria-hidden="true">{index === 0 ? "JL" : "{}"}</div>
                  <div>
                    <h2>{file.name}</h2>
                    <p>{file.description}</p>
                  </div>
                  <div className="fileMeta">
                    <span>{Math.max(1, Math.ceil(new TextEncoder().encode(file.content).length / 1024))} KB</span>
                    <span className="mappingOk">스키마 통과</span>
                  </div>
                  <button
                    type="button"
                    className="secondaryButton"
                    onClick={() => downloadFile(file.name, file.content, file.type)}
                    aria-label={file.name + " 다운로드"}
                  >
                    다운로드
                  </button>
                </article>
              ))}
            </div>
            <div className="exportDisclosure productTileParchment">
              <span aria-hidden="true">i</span>
              <p><strong>Human-in-the-loop 내보내기</strong> RiskShield는 검토 상태를 보존합니다. 내보낸 파일도 담당자의 최종 판단을 대체하지 않습니다.</p>
            </div>
          </section>
        )}
      </main>

      <footer className="siteFooter">
        <div className="siteFooterInner">
          <p className="footerStatement">
            <strong>판단을 자동화하지 않습니다.</strong>
            RiskShield는 담당자가 더 빠르고 일관되게 검토할 수 있도록 근거를 정리합니다.
          </p>
          <div className="footerNavigation" aria-label="RiskShield 바로가기">
            <div>
              <strong>만들기</strong>
              <button type="button" onClick={() => setActiveView("builder")}>Skill Builder</button>
              <button type="button" onClick={() => setActiveView("import")}>CSV 가져오기</button>
            </div>
            <div>
              <strong>검증하기</strong>
              <button type="button" onClick={() => setActiveView("library")}>스킬 라이브러리</button>
              <button type="button" onClick={() => setActiveView("analyzer")}>Analyzer v4</button>
            </div>
            <div>
              <strong>전달하기</strong>
              <button type="button" onClick={() => setActiveView("export")}>Analyzer 파일</button>
              <span>검토 완료 스킬만 포함</span>
            </div>
          </div>
          <div className="footerLegal">
            <span>RiskShield Studio</span>
          <span>Human in the loop · risk intelligence</span>
          </div>
        </div>
      </footer>

      <nav className="mobileNav" aria-label="모바일 RiskShield 작업 메뉴">
        {NAV_ITEMS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={activeView === item.id ? "mobileNavActive" : undefined}
            aria-current={activeView === item.id ? "page" : undefined}
            onClick={() => setActiveView(item.id)}
          >
            <span>{item.short}</span>{item.label.replace("스킬 ", "")}
          </button>
        ))}
      </nav>

      <div className={cx("toast", notice && "toastVisible")} role="status" aria-live="polite">
        {notice}
      </div>
    </div>
  );
}
