"use client";

import {
  DEFAULT_SEVERITY_RULES,
  analyzeText,
  buildExportBundle,
  buildHighlightSegments,
  createMockSkillDraft,
  parseCsv,
  parseBundleFiles,
  previewSkillImport,
  starterSkills,
  summarizeCsv,
  validateSkill,
  type AnalysisResult,
  type BundleFiles,
  type CaseInput,
  type CsvSummary,
  type HighlightSegment,
  type RiskSkill,
  type SeverityRules,
  type SkillImportPreview,
  type SkillImportMode,
} from "@/lib/riskshield";
import { candidateSkillsV03 } from "@/lib/v0-3-candidate-skills";
import { activateDraftCandidatesForTest } from "@/lib/v0-3-test-adapter";
import { useEffect, useMemo, useRef, useState } from "react";

type ViewId = "builder" | "import" | "library" | "analyzer" | "export";

const NAV_ITEMS: Array<{
  id: ViewId;
  label: string;
}> = [
  { id: "builder", label: "스킬 만들기" },
  { id: "import", label: "CSV 가져오기" },
  { id: "library", label: "스킬 라이브러리" },
  { id: "analyzer", label: "Analyzer 테스트" },
  { id: "export", label: "내보내기" },
];

const BUILDER_STEPS = [
  {
    title: "자료 입력",
    description: "먼저 검토할 문구와 최소한의 배경 정보만 입력하세요.",
  },
  {
    title: "맥락 해석",
    description: "생성된 의미와 위험 요약이 원문 맥락에 맞는지 확인하세요.",
  },
  {
    title: "분류·점수",
    description: "스킬의 적용 범위와 위험 점수 기준을 필요한 만큼 조정하세요.",
  },
  {
    title: "탐지 패턴",
    description: "함께 나타나야 할 표현과 제외할 표현을 조합하세요.",
  },
  {
    title: "사람 검토",
    description: "판단 근거와 출처를 확인한 뒤 스킬의 검토 상태를 결정하세요.",
  },
  {
    title: "Analyzer 검증",
    description: "실제 문구를 넣어 방금 만든 스킬이 의도대로 작동하는지 확인하세요.",
  },
] as const;

const QUICK_TESTS = [
  "15초만에 형량 분석",
  "기각 시 100% 환불",
  "잊지말자 625%",
  "100% 완치",
  "월 수익 보장",
];

const BUNDLE_FILE_NAMES = [
  "risk_skills.jsonl",
  "trend_context.json",
  "severity_rules.json",
  "rewrite_templates.json",
  "source_index.json",
] as const satisfies ReadonlyArray<keyof BundleFiles>;

type BundleImportReport = {
  selectedNames: string[];
  loadedNames: string[];
  skillCount: number;
  issues: string[];
  applied: boolean;
  parsedSkills: RiskSkill[];
  parsedSeverityRules: SeverityRules;
  preview: SkillImportPreview | null;
};

type BetaHybridStatus = "no_match" | "review" | "attention" | "high";

type BetaAnalysis = {
  beta: "RiskShield v0.4 AI-assisted private beta";
  rules: AnalysisResult;
  ai: {
    state: "ready" | "fallback";
    confidence: number | null;
    riskIntent: "direct_promotional" | "contextual_only" | "uncertain" | null;
    speechAct: "claim" | "quote" | "warning" | "criticism" | "report" | "definition" | "condition" | null;
    contextRelation: string | null;
    claimStrength: string | null;
    evidenceSpans: Array<{ start: number; end: number; text: string }>;
    masked: boolean;
    cached: boolean;
    latencyMs: number;
    fallbackKind: "timeout" | "resource_exhausted" | "validation" | "provider_error" | null;
  };
  hybrid: {
    status: BetaHybridStatus;
    score: number;
    conflict: boolean;
    recoveredByInterpreter: boolean;
    suppressedHigh: boolean;
    reason: string;
  };
  notice: string;
  cachePolicy: { ttlSeconds: number; storesOriginalText: false };
};

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
    schemaVersion: "2.0.0",
    revision: 1,
    id: "risk_draft_" + now.replace(/[-:.TZ]/g, "").slice(0, 14),
    category: "",
    subcategory: "",
    patternType: "",
    triggerPatterns: [],
    contextPatterns: [],
    anyOfPatterns: [],
    exclusionPatterns: [],
    conditionScope: "sentence",
    maxDistance: 48,
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
    notes: "",
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

function reviewStatusLabel(status: RiskSkill["reviewStatus"]) {
  if (status === "reviewed") return "검토 완료";
  if (status === "rejected") return "반려";
  return "초안";
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

function statusTone(status: AnalysisResult["status"]) {
  if (status === "high") return "critical";
  if (status === "attention") return "warning";
  if (status === "review") return "notice";
  return "neutral";
}

function hybridTone(status: BetaHybridStatus) {
  if (status === "high") return "critical";
  if (status === "attention") return "warning";
  if (status === "review") return "notice";
  return "neutral";
}

function hybridLabel(status: BetaHybridStatus) {
  if (status === "high") return "높은 위험 · 담당자 검토";
  if (status === "attention") return "주의 필요";
  if (status === "review") return "사람 검토 필요";
  return "직접 위험 주장 미확인";
}

function speechActLabel(value: BetaAnalysis["ai"]["speechAct"]) {
  const labels: Record<NonNullable<BetaAnalysis["ai"]["speechAct"]>, string> = {
    claim: "직접 주장",
    quote: "인용",
    warning: "경고",
    criticism: "비판",
    report: "보도",
    definition: "정의·설명",
    condition: "조건 안내",
  };
  return value ? labels[value] : "확인 불가";
}

function riskIntentLabel(value: BetaAnalysis["ai"]["riskIntent"]) {
  if (value === "direct_promotional") return "직접 홍보 위험 주장";
  if (value === "contextual_only") return "문맥상 직접 주장 아님";
  if (value === "uncertain") return "의도 불확실";
  return "분석 실패";
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
          {values.map((value, index) => {
            const isRegex = value.startsWith("re:");
            const displayValue = isRegex ? value.slice(3) : value;

            return (
              <span className={cx("editableChip", isRegex && "editableChipRegex")} key={value + index}>
                {isRegex && <span className="chipKind">정규식</span>}
                {isRegex ? (
                  <code className="editableChipValue" title={displayValue}>{displayValue}</code>
                ) : (
                  <span className="editableChipValue" title={displayValue}>{displayValue}</span>
                )}
                <button
                  type="button"
                  aria-label={value + " 삭제"}
                  onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
                >
                  ×
                </button>
              </span>
            );
          })}
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
  scoreLabel = "최종 리스크",
}: {
  result: AnalysisResult;
  title?: string;
  compact?: boolean;
  scoreLabel?: string;
}) {
  const primary = result.primaryMatch;
  const tone = statusTone(result.status);

  return (
    <section className={cx("analysisPanel", compact && "analysisPanelCompact")} aria-labelledby="analysis-result-title" data-testid="analyzer-result">
      <div className="panelHeading">
        <div>
          <span className="eyebrow">DOMINANT RISK SCORING</span>
          <h2 id="analysis-result-title">{title}</h2>
        </div>
        <span className={cx("statusBadge", "statusBadge-" + tone)}>
          {result.statusLabel} · {result.finalScore}점
        </span>
      </div>

      <div className="scoreHero">
        <div>
          <span className="scoreLabel">{scoreLabel}</span>
          <strong data-testid="analyzer-score">{result.finalScore}</strong>
          <span className="scoreUnit">/ 100</span>
        </div>
        <div className="scoreMeta">
          <span className={cx("gradePill", "gradePill-" + tone)}>{result.statusLabel}</span>
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
            <p>{result.reason ?? primary.skill.riskReason}</p>
            <code>{primary.skill.patternType}</code>
          </div>

          {result.suggestedRewrite && (
            <div className="rewriteCard">
              <span>검토용 대체 문구</span>
              <p>{result.suggestedRewrite}</p>
            </div>
          )}
        </>
      ) : (
        <div className="emptyEvidence">
          <span className="emptySymbol" aria-hidden="true">○</span>
          <div>
            <strong>규칙 미일치 또는 판단 불가</strong>
            <p>현재 reviewed 스킬과 일치하지 않았을 뿐 안전 판정이 아닙니다. 필요한 경우 추가 문맥을 입력하고 담당자가 검토해 주세요.</p>
          </div>
        </div>
      )}

      <p className="humanNote">
        RiskShield는 문구를 자동 승인하거나 금지하지 않습니다. 최종 판단은 담당자에게 있습니다.
      </p>
    </section>
  );
}

