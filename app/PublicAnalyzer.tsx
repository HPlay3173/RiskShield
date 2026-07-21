"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { PRODUCT_VERSION, SITES_VERSION, SOURCE_COMMIT } from "../lib/release";

const MAX_INPUT_CHARS = 2_000;
const EXAMPLES = [
  "여자는 원래 다 운전을 못해.",
  "너 같은 멍청이는 그냥 꺼져.",
  "‘여자는 원래 다 문제다’라는 표현은 성차별이므로 사용하지 마세요.",
  "원금 손실 없이 매달 20% 수익을 보장합니다.",
];

type Status = "no_match" | "review" | "attention" | "high";
type ProfileId = "balanced" | "advertising" | "context";
const PROFILES: Array<{ id: ProfileId; label: string; description: string }> = [
  { id: "balanced", label: "균형 분석", description: "전체 위험 범주를 고르게 보여줍니다." },
  { id: "advertising", label: "광고·주장", description: "과장·보장·기만 신호를 먼저 봅니다." },
  { id: "context", label: "문맥 우선", description: "인용·비판·경고 여부를 먼저 봅니다." },
];
type PublicAnalysis = {
  release: {
    productVersion: string;
    sitesVersion: number;
    sourceCommit: string;
    interpreterSchema: string;
    interpreterPrompt: string;
    scoringPolicy: string;
  };
  profile: { focus: string; emphasis: "balanced" | "claims" | "context" };
  rules: {
    finalScore: number;
    status: Status;
    statusLabel: string;
    recommendation: string;
    reason: string | null;
    suggestedRewrite: string | null;
    categoryScores: Array<{ category: string; score: number }>;
    evidence: Array<{ start: number; end: number; text: string; role: string }>;
  };
  scoring: {
    policyVersion: string;
    finalScore: number;
    status: Status;
    confidence: number | null;
    highRequiresReview: boolean;
    experimental: boolean;
    primaryCategory: { id: string; label: string; score: number; ruleScore: number; aiScore: number; source: "rule" | "ai" | "hybrid" } | null;
    categoryScores: Array<{ id: string; label: string; score: number; ruleScore: number; aiScore: number; source: "rule" | "ai" | "hybrid" }>;
  };
  ai: {
    state: "ready" | "fallback";
    reasonCode: string | null;
    reasonLabel: string | null;
    confidence: number | null;
    speechAct: string | null;
    contextRelation: string | null;
    riskFamily: string | null;
    evidenceSpans: Array<{ start: number; end: number; text: string }>;
  };
  hybrid: { status: Status; score: number | null; conflict: boolean; reason: string };
  uncertainty: { level: "low" | "medium" | "high"; reason: string };
  novelty: { state: "known_pattern" | "possible_new_expression" | "insufficient_evidence"; label: string; reason: string; candidateRegistration: "disabled" | "available" };
  feedback: { missedDetectionAvailable: boolean; falsePositiveAvailable: boolean };
  notice: string;
};

type EvidenceItem = { start: number; end: number; text: string; sources: string[] };