function AiAssistPanel({ result, loading }: { result: BetaAnalysis | null; loading: boolean }) {
  if (loading) {
    return (
      <section className="analysisPanel aiAssistPanel" aria-live="polite" data-testid="ai-assist-loading">
        <div className="panelHeading">
          <div><span className="aiBetaBadge">AI 보조 베타</span><h2>AI 문맥 분석 중</h2></div>
        </div>
        <p className="aiLoadingText">규칙 결과는 유지한 채 문맥을 보조 분석하고 있습니다.</p>
      </section>
    );
  }
  if (!result) return null;

  const tone = hybridTone(result.hybrid.status);
  const confidence = result.ai.confidence === null ? "—" : `${Math.round(result.ai.confidence * 100)}%`;
  const fallbackLabels = {
    timeout: "AI 응답 시간이 초과되어 review로 전환했습니다.",
    resource_exhausted: "AI 무료 할당량이 일시 소진되어 review로 전환했습니다.",
    validation: "AI 응답 또는 근거를 검증하지 못해 review로 전환했습니다.",
    provider_error: "AI 서비스 오류로 review로 전환했습니다.",
  } as const;

  return (
    <section className="analysisPanel aiAssistPanel" aria-labelledby="ai-assist-title" data-testid="ai-assist-result">
      <div className="panelHeading">
        <div>
          <span className="aiBetaBadge">AI 보조 베타</span>
          <h2 id="ai-assist-title">하이브리드 검토 결과</h2>
        </div>
        <span className={cx("statusBadge", "statusBadge-" + tone)} data-testid="hybrid-status">
          {hybridLabel(result.hybrid.status)}
        </span>
      </div>

      <div className="hybridStatusGrid">
        <div><span>규칙 분석</span><strong>{result.rules.statusLabel} · {result.rules.finalScore}점</strong></div>
        <div><span>AI 문맥 상태</span><strong>{result.ai.state === "ready" ? riskIntentLabel(result.ai.riskIntent) : "review 폴백"}</strong></div>
        <div><span>하이브리드 최종</span><strong>{hybridLabel(result.hybrid.status)}</strong></div>
        <div><span>AI 신뢰도</span><strong>{confidence}</strong></div>
        <div><span>발화 구분</span><strong>{speechActLabel(result.ai.speechAct)}</strong></div>
        <div><span>규칙·AI 충돌</span><strong>{result.hybrid.conflict ? "있음 · 사람 검토" : "확인되지 않음"}</strong></div>
      </div>

      {result.ai.state === "fallback" && result.ai.fallbackKind ? (
        <div className="aiFallbackNotice" role="status">{fallbackLabels[result.ai.fallbackKind]}</div>
      ) : (
        <div className="aiEvidenceSummary">
          <div>
            <span>검증된 AI 근거</span>
            {result.ai.cached && <span className="cacheBadge">검증 캐시</span>}
          </div>
          {result.ai.evidenceSpans.length > 0 ? (
            <ul>{result.ai.evidenceSpans.map((span) => <li key={`${span.start}-${span.end}`}>“{span.text}”</li>)}</ul>
          ) : <p>직접 위험 주장의 근거 quote가 반환되지 않았습니다.</p>}
        </div>
      )}

      <p className="hybridReason">{result.hybrid.reason}</p>
      <p className="aiDecisionNotice">{result.notice}</p>
      <p className="aiPrivacyNote">
        개인정보는 서버에서 마스킹한 뒤 분석하며, 캐시는 원문이 아닌 입력 해시와 검증된 결과만 최대 {Math.round(result.cachePolicy.ttlSeconds / 60)}분 보관합니다.
      </p>
      <p className="humanNote">AI 결과는 보조 신호입니다. 최종 판단과 조치는 반드시 담당자가 결정합니다.</p>
    </section>
  );
}