function mergeEvidence(result: PublicAnalysis): EvidenceItem[] {
  const merged = new Map<string, EvidenceItem>();
  const add = (item: { start: number; end: number; text: string }, source: string) => {
    const key = `${item.start}:${item.end}:${item.text.normalize("NFKC")}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    merged.set(key, { ...item, sources: [source] });
  };
  result.rules.evidence.forEach((item) => add(item, "검토된 규칙"));
  result.ai.evidenceSpans.forEach((item) => add(item, "AI 문맥"));
  return [...merged.values()].sort((left, right) => left.start - right.start || left.end - right.end);
}

const statusLabels: Record<Status, string> = {
  no_match: "직접 위험 미확인",
  review: "사람 검토 필요",
  attention: "주의 필요",
  high: "높은 위험",
};

const contextLabels: Record<string, string> = {
  claim: "직접 주장", quote: "인용", criticism: "비판", warning: "경고", report: "보도·설명", definition: "정의", condition: "조건부 표현",
  supports: "위험 의미를 뒷받침", negates: "위험 의미를 부정", warns_about: "위험을 경고", reports: "사례를 전달", defines: "의미를 설명", conditions: "조건을 명시",
};

export function PublicAnalyzer() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<PublicAnalysis | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileId>("balanced");
  const [candidateState, setCandidateState] = useState<"idle" | "submitting" | "submitted" | "failed">("idle");
  const [lastText, setLastText] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const evidence = result ? mergeEvidence(result) : [];

  useEffect(() => { if (result) resultHeadingRef.current?.focus(); }, [result]);

  async function analyze(value: string) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true); setError(""); setCandidateState("idle"); setLastText(value);
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: value, profile }), cache: "no-store", signal: controller.signal });
      const payload = await response.json() as PublicAnalysis & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "분석을 완료하지 못했습니다.");
      setResult(payload);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "분석을 완료하지 못했습니다.");
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setLoading(false); }
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) { setError("분석할 글을 입력해 주세요."); inputRef.current?.focus(); return; }
    await analyze(value);
  }

  async function submitCandidate(reportType: "missed_detection" | "false_positive" | "new_expression") {
    if (!result || result.novelty.candidateRegistration !== "available") return;
    setCandidateState("submitting");
    try {
      const response = await fetch("/api/analyze/candidate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true, text: lastText, reportType }), cache: "no-store" });
      if (!response.ok && response.status !== 409) throw new Error("candidate_failed");
      setCandidateState("submitted");
    } catch { setCandidateState("failed"); }
  }

  function reset() { setText(""); setResult(null); setError(""); setCandidateState("idle"); requestAnimationFrame(() => inputRef.current?.focus()); }

  return (
    <div className="publicAnalyzerShell">
      <a className="skipLink" href="#analyzer-main">분석기로 바로가기</a>
      <header className="publicAnalyzerHeader">
        <div className="publicBrandLockup"><span className="publicAnalyzerMark" aria-hidden="true">R</span><div><strong>RiskShield</strong><span>Context Risk Analyzer · Alpha</span></div></div>
        <a className="quietButton pressable" href="/manage">관리 도구</a>
      </header>
      <main id="analyzer-main" className="publicAnalyzerMain" tabIndex={-1}>
        <section className="publicAnalyzerIntro" aria-labelledby="analyzer-title">
          <span className="publicAnalyzerEyebrow">READ THE CONTEXT, NOT JUST THE WORD</span>
          <h1 id="analyzer-title">글 속에 숨은 위험까지<br />맥락으로 읽습니다.</h1>
          <p>문장이나 게시글을 넣으면 과장·기만, 혐오·차별, 욕설·공격, 숨은 커뮤니티 은어, 폭력·위협 신호를 찾고 왜 위험한지 근거와 함께 보여줍니다.</p>
        </section>

        <form className="publicAnalyzerForm" onSubmit={submit} aria-busy={loading}>
          <div className="publicAnalyzerFieldHeader"><label htmlFor="public-analysis-input">분석할 문장 또는 글</label><span>{text.length.toLocaleString("ko-KR")} / {MAX_INPUT_CHARS.toLocaleString("ko-KR")}</span></div>
          <textarea ref={inputRef} id="public-analysis-input" value={text} onChange={(event) => { setText(event.target.value); setError(""); }} maxLength={MAX_INPUT_CHARS} rows={8} placeholder="SNS 글, 댓글, 광고 문구, 커뮤니티 게시글 등을 붙여 넣으세요." disabled={loading} />
          <div className="publicAnalyzerFormMeta"><span>이름·연락처·주소 등 개인정보는 입력하지 마세요.</span><span>단어 하나보다 앞뒤 문맥이 포함된 문장이 더 정확합니다.</span></div>
          <fieldset className="profilePicker"><legend>결과 보기 방식</legend><div>{PROFILES.map((item) => <label className={profile === item.id ? "isSelected" : ""} key={item.id}><input type="radio" name="profile" value={item.id} checked={profile === item.id} onChange={() => setProfile(item.id)} disabled={loading} /><span><strong>{item.label}</strong><small>{item.description}</small></span></label>)}</div><p>보기 방식만 바뀌며 같은 글의 잠긴 위험 점수는 바뀌지 않습니다.</p></fieldset>
          <div className="publicAnalyzerExamples" aria-label="분석 예시">{EXAMPLES.map((example) => <button className="pressable quietButton" key={example} type="button" onClick={() => setText(example)} disabled={loading}>{example}</button>)}</div>
          <div className="publicAnalyzerActions">
            <button className="pressable primaryButton" type="submit" disabled={loading || !text.trim()}>{loading ? "맥락 분석 중…" : "글 전체 위험 신호 분석"}</button>
            {loading ? <button className="pressable secondaryButton" type="button" onClick={() => controllerRef.current?.abort()}>분석 중단</button> : null}
          </div>
          <div className="publicAnalyzerStatus" aria-live="polite">{error ? <div role="alert"><span>{error}</span>{lastText ? <button className="pressable inlineButton" type="button" onClick={() => analyze(lastText)}>다시 시도</button> : null}</div> : loading ? <span>규칙 근거와 AI 문맥 해석을 함께 확인하고 있습니다.</span> : null}</div>
        </form>

        <p className="publicAnalyzerNotice">이 결과는 사람의 최종 판단을 돕는 검토 보조 신호입니다. <code>no_match</code>도 안전 판정이나 게시 승인이 아닙니다.</p>

        {result ? (
          <section className={`publicAnalyzerResults profile-${result.profile.emphasis}`} aria-labelledby="result-title">
            <p className="analysisProfileFocus"><strong>결과 보기:</strong> {result.profile.focus}</p>
            {result.ai.state === "fallback" ? <div className="analysisBanner" role="status"><strong>규칙 중심 안전 모드</strong><span>{result.ai.reasonLabel ?? "AI 문맥 해석 없이 검토된 위험 규칙만 사용했습니다."}</span></div> : <div className="analysisBanner isReady" role="status"><strong>AI 문맥 분석 사용됨</strong><span>검토된 규칙과 AI 문맥 해석을 함께 반영했습니다.</span></div>}
            <div className={`publicAnalyzerVerdict status-${result.hybrid.status}`}>
              <div><span>현재 발견된 최고 위험도 · 실험 점수</span><strong>{result.scoring.finalScore}<small>/100</small></strong></div>
              <div><span>현재 판정</span><h2 id="result-title" ref={resultHeadingRef} tabIndex={-1}>{statusLabels[result.hybrid.status]}</h2><p>{result.hybrid.reason}</p></div>
            </div>

            <div className="publicAnalyzerResultGrid">
              <article className="analysisCard"><span className="analysisCardEyebrow">주요 위험</span><h3>{result.scoring.primaryCategory?.label ?? "직접 위험 근거 없음"}</h3><p>{result.scoring.primaryCategory ? `규칙 ${result.scoring.primaryCategory.ruleScore} · AI ${result.scoring.primaryCategory.aiScore}` : "현재 지식과 문맥 분석에서 직접 위험을 확인하지 못했습니다."}</p></article>
              <article className="analysisCard"><span className="analysisCardEyebrow">문맥 해석</span><h3>{result.ai.speechAct ? contextLabels[result.ai.speechAct] ?? result.ai.speechAct : "확인 필요"}</h3><p>{result.ai.contextRelation ? contextLabels[result.ai.contextRelation] ?? result.ai.contextRelation : result.uncertainty.reason}</p></article>
              <article className="analysisCard"><span className="analysisCardEyebrow">불확실성</span><h3>{result.uncertainty.level === "high" ? "높음" : result.uncertainty.level === "medium" ? "보통" : "낮음"}</h3><p>{result.uncertainty.reason}</p></article>
            </div>

            {result.scoring.categoryScores.length ? <article className="analysisCard"><span className="analysisCardEyebrow">발견된 위험 범주</span><div className="categoryScoreList">{result.scoring.categoryScores.map((item) => <div key={item.id}><span>{item.label}</span><strong>{item.score}</strong><small>{item.source === "hybrid" ? "규칙 + AI" : item.source === "rule" ? "검토된 규칙" : "AI 문맥"}</small></div>)}</div></article> : null}

            <article className="analysisCard"><span className="analysisCardEyebrow">판단 근거</span><h3>문제가 될 수 있는 정확한 구간</h3>{evidence.length ? <ul className="evidenceList">{evidence.map((item) => <li key={`${item.start}-${item.end}-${item.text}`}><mark>{item.text}</mark><span>{item.sources.join(" + ")} 근거</span></li>)}</ul> : <p>직접 연결되는 근거 구간이 없습니다. 결과를 안전 판정으로 사용하지 마세요.</p>}</article>

            {result.rules.suggestedRewrite ? <article className="analysisCard rewriteCard"><span className="analysisCardEyebrow">더 안전한 표현</span><h3>{result.rules.suggestedRewrite}</h3><p>집단 일반화와 공격 표현을 줄이고, 구체적인 행동과 사실을 중심으로 다시 작성해 보세요.</p></article> : null}

            <article className="analysisCard noveltyCard"><span className="analysisCardEyebrow">결과 개선 참여</span><h3>{result.novelty.label}</h3><p>{result.novelty.reason}</p>{result.novelty.candidateRegistration === "available" ? <div className="publicAnalyzerActions">{result.feedback.missedDetectionAvailable ? <button className="pressable secondaryButton" type="button" onClick={() => submitCandidate("missed_detection")} disabled={candidateState === "submitting" || candidateState === "submitted"}>{candidateState === "submitted" ? "검토함에 전달됨" : candidateState === "submitting" ? "전달 중…" : "위험한 표현인데 놓쳤어요"}</button> : null}{result.feedback.falsePositiveAvailable ? <button className="pressable secondaryButton" type="button" onClick={() => submitCandidate("false_positive")} disabled={candidateState === "submitting" || candidateState === "submitted"}>{candidateState === "submitted" ? "검토함에 전달됨" : candidateState === "submitting" ? "전달 중…" : "위험하지 않은데 잘못 잡았어요"}</button> : null}{!result.feedback.missedDetectionAvailable && !result.feedback.falsePositiveAvailable ? <button className="pressable secondaryButton" type="button" onClick={() => submitCandidate("new_expression")} disabled={candidateState === "submitting" || candidateState === "submitted"}>새 표현 후보로 제공</button> : null}</div> : null}{candidateState === "failed" ? <p role="alert">신고를 전달하지 못했습니다. 잠시 후 다시 시도해 주세요.</p> : null}</article>
            <div className="publicAnalyzerResultActions"><button className="pressable primaryButton" type="button" onClick={reset}>다른 글 분석</button><span>Source {result.release.sourceCommit} · Sites v{result.release.sitesVersion} · Interpreter {result.release.interpreterSchema} · Scoring {result.release.scoringPolicy}</span></div>
          </section>
        ) : null}
      </main>
      <footer className="publicAnalyzerFooter">
        <span>RiskShield {PRODUCT_VERSION} · Source {SOURCE_COMMIT} · Sites v{SITES_VERSION}</span>
        <a href="/manage">관리 도구</a>
      </footer>
    </div>
  );
}