export function RiskShieldWorkbench() {
  const [activeView, setActiveView] = useState<ViewId>("builder");
  const [skills, setSkills] = useState<RiskSkill[]>([]);
  const [activeSkill, setActiveSkill] = useState<RiskSkill>(starterSkills[0]);
  const [caseInput, setCaseInput] = useState<CaseInput>({
    text: "15초만에 형량 분석",
    description: "AI 법률 서비스의 시간 단축 표현 검토",
    domain: "법률 광고",
    occurredAt: "2026-07-17",
    sourceUrl: "",
    memo: "제공된 handoff 기대 사례",
  });
  const [builderStep, setBuilderStep] = useState(1);
  const [analyzerStep, setAnalyzerStep] = useState<1 | 2>(1);
  const [severityRules, setSeverityRules] = useState<SeverityRules>(DEFAULT_SEVERITY_RULES);
  const [analysisInput, setAnalysisInput] = useState("15초만에 형량 분석");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [betaAnalysis, setBetaAnalysis] = useState<BetaAnalysis | null>(null);
  const [betaAnalysisLoading, setBetaAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [candidatePreviewEnabled, setCandidatePreviewEnabled] = useState(false);
  const [showReviewErrors, setShowReviewErrors] = useState(false);
  const [storageLabel, setStorageLabel] = useState("저장소 연결 확인 중");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [csvSummary, setCsvSummary] = useState<CsvSummary | null>(null);
  const [csvText, setCsvText] = useState("");
  const [csvName, setCsvName] = useState("");
  const [maskSensitive, setMaskSensitive] = useState(true);
  const [bundleImportReport, setBundleImportReport] = useState<BundleImportReport | null>(null);
  const [importKind, setImportKind] = useState<"csv" | "bundle">("csv");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [applyingImport, setApplyingImport] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryStatus, setLibraryStatus] = useState<"all" | RiskSkill["reviewStatus"]>("all");
  const [libraryCategory, setLibraryCategory] = useState("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const builderStageRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const analysisRequestIdRef = useRef(0);

  useEffect(() => {
    const host = window.location.hostname;
    const localHost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    const requested = new URLSearchParams(window.location.search).get("candidate-preview") === "v0.3";
    const timer = window.setTimeout(() => setCandidatePreviewEnabled(localHost && requested), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (activeView === "builder") builderStageRef.current?.focus({ preventScroll: true });
  }, [activeView, builderStep]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills")
      .then(async (response) => {
        if (!response.ok) throw new Error("storage unavailable");
        return (await response.json()) as { skills?: RiskSkill[]; severityRules?: SeverityRules };
      })
      .then((payload) => {
        if (cancelled) return;
        const loadedSkills = payload.skills ?? [];
        setSkills(loadedSkills);
        if (loadedSkills[0]) setActiveSkill(loadedSkills[0]);
        if (payload.severityRules) setSeverityRules(payload.severityRules);
        setStorageError("");
        setStorageLabel("스킬 저장소 연결됨");
      })
      .catch(() => {
        if (!cancelled) {
          setSkills([]);
          setStorageError("스킬 저장소에 연결하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
          setStorageLabel("스킬 저장소 연결 실패");
        }
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
  const reviewValidationErrors = useMemo(
    () => validateSkill({ ...activeSkill, reviewStatus: "reviewed" }),
    [activeSkill],
  );
  const categories = useMemo(
    () => [...new Set(skills.map((skill) => skill.category).filter(Boolean))].sort(),
    [skills],
  );
  const filteredSkills = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase("ko-KR");
    return skills.filter((skill) => {
      const matchesStatus = libraryStatus === "all" || skill.reviewStatus === libraryStatus;
      const matchesCategory = libraryCategory === "all" || skill.category === libraryCategory;
      const haystack = [
        skill.id,
        skill.category,
        skill.subcategory,
        skill.patternType,
        skill.surfaceMeaning,
        skill.riskDomain,
        ...skill.triggerPatterns,
        ...skill.contextPatterns,
        ...skill.anyOfPatterns,
      ]
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      return matchesStatus && matchesCategory && (!query || haystack.includes(query));
    });
  }, [libraryCategory, libraryQuery, libraryStatus, skills]);

  const reviewedSkills = useMemo(
    () => skills.filter((skill) => skill.reviewStatus === "reviewed"),
    [skills],
  );
  const analyzerSkills = useMemo(
    () => candidatePreviewEnabled
      ? [...reviewedSkills, ...activateDraftCandidatesForTest(candidateSkillsV03)]
      : reviewedSkills,
    [candidatePreviewEnabled, reviewedSkills],
  );
  const exportBundle = useMemo(
    () => buildExportBundle(skills, new Date(), severityRules),
    [severityRules, skills],
  );
  const reviewedCount = skills.filter(
    (skill) => skill.reviewStatus === "reviewed" && validateSkill(skill).length === 0,
  ).length;
  const currentBuilderStep = BUILDER_STEPS[builderStep - 1] ?? BUILDER_STEPS[0];
  const displayedBundlePreview = useMemo(() => {
    if (!bundleImportReport?.preview) return null;
    return previewSkillImport(
      skills,
      bundleImportReport.parsedSkills,
      confirmReplace ? "replace" : "merge",
      bundleImportReport.issues.length,
    );
  }, [bundleImportReport, confirmReplace, skills]);

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

  function goToBuilderStep(step: number) {
    setBuilderStep(Math.min(BUILDER_STEPS.length, Math.max(1, step)));
  }

  function beginNewSkill() {
    setCaseInput(EMPTY_CASE);
    setActiveSkill(makeBlankSkill());
    setAnalysisInput("");
    setAnalysisResult(null);
    setBetaAnalysis(null);
    setBetaAnalysisLoading(false);
    setAnalysisError("");
    setShowReviewErrors(false);
    setBuilderStep(1);
    setActiveView("builder");
    setNotice("새 초안을 열었습니다.");
  }

  function interpretCase() {
    if (!caseInput.text.trim() || !caseInput.description.trim() || !caseInput.domain.trim()) {
      setNotice("논란 문구, 관련 설명, 분야를 먼저 입력해 주세요.");
      return;
    }
    const draft = createMockSkillDraft(caseInput, skills);
    setActiveSkill(draft);
    setAnalysisInput(caseInput.text);
    setAnalysisResult(analyzeText(caseInput.text, [draft, ...skills], {
      includeDrafts: true,
      severityRules,
    }));
    setAnalysisError("");
    setBuilderStep(2);
    setNotice("Mock 해석이 완료되었습니다. 생성된 패턴을 확인해 주세요.");
  }

  async function runAnalysis(value = analysisInput, includeDrafts = true) {
    const text = value.trim();
    if (!text) {
      setAnalysisResult(null);
      setBetaAnalysis(null);
      setBetaAnalysisLoading(false);
      setAnalysisError("테스트할 광고 문구를 입력해 주세요.");
      return;
    }
    setAnalysisInput(text);
    setAnalysisError("");
    const localRules = analyzeText(
      text,
      includeDrafts ? testSkillSet : analyzerSkills,
      { includeDrafts, severityRules },
    );
    setAnalysisResult(localRules);
    if (includeDrafts) {
      setBetaAnalysis(null);
      setBetaAnalysisLoading(false);
      setBuilderStep(6);
      return;
    }

    setAnalyzerStep(2);
    setBetaAnalysis(null);
    setBetaAnalysisLoading(true);
    const requestId = analysisRequestIdRef.current + 1;
    analysisRequestIdRef.current = requestId;
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error("ai_assist_unavailable");
      const payload = await response.json() as BetaAnalysis;
      if (requestId !== analysisRequestIdRef.current) return;
      setAnalysisResult(payload.rules);
      setBetaAnalysis(payload);
    } catch {
      if (requestId !== analysisRequestIdRef.current) return;
      setBetaAnalysis({
        beta: "RiskShield v0.4 AI-assisted private beta",
        rules: localRules,
        ai: {
          state: "fallback",
          confidence: null,
          riskIntent: null,
          speechAct: null,
          contextRelation: null,
          claimStrength: null,
          evidenceSpans: [],
          masked: false,
          cached: false,
          latencyMs: 0,
          fallbackKind: "provider_error",
        },
        hybrid: {
          status: "review",
          score: Math.max(55, Math.min(69, localRules.finalScore || 55)),
          conflict: true,
          recoveredByInterpreter: false,
          suppressedHigh: localRules.status === "high",
          reason: "AI 분석 실패 시 규칙 결과를 유지하고 담당자 review로 전달합니다.",
        },
        notice: "AI 분석은 담당자의 최종 검토를 돕는 보조 신호이며 자동 승인·자동 금지를 의미하지 않습니다.",
        cachePolicy: { ttlSeconds: 900, storesOriginalText: false },
      });
    } finally {
      if (requestId === analysisRequestIdRef.current) setBetaAnalysisLoading(false);
    }
  }

  function changeView(nextView: ViewId) {
    setActiveView(nextView);
    if (nextView === "analyzer") {
      setAnalyzerStep(1);
      setAnalysisResult(null);
      setBetaAnalysis(null);
      setBetaAnalysisLoading(false);
      setAnalysisError("");
    }
  }

  async function saveSkill(status: RiskSkill["reviewStatus"]) {
    const nextSkill: RiskSkill = {
      ...activeSkill,
      reviewStatus: status,
      updatedAt: new Date().toISOString(),
    };
    const errors = validateSkill(nextSkill);
    if (status === "reviewed" && errors.length) {
      setShowReviewErrors(true);
      setNotice(errors[0]);
      return;
    }
    setShowReviewErrors(false);
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
      setNotice(
        status === "reviewed"
          ? "사람 검토가 완료되었습니다."
          : status === "rejected"
            ? "스킬을 반려 상태로 저장했습니다."
            : "초안을 저장했습니다.",
      );
    } catch {
      setNotice("저장하지 못했습니다. 화면의 편집 내용은 저장 완료 상태로 반영되지 않았습니다.");
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

  async function readBundleFiles(fileList?: FileList | null) {
    const selected = Array.from(fileList ?? []);
    if (!selected.length) return;

    const contents: Partial<BundleFiles> = {};
    const issues: string[] = [];
    const seen = new Set<string>();
    let riskFileReadFailed = false;

    for (const file of selected) {
      if (!BUNDLE_FILE_NAMES.includes(file.name as keyof BundleFiles)) {
        issues.push(`${file.name}: 지원하지 않는 파일명입니다.`);
        continue;
      }
      if (seen.has(file.name)) {
        issues.push(`${file.name}: 같은 이름의 파일이 두 번 선택되었습니다.`);
        if (file.name === "risk_skills.jsonl") riskFileReadFailed = true;
        continue;
      }
      seen.add(file.name);
      try {
        contents[file.name as keyof BundleFiles] = await file.text();
      } catch {
        issues.push(`${file.name}: 파일을 읽을 수 없습니다.`);
        if (file.name === "risk_skills.jsonl") riskFileReadFailed = true;
      }
    }

    const parsed = parseBundleFiles(contents);
    const riskIssues = parsed.issues.filter((issue) => issue.startsWith("risk_skills.jsonl"));
    const riskSkillsValid = Boolean(contents["risk_skills.jsonl"])
      && !riskFileReadFailed
      && riskIssues.length === 0
      && parsed.skills.length > 0;
    const allIssues = [...issues, ...parsed.issues];
    if (contents["risk_skills.jsonl"] && parsed.skills.length === 0 && riskIssues.length === 0) {
      allIssues.push("risk_skills.jsonl에 불러올 수 있는 스킬이 없습니다.");
    }

    setBundleImportReport({
      selectedNames: selected.map((file) => file.name),
      loadedNames: parsed.filesLoaded,
      skillCount: parsed.skills.length,
      issues: allIssues,
      applied: false,
      parsedSkills: parsed.skills,
      parsedSeverityRules: parsed.severityRules,
      preview: riskSkillsValid
        ? previewSkillImport(skills, parsed.skills, "merge", allIssues.length)
        : null,
    });
    setConfirmReplace(false);
    setNotice(riskSkillsValid ? "번들을 확인했습니다. 미리보기를 검토한 뒤 적용해 주세요." : "번들을 적용할 수 없습니다.");
    if (bundleInputRef.current) bundleInputRef.current.value = "";
  }

  async function stageCsvRows() {
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
    try {
      const response = await fetch("/api/skills", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "merge", skills: drafts, severityRules }),
      });
      const payload = (await response.json()) as { skills?: RiskSkill[]; error?: string };
      if (!response.ok || !payload.skills) throw new Error(payload.error || "저장 실패");
      setSkills(payload.skills);
      setNotice(drafts.length + "건을 D1 검토 큐에 저장했습니다.");
      setLibraryStatus("draft");
      setActiveView("library");
    } catch {
      setNotice("CSV 후보를 저장하지 못했습니다. 기존 저장 데이터는 변경되지 않았습니다.");
    }
  }

  async function applyBundle(mode: SkillImportMode) {
    if (!bundleImportReport?.preview || bundleImportReport.issues.length) return;
    if (mode === "replace" && !confirmReplace) {
      setNotice("전체 교체 확인란을 먼저 선택해 주세요.");
      return;
    }
    setApplyingImport(true);
    try {
      const response = await fetch("/api/skills", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          confirmReplace: mode === "replace" ? confirmReplace : undefined,
          skills: bundleImportReport.parsedSkills,
          severityRules: bundleImportReport.parsedSeverityRules,
        }),
      });
      const payload = (await response.json()) as {
        skills?: RiskSkill[];
        severityRules?: SeverityRules;
        error?: string;
      };
      if (!response.ok || !payload.skills) throw new Error(payload.error || "가져오기 실패");
      setSkills(payload.skills);
      setSeverityRules(payload.severityRules ?? bundleImportReport.parsedSeverityRules);
      if (payload.skills[0]) setActiveSkill(payload.skills[0]);
      setBundleImportReport((current) => current ? { ...current, applied: true } : current);
      setStorageLabel("스킬 저장소 연결됨");
      setNotice(mode === "replace" ? "전체 교체를 D1에 저장했습니다." : "병합 결과를 D1에 저장했습니다.");
    } catch {
      setNotice("번들을 저장하지 못했습니다. 기존 저장 데이터는 변경되지 않았습니다.");
    } finally {
      setApplyingImport(false);
    }
  }

  function openSkill(skill: RiskSkill) {
    setActiveSkill(skill);
    setShowReviewErrors(false);
    setAnalysisInput(skill.surfaceMeaning);
    setAnalysisResult(null);
    setAnalysisError("");
    setCaseInput({
      text: skill.surfaceMeaning,
      description: skill.source.title,
      domain: skill.riskDomain,
      occurredAt: skill.source.date,
      sourceUrl: skill.source.url,
      memo: skill.notes,
    });
    setBuilderStep(5);
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
      <a className="skipLink" href="#main-content">본문으로 건너뛰기</a>
      <header className="appHeader">
        <div className="appHeaderInner">
          <button type="button" className="appBrand" onClick={() => changeView("builder")} aria-label="RiskShield Studio 홈">
            <span className="appBrandMark" aria-hidden="true">R</span>
            <strong>RiskShield Studio</strong>
          </button>

          <nav className="appNav" aria-label="RiskShield Studio 작업 메뉴">
            {NAV_ITEMS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={cx("navItem", "appNavItem", activeView === item.id && "navItemActive", activeView === item.id && "appNavItemActive")}
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={() => changeView(item.id)}
                data-view={item.id}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <label className="mobileNavSelect">
            <span>화면 선택</span>
            <select
              value={activeView}
              onChange={(event) => changeView(event.target.value as ViewId)}
              aria-label="RiskShield Studio 화면 선택"
            >
              {NAV_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>

          <div className="appHeaderActions">
            <span className="visuallyHidden" aria-live="polite">{storageLabel}</span>
            {(activeView === "builder" || activeView === "library") && (
              <button type="button" className="primaryButton compactButton" onClick={beginNewSkill} data-testid="builder-new-button">
                {activeView === "library" ? "새 스킬 만들기" : "새 스킬"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="mainArea appleMain" tabIndex={-1}>
        {storageError && <p className="storageErrorBanner" role="alert">{storageError}</p>}
        {activeView === "builder" && (
          <div className="builderLayout appleBuilder wizardBuilder">
            <section className="builderMain" aria-labelledby="builder-title">
              <section className="simpleWizardHeader">
                <div className="simpleWizardMeta">
                  <span>{builderStep} / {BUILDER_STEPS.length}</span>
                  <span>{reviewStatusLabel(activeSkill.reviewStatus)}</span>
                </div>
                <h1 id="builder-title">{currentBuilderStep.title}</h1>
                <p>{currentBuilderStep.description}</p>
                <div
                  className="simpleProgressTrack"
                  role="progressbar"
                  aria-label="스킬 제작 진행률"
                  aria-valuemin={1}
                  aria-valuemax={BUILDER_STEPS.length}
                  aria-valuenow={builderStep}
                >
                  <span style={{ width: `${(builderStep / BUILDER_STEPS.length) * 100}%` }} />
                </div>
              </section>

              <div
                className="wizardStageHost"
                ref={builderStageRef}
                tabIndex={-1}
                aria-label={`${builderStep}/${BUILDER_STEPS.length}단계 ${currentBuilderStep.title}`}
              >
              <section
                className="workspaceCard inputCard productTileParchment featureSection wizardStage"
                aria-labelledby="case-input-title"
                hidden={builderStep !== 1}
              >
                <h2 id="case-input-title" className="visuallyHidden">자료 입력</h2>
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
                    required
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
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="case-domain">분야 *</label>
                    <select id="case-domain" value={caseInput.domain} onChange={(event) => patchCase("domain", event.target.value)} required>
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
                  <details className="optionalDetails fieldWide">
                    <summary>선택 정보 추가 <span>발생 시기 · 출처 · 메모</span></summary>
                    <div className="fieldGrid">
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
                  <div className="field fieldWide">
                    <label htmlFor="case-memo">관리자 메모</label>
                    <textarea
                      id="case-memo"
                      rows={3}
                      value={caseInput.memo}
                      onChange={(event) => patchCase("memo", event.target.value)}
                      placeholder="후속 확인 사항이나 내부 검토 메모를 적어 주세요."
                    />
                  </div>
                    </div>
                  </details>
                </div>
                <div className="cardFooter">
                  <p>Mock은 규칙 기반 시연 결과를 생성합니다. 실제 AI 분석이 아닙니다.</p>
                  <button
                    type="button"
                    className="primaryButton"
                    onClick={interpretCase}
                    data-testid="builder-interpret-button"
                  >
                    해석하고 다음
                  </button>
                </div>
              </section>

              <section
                className="workspaceCard reviewCard featureSection wizardStage"
                aria-labelledby="review-title"
                hidden={builderStep < 2 || builderStep > 5}
              >
                <h2 id="review-title" className="visuallyHidden">{currentBuilderStep.title}</h2>
                {builderStep === 5 && (
                  <p className={cx("simpleCompletion", validationErrors.length === 0 && "simpleCompletionReady")}>
                    {validationErrors.length === 0 ? "필수 내용 확인 완료" : `확인할 내용 ${validationErrors.length}개`}
                  </p>
                )}
                {builderStep === 5 && (
                  <>
                    <p className="simpleReviewNote">최종 반영 전, 판단 근거와 출처를 사람이 확인합니다.</p>
                    {showReviewErrors && reviewValidationErrors.length > 0 && (
                      <div className="validationSummary" role="alert" aria-live="assertive">
                        <strong>검토 완료 전에 다음 항목을 확인해 주세요.</strong>
                        <ul>
                          {reviewValidationErrors.map((error) => <li key={error}>{error}</li>)}
                        </ul>
                      </div>
                    )}
                  </>
                )}

                <div className="simpleSettingsStage" hidden={builderStep !== 3}>
                  <div className="fieldGrid">
                    <div className="field">
                      <label htmlFor="skill-category">카테고리</label>
                      <input id="skill-category" value={activeSkill.category} onChange={(event) => patchSkill({ category: event.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor="skill-domain">적용 분야</label>
                      <input id="skill-domain" value={activeSkill.riskDomain} onChange={(event) => patchSkill({ riskDomain: event.target.value })} />
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

                  <div className="dominantControl simpleDominantControl">
                    <div>
                      <strong>심각한 위험은 최소 점수 보장</strong>
                      <p>다른 항목 점수가 낮아도 이 위험의 최소 점수를 유지합니다.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeSkill.dominantRisk}
                      aria-label="심각한 위험의 최소 점수 보장"
                      className={cx("switchControl", activeSkill.dominantRisk && "switchControlOn")}
                      onClick={() => patchSkill({ dominantRisk: !activeSkill.dominantRisk })}
                    >
                      <span />
                    </button>
                  </div>

                  <details className="optionalDetails advancedDetails">
                    <summary>고급 설정 <span>ID · 적용 범위 · 거리</span></summary>
                    <div className="fieldGrid">
                      <div className="field fieldWide">
                        <label htmlFor="skill-id">스킬 ID</label>
                        <input id="skill-id" value={activeSkill.id} onChange={(event) => patchSkill({ id: event.target.value })} />
                      </div>
                      <div className="field">
                        <label htmlFor="skill-schema">스키마 버전</label>
                        <input id="skill-schema" value={activeSkill.schemaVersion} disabled />
                      </div>
                      <div className="field">
                        <label htmlFor="skill-revision">리비전</label>
                        <input id="skill-revision" type="number" min={1} step={1} value={activeSkill.revision} onChange={(event) => patchSkill({ revision: Number(event.target.value) })} />
                      </div>
                      <div className="field">
                        <label htmlFor="skill-subcategory">세부 유형</label>
                        <input id="skill-subcategory" value={activeSkill.subcategory} onChange={(event) => patchSkill({ subcategory: event.target.value })} />
                      </div>
                      <div className="field">
                        <label htmlFor="skill-pattern">조합 패턴</label>
                        <input id="skill-pattern" value={activeSkill.patternType} onChange={(event) => patchSkill({ patternType: event.target.value })} />
                      </div>
                      <div className="field">
                        <label htmlFor="skill-scope">적용 범위</label>
                        <select id="skill-scope" value={activeSkill.conditionScope} onChange={(event) => patchSkill({ conditionScope: event.target.value as RiskSkill["conditionScope"] })}>
                          <option value="sentence">같은 문장</option>
                          <option value="paragraph">같은 문단</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="skill-distance">최대 거리</label>
                        <div className="numberField">
                          <input id="skill-distance" type="number" min={0} max={2000} step={1} value={activeSkill.maxDistance} onChange={(event) => patchSkill({ maxDistance: Number(event.target.value) })} />
                          <span>자</span>
                        </div>
                      </div>
                    </div>
                  </details>
                </div>

                <div className="fieldGrid narrativeGrid" hidden={builderStep !== 2}>
                  <div className="field">
                    <label htmlFor="skill-surface">표면 의미</label>
                    <textarea id="skill-surface" rows={3} value={activeSkill.surfaceMeaning} onChange={(event) => patchSkill({ surfaceMeaning: event.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="skill-summary">위험 요약</label>
                    <textarea id="skill-summary" rows={3} value={activeSkill.riskSummary} onChange={(event) => patchSkill({ riskSummary: event.target.value })} />
                  </div>
                </div>

                <div className="patternStage" hidden={builderStep !== 4}>
                <div className="editorPair">
                  <ChipEditor
                    label="필수 위험 표현"
                    values={activeSkill.triggerPatterns}
                    onChange={(values) => patchSkill({ triggerPatterns: values })}
                    tone="risk"
                  />
                  <div className="pairPlus" aria-hidden="true">AND</div>
                  <ChipEditor
                    label="필수 맥락 표현"
                    values={activeSkill.contextPatterns}
                    onChange={(values) => patchSkill({ contextPatterns: values })}
                    tone="brand"
                  />
                </div>

                <details className="optionalDetails advancedDetails patternOptions">
                  <summary>추가 조건 <span>선택 · 제외 · 최근 맥락</span></summary>
                  <div className="patternAdvancedContent">
                <div className="conditionEditorGrid">
                  <ChipEditor
                    label="선택 표현"
                    values={activeSkill.anyOfPatterns}
                    onChange={(values) => patchSkill({ anyOfPatterns: values })}
                    tone="neutral"
                  />
                  <ChipEditor
                    label="제외 표현"
                    values={activeSkill.exclusionPatterns ?? []}
                    onChange={(values) => patchSkill({ exclusionPatterns: values })}
                    tone="neutral"
                  />
                </div>

                <ChipEditor
                  label="최근 맥락 태그"
                  values={activeSkill.recentContextTags}
                  onChange={(values) => patchSkill({ recentContextTags: values })}
                  tone="neutral"
                />
                  </div>
                </details>
                </div>

                {builderStep >= 2 && builderStep <= 4 && (
                  <div className="wizardActions">
                    <button type="button" className="secondaryButton" onClick={() => goToBuilderStep(builderStep - 1)} aria-label={`이전: ${BUILDER_STEPS[builderStep - 2].title}`}>
                      이전
                    </button>
                    <button type="button" className="primaryButton" onClick={() => goToBuilderStep(builderStep + 1)} aria-label={`다음: ${BUILDER_STEPS[builderStep].title}`}>
                      다음
                    </button>
                  </div>
                )}

                <div className="humanReviewStage" hidden={builderStep !== 5}>
                  <div className="field">
                    <label htmlFor="skill-reason">판단 근거</label>
                    <textarea id="skill-reason" rows={3} value={activeSkill.riskReason} onChange={(event) => patchSkill({ riskReason: event.target.value })} />
                  </div>
                  <div className="fieldGrid">
                    <div className="field">
                      <label htmlFor="skill-fp">오탐 가능성</label>
                      <textarea id="skill-fp" rows={3} value={activeSkill.falsePositiveNote} onChange={(event) => patchSkill({ falsePositiveNote: event.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor="skill-rewrite">안전한 대체 문구</label>
                      <textarea id="skill-rewrite" rows={3} value={activeSkill.safeRewrite.join("\n")} onChange={(event) => patchSkill({ safeRewrite: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} />
                    </div>
                  </div>

                  <section className="sourceEditor simpleSourceEditor" aria-labelledby="source-editor-title">
                    <h3 id="source-editor-title">출처 확인</h3>
                    <div className="fieldGrid">
                      <div className="field fieldWide">
                        <label htmlFor="skill-source-title">출처 제목</label>
                        <input id="skill-source-title" value={activeSkill.source.title} onChange={(event) => patchSkill({ source: { ...activeSkill.source, title: event.target.value } })} />
                      </div>
                      <div className="field">
                        <label htmlFor="skill-source-status">검증 상태</label>
                        <select
                          id="skill-source-status"
                          value={activeSkill.source.provenanceStatus ?? "synthetic_unverified"}
                          onChange={(event) => patchSkill({ source: { ...activeSkill.source, provenanceStatus: event.target.value as RiskSkill["source"]["provenanceStatus"] } })}
                        >
                          <option value="synthetic_unverified">Mock · 미검증</option>
                          <option value="provided">제공 자료</option>
                          <option value="verified">담당자 검증 완료</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  <details className="optionalDetails advancedDetails">
                    <summary>추가 검토 정보 <span>사회 맥락 · 메모 · 출처 세부정보</span></summary>
                    <div className="fieldGrid">
                      <div className="field">
                        <label htmlFor="skill-social">사회적 맥락</label>
                        <textarea id="skill-social" rows={3} value={activeSkill.socialContext} onChange={(event) => patchSkill({ socialContext: event.target.value })} />
                      </div>
                      <div className="field">
                        <label htmlFor="skill-ethic">법률·윤리 쟁점</label>
                        <textarea id="skill-ethic" rows={3} value={activeSkill.legalOrEthicIssue} onChange={(event) => patchSkill({ legalOrEthicIssue: event.target.value })} />
                      </div>
                      <div className="field fieldWide">
                        <label htmlFor="skill-notes">관리자 메모</label>
                        <textarea id="skill-notes" rows={3} value={activeSkill.notes} onChange={(event) => patchSkill({ notes: event.target.value })} />
                      </div>
                      <div className="field">
                        <label htmlFor="skill-source-date">출처 날짜</label>
                        <input id="skill-source-date" type="date" value={activeSkill.source.date} onChange={(event) => patchSkill({ source: { ...activeSkill.source, date: event.target.value } })} />
                      </div>
                      <div className="field">
                        <label htmlFor="skill-source-id">Source ID</label>
                        <input id="skill-source-id" value={activeSkill.source.sourceId ?? ""} onChange={(event) => patchSkill({ source: { ...activeSkill.source, sourceId: event.target.value } })} />
                      </div>
                      <div className="field fieldWide">
                        <label htmlFor="skill-source-url">출처 URL</label>
                        <input id="skill-source-url" type="url" value={activeSkill.source.url} onChange={(event) => patchSkill({ source: { ...activeSkill.source, url: event.target.value } })} placeholder="https://" />
                      </div>
                    </div>
                  </details>

                  <div className="simpleSaveRow">
                    <span>{saving ? "저장하는 중…" : "마지막 수정 " + formatTime(activeSkill.updatedAt)}</span>
                    <button type="button" className="secondaryButton" onClick={() => saveSkill("reviewed")} disabled={saving} data-testid="builder-review-button">
                      검토 완료로 저장
                    </button>
                    <details className="saveOptions">
                      <summary>다른 저장 방식</summary>
                      <div>
                        <button type="button" className="textButton" onClick={() => saveSkill("draft")} disabled={saving} data-testid="builder-save-button">초안 저장</button>
                        <button type="button" className="textButton dangerTextButton" onClick={() => saveSkill("rejected")} disabled={saving}>반려로 저장</button>
                      </div>
                    </details>
                  </div>

                  <div className="wizardActions">
                    <button type="button" className="secondaryButton" onClick={() => goToBuilderStep(4)}>이전</button>
                    <button type="button" className="primaryButton" onClick={() => runAnalysis(analysisInput, true)}>다음</button>
                  </div>
                </div>
              </section>
              {builderStep === 6 && (
                <section className="inspector productTileLight analyzerPreviewTile wizardAnalyzerStage" aria-label="스킬 검증 패널">
                  <div className="inspectorTabs">
                    <strong>Analyzer 검증</strong>
                    <span>현재 초안 포함</span>
                  </div>
                  <div className="inspectorInput">
                    <label htmlFor="inspector-analysis-input">테스트할 광고 문구</label>
                    <div>
                      <input
                        id="inspector-analysis-input"
                        value={analysisInput}
                        onChange={(event) => {
                          setAnalysisInput(event.target.value);
                          if (event.target.value.trim()) setAnalysisError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") runAnalysis(analysisInput, true);
                        }}
                      />
                      <button type="button" onClick={() => runAnalysis(analysisInput, true)} aria-label="현재 문구 분석" data-testid="analyzer-run-button">분석</button>
                    </div>
                    {analysisError && <p className="formError" role="alert">{analysisError}</p>}
                  </div>
                  {analysisResult ? (
                    <AnalysisPanel result={analysisResult} title="실시간 검증" />
                  ) : (
                    <div className="analysisEmptyState">
                      <strong>{analysisError || "분석할 문구를 입력해 주세요."}</strong>
                      <p>현재 초안은 이 검증 화면에서만 포함되며 반려 스킬은 제외됩니다.</p>
                    </div>
                  )}
                  <div className="wizardActions analyzerStageActions">
                    <button type="button" className="secondaryButton" onClick={() => goToBuilderStep(5)}>
                      이전
                    </button>
                    <button type="button" className="primaryButton" onClick={() => changeView("library")} aria-label="완료하고 스킬 라이브러리 보기">
                      완료
                    </button>
                  </div>
                </section>
              )}
              </div>
            </section>
          </div>
        )}

        {activeView === "import" && (
          <section className="pageView appleView" aria-labelledby="import-title">
            <section className="pageHeading editorialHero productTileLight">
              <div>
                <span className="editorialEyebrow">DATA INTAKE</span>
                <h1 id="import-title">데이터 가져오기</h1>
                <p>CSV 후보 자료와 기존 RiskShield 번들을 분리해 불러오고, 검증된 스킬만 작업 공간에 반영합니다.</p>
                <div className="breadcrumb"><span>가져오기</span><b>/</b><span>CSV · Skill Bundle</span></div>
              </div>
              <span className="safetyBadge">민감 원문 보호</span>
            </section>

            <div className="importModeSwitch" role="group" aria-label="가져올 데이터 종류">
              <button
                type="button"
                className={cx("secondaryButton", importKind === "csv" && "importModeActive")}
                aria-pressed={importKind === "csv"}
                onClick={() => setImportKind("csv")}
              >
                CSV 후보
              </button>
              <button
                type="button"
                className={cx("secondaryButton", importKind === "bundle" && "importModeActive")}
                aria-pressed={importKind === "bundle"}
                onClick={() => setImportKind("bundle")}
              >
                스킬 번들
              </button>
            </div>

            {importKind === "csv" && <div className="importGrid featureSection">
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
            </div>}

            {importKind === "bundle" && <section className="workspaceCard bundleImportCard featureSection" aria-labelledby="bundle-import-title">
              <div className="cardHeading">
                <div>
                  <span className="sectionNumber">SKILL BUNDLE</span>
                  <h2 id="bundle-import-title">기존 스킬 번들 불러오기</h2>
                </div>
                <span className="requiredNote">risk_skills.jsonl 필수</span>
              </div>
              <p className="bundleHelp">
                레거시 sample JSONL도 스키마 v2로 변환합니다. 원문 내용은 이 화면에 미리보기로 노출하지 않습니다.
              </p>
              <input
                ref={bundleInputRef}
                type="file"
                multiple
                accept=".json,.jsonl,application/json,application/x-ndjson"
                onChange={(event) => void readBundleFiles(event.target.files)}
                className="visuallyHidden"
                data-testid="bundle-file-input"
              />
              <div className="bundlePickerRow">
                <div className="bundleExpectedFiles" aria-label="지원하는 번들 파일">
                  {BUNDLE_FILE_NAMES.map((name) => <code key={name}>{name}</code>)}
                </div>
                <button type="button" className="secondaryButton" onClick={() => bundleInputRef.current?.click()}>
                  번들 파일 선택
                </button>
              </div>
              {bundleImportReport && (
                <div
                  className={cx(
                    "bundleReport",
                    bundleImportReport.applied && "bundleReportSuccess",
                    !bundleImportReport.applied && bundleImportReport.issues.length > 0 && "bundleReportError",
                    !bundleImportReport.applied && bundleImportReport.issues.length === 0 && "bundleReportWarning",
                  )}
                  role="status"
                  aria-live="polite"
                >
                  <strong>
                    {bundleImportReport.applied
                      ? `${displayedBundlePreview?.finalCount ?? bundleImportReport.skillCount}개 스킬을 D1에 저장했습니다.`
                      : bundleImportReport.issues.length
                        ? "수정이 필요한 번들입니다."
                        : "2단계 · 적용 전 미리보기"}
                  </strong>
                  <dl>
                    <div><dt>선택 파일</dt><dd>{bundleImportReport.selectedNames.join(", ") || "없음"}</dd></div>
                    <div><dt>인식 파일</dt><dd>{bundleImportReport.loadedNames.join(", ") || "없음"}</dd></div>
                    <div><dt>유효 스킬</dt><dd>{bundleImportReport.skillCount.toLocaleString("ko-KR")}개</dd></div>
                    {displayedBundlePreview && <>
                      <div><dt>적용 방식</dt><dd>{displayedBundlePreview.mode === "replace" ? "전체 교체" : "병합"}</dd></div>
                      <div><dt>신규</dt><dd>{displayedBundlePreview.newCount}개</dd></div>
                      <div><dt>업데이트</dt><dd>{displayedBundlePreview.updateCount}개</dd></div>
                      <div><dt>동일</dt><dd>{displayedBundlePreview.sameCount}개</dd></div>
                      <div><dt>충돌</dt><dd>{displayedBundlePreview.conflictCount}개</dd></div>
                      <div><dt>건너뜀</dt><dd>{displayedBundlePreview.skippedCount}개</dd></div>
                      <div><dt>오류</dt><dd>{displayedBundlePreview.errorCount}개</dd></div>
                      <div><dt>적용 후</dt><dd>{displayedBundlePreview.finalCount}개</dd></div>
                    </>}
                  </dl>
                  {bundleImportReport.issues.length > 0 ? (
                    <ul className="bundleIssueList">
                      {bundleImportReport.issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}
                    </ul>
                  ) : (
                    <>
                      <p className="bundleNoIssues">구조 검사에서 문제가 발견되지 않았습니다.</p>
                      {!bundleImportReport.applied && displayedBundlePreview && (
                        <div className="bundleApplyActions">
                          <button type="button" className="primaryButton" disabled={applyingImport} onClick={() => void applyBundle("merge")}>
                            {applyingImport ? "저장 중…" : "병합하여 저장"}
                          </button>
                          <label className="replaceConfirm">
                            <input type="checkbox" checked={confirmReplace} onChange={(event) => setConfirmReplace(event.target.checked)} />
                            기존 스킬 전체 교체를 이해했습니다
                          </label>
                          <button type="button" className="dangerButton" disabled={applyingImport || !confirmReplace} onClick={() => void applyBundle("replace")}>
                            전체 교체
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>}

            {importKind === "csv" && (csvSummary ? (
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
                  <button type="button" className="primaryButton" onClick={() => void stageCsvRows()} data-testid="csv-stage-button">
                    검토 큐에 추가
                  </button>
                </div>
              </section>
            ) : (
              <div className="emptyStateLine">
                <span>1</span><p><b>파일 선택</b> → 열 연결 → 데이터 점검 → 검토 큐 추가</p>
              </div>
            ))}
          </section>
        )}

        {activeView === "library" && (
          <section className="pageView appleView" aria-labelledby="library-title">
            <section className="pageHeading editorialHero productTileParchment">
              <div>
                <span className="editorialEyebrow">SKILL LIBRARY</span>
                <h1 id="library-title">스킬 라이브러리</h1>
                <p>조합 패턴, 출처, 검토 상태를 하나의 라이브러리에서 확인하고 Analyzer에 반영할 스킬을 선택합니다.</p>
                <div className="breadcrumb"><span>라이브러리</span><b>/</b><span>{skills.length} skills</span></div>
              </div>
            </section>
            <div className="librarySummary utilityGrid">
              <div><span>전체 스킬</span><strong>{skills.length}</strong></div>
              <div><span>검토 완료</span><strong>{skills.filter((skill) => skill.reviewStatus === "reviewed").length}</strong></div>
              <div><span>검토 대기</span><strong>{skills.filter((skill) => skill.reviewStatus === "draft").length}</strong></div>
              <div><span>반려</span><strong>{skills.filter((skill) => skill.reviewStatus === "rejected").length}</strong></div>
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
                    <option value="rejected">반려</option>
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
                    <caption className="visuallyHidden">RiskShield 스킬 목록</caption>
                    <thead>
                      <tr>
                        <th scope="col">상태</th>
                        <th scope="col">스킬 / 조합 패턴</th>
                        <th scope="col">카테고리</th>
                        <th scope="col">최소 점수</th>
                        <th scope="col">Dominant</th>
                        <th scope="col">신뢰도</th>
                        <th scope="col"><span className="visuallyHidden">작업</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSkills.map((skill) => (
                        <tr key={skill.id}>
                          <td>
                            <span className={cx(
                              "tableStatus",
                              skill.reviewStatus === "reviewed" && "tableStatusReviewed",
                              skill.reviewStatus === "rejected" && "tableStatusRejected",
                            )}>
                              {reviewStatusLabel(skill.reviewStatus)}
                            </span>
                          </td>
                          <td><strong title={skill.id}>{skill.id}</strong><code title={skill.patternType}>{skill.patternType}</code></td>
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
            <section className="pageHeading editorialHero">
              <div>
                <span className="editorialEyebrow">ANALYZER V4</span>
                <h1 id="analyzer-title">{analyzerStep === 1 ? "광고 문구 입력" : "분석 결과 검토"}</h1>
                <p>{analyzerStep === 1
                  ? "검토할 문구를 먼저 입력하세요. 결과와 근거는 다음 화면에서 확인합니다."
                  : "가장 지배적인 위험과 근거를 확인한 뒤 사람이 최종 판단합니다."}</p>
                <div className="breadcrumb"><span>Analyzer v4</span><b>/</b><span>{analyzerStep} / 2</span></div>
              </div>
              <span className={cx("engineBadge", candidatePreviewEnabled && "engineBadgeCandidate")}>
                <i />
                {candidatePreviewEnabled
                  ? `로컬 후보 검증 ${analyzerSkills.length}개`
                  : `검토 완료 ${reviewedSkills.length}개만 로드`}
              </span>
            </section>
            {analyzerStep === 1 ? (
              <div className="analyzerStage analyzerInputStage productTileLight featureSection">
                <section className="workspaceCard analyzerInputCard storeUtilityCard">
                  <span className="sectionNumber">STEP 1 · TEST COPY</span>
                  <h2>검토할 광고 문구</h2>
                  <p>{candidatePreviewEnabled
                    ? "운영 D1을 변경하지 않는 로컬 후보 검증 모드입니다. draft 후보를 메모리에서만 가상 reviewed로 실행합니다."
                    : "검토 완료된 스킬과 현재 점수 정책만 사용합니다. 초안과 반려 스킬은 분석에서 제외됩니다."}</p>
                  <label htmlFor="full-analysis-input">광고 문구</label>
                  <textarea
                    id="full-analysis-input"
                    rows={7}
                    value={analysisInput}
                    onChange={(event) => {
                      setAnalysisInput(event.target.value);
                      if (event.target.value.trim()) setAnalysisError("");
                    }}
                    placeholder="광고 문구를 입력해 주세요."
                    data-testid="analyzer-input"
                  />
                  <div className="quickTests" aria-label="빠른 테스트 예시">
                    {QUICK_TESTS.map((value) => (
                      <button type="button" key={value} onClick={() => setAnalysisInput(value)}>{value}</button>
                    ))}
                  </div>
                  {analysisError && <p className="formError" role="alert">{analysisError}</p>}
                  <button type="button" className="primaryButton wideButton" onClick={() => void runAnalysis(analysisInput, false)} data-testid="analyzer-submit-button">
                    결과 화면으로
                  </button>
                </section>
              </div>
            ) : analysisResult ? (
              <div className="analyzerStage analyzerResultStage featureSection">
                <div className="analyzerStageActions">
                  <button type="button" className="secondaryButton" onClick={() => setAnalyzerStep(1)} data-testid="analyzer-back-button">
                    다른 문구 분석
                  </button>
                </div>
                <AnalysisPanel result={analysisResult} title="규칙 분석 결과" scoreLabel="규칙 리스크" />
                <AiAssistPanel result={betaAnalysis} loading={betaAnalysisLoading} />
                <section className="workspaceCard categoryCard productTileParchment">
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
                    )) : <p className="mutedText">표시할 카테고리 점수가 없습니다.</p>}
                  </div>
                </section>
              </div>
            ) : null}
          </section>
        )}

        {activeView === "export" && (
          <section className="pageView appleView" aria-labelledby="export-title">
            <section className="pageHeading editorialHero productTileLight">
              <div>
                <span className="editorialEyebrow">DELIVERY</span>
                <h1 id="export-title">Analyzer 파일 내보내기</h1>
                <p>사람의 검토를 마친 스킬만 일관된 JSONL·JSON 파일로 만들고, 출처와 상태를 함께 보존합니다.</p>
                <div className="breadcrumb"><span>Delivery</span><b>/</b><span>Analyzer files</span></div>
              </div>
              <span className={cx("completionBadge", reviewedCount > 0 && "completionBadgeComplete")}>
                {reviewedCount > 0 ? "5개 파일 준비" : "검토 완료 스킬 필요"}
              </span>
            </section>
            <div className="workspaceCard exportHero featureSection">
              <div>
                <span className="sectionNumber">{reviewedCount > 0 ? "PREFLIGHT COMPLETE" : "ACTION REQUIRED"}</span>
                <h2>{reviewedCount > 0 ? `${reviewedCount}개 검토 완료 스킬이 준비되었습니다.` : "내보낼 검토 완료 스킬이 없습니다."}</h2>
                <p>{reviewedCount > 0 ? "초안, 반려, 필수 항목이 누락된 스킬은 자동으로 제외됩니다." : "스킬을 사람 검토 완료 상태로 저장한 뒤 다시 확인해 주세요."}</p>
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
                    <span className={reviewedCount > 0 ? "mappingOk" : "mappingPending"}>
                      {reviewedCount > 0 ? "스키마 통과" : "대기 중"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondaryButton"
                    onClick={() => downloadFile(file.name, file.content, file.type)}
                    aria-label={file.name + " 다운로드"}
                    disabled={reviewedCount === 0}
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

      <footer className="siteFooter compactFooter">
        <div className="siteFooterInner">
          <div className="footerLegal">
            <span><strong>RiskShield Studio</strong> · Human in the loop · 판단을 자동화하지 않고 담당자의 최종 검토를 돕습니다.</span>
          </div>
        </div>
      </footer>

      <div className={cx("toast", notice && "toastVisible")} role="status" aria-live="polite">
        {notice}
      </div>
    </div>
  );
}
