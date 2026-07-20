"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const MAX_INPUT_CHARS = 2_000;
const EXAMPLES = [
  "이 제품은 업계 최고의 배터리 성능을 보장합니다.",
  "부작용 없이 누구나 한 달 안에 감량할 수 있습니다.",
  "100% 수익 보장이라는 표현은 사용하지 마세요.",
];

const PROFILES = [
  {
    id: "balanced",
    label: "균형 분석",
    description: "검증된 v4 규칙과 문맥 해석을 함께 봅니다.",
  },
  {
    id: "advertising",
    label: "광고·주장",
    description: "동일한 v4 점수에서 광고·효능·보장 분야를 결과 상단에 배치합니다.",
  },
  {
    id: "context",
    label: "문맥 우선",
    description: "동일한 v4 점수에서 문맥 관계와 불확실성 설명을 먼저 보여줍니다.",
  },
] as const;

type ProfileId = (typeof PROFILES)[number]["id"];

type PublicAnalysis = {
  profile: {
    id: ProfileId;
    label: string;
    focus: string;
    emphasis: "balanced" | "claims" | "context";
    kernel: "v4-compatibility";
  };
  rules: {
    finalScore: number;
    grade: string;
    status: "no_match" | "review" | "attention" | "high";
    statusLabel: string;
    speechAct: string;
    recommendation: string;
    reason: string | null;
    suggestedRewrite: string | null;
    categoryScores: Array<{ category: string; score: number }>;
    evidence: Array<{ start: number; end: number; text: string; role: string }>;
  };
  scoring: {
    policyVersion: "2.0.0";
    finalScore: number;
    status: "no_match" | "review" | "attention" | "high";
    confidence: number | null;
    highRequiresReview: boolean;
    formula: string;
    primaryCategory: {
      id: string;
      label: string;
      score: number;
      ruleScore: number;
      aiScore: number;
      source: "rule" | "ai" | "hybrid";
      contextMultiplier: number;
    } | null;
    categoryScores: Array<{
      id: string;
      label: string;
      score: number;
      ruleScore: number;
      aiScore: number;
      source: "rule" | "ai" | "hybrid";
      contextMultiplier: number;
      axes: Record<string, number> | null;
    }>;
  };
  ai: {
    state: "ready" | "fallback";
    confidence: number | null;
    riskIntent: string | null;
    speechAct: string | null;
    contextRelation: string | null;
    policyRelevance: string | null;
    riskFamily: string | null;
    evidenceSpans: Array<{ start: number; end: number; text: string }>;
    masked: boolean;
  };
  hybrid: {
    status: "no_match" | "review" | "attention" | "high";
    score: number | null;
    conflict: boolean;
    reason: string;
  };
  uncertainty: { level: "low" | "medium" | "high"; reason: string };
  novelty: {
    state: "known_pattern" | "possible_new_expression" | "insufficient_evidence";
    label: string;
    reason: string;
    candidateRegistration: "disabled" | "available";
  };
  notice: string;
};

function statusCopy(status: PublicAnalysis["hybrid"]["status"]) {
  if (status === "high") return "높은 위험";
  if (status === "attention") return "주의 필요";
  if (status === "review") return "사람 검토 필요";
  return "직접 위험 미확인";
}

function uncertaintyCopy(level: PublicAnalysis["uncertainty"]["level"]) {
  if (level === "high") return "불확실성 높음";
  if (level === "medium") return "불확실성 보통";
  return "불확실성 낮음";
}

export function PublicAnalyzer() {
  const [text, setText] = useState("");
  const [profile, setProfile] = useState<ProfileId>("balanced");
  const [result, setResult] = useState<PublicAnalysis | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastRequest, setLastRequest] = useState<{ text: string; profile: ProfileId } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [candidateState, setCandidateState] = useState<"idle" | "submitting" | "submitted" | "failed">("idle");
  const controllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (result) resultHeadingRef.current?.focus();
  }, [result]);

  async function analyze(input: { text: string; profile: ProfileId }) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError("");
    setCopyState("idle");
    setCandidateState("idle");
    setLastRequest(input);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as PublicAnalysis & { message?: string };
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        throw new Error(
          retryAfter
            ? `${payload.message ?? "요청이 많습니다."} ${retryAfter}초 뒤 다시 시도해 주세요.`
            : payload.message ?? "분석을 완료하지 못했습니다.",
        );
      }
      setResult(payload);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "분석을 완료하지 못했습니다.");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (!value) {
      setError("분석할 문구를 입력해 주세요.");
      inputRef.current?.focus();
      return;
    }
    await analyze({ text: value, profile });
  }

  function cancel() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
    setError("분석을 중단했습니다. 입력한 문구는 그대로 유지됩니다.");
  }

  async function copyRewrite() {
    const rewrite = result?.rules.suggestedRewrite;
    if (!rewrite) return;
    try {
      await navigator.clipboard.writeText(rewrite);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  async function submitCandidate() {
    if (!result || !lastRequest || result.novelty.candidateRegistration !== "available") return;
    setCandidateState("submitting");
    try {
      const response = await fetch("/api/analyze/candidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consent: true,
          text: lastRequest.text,
          riskDomain: result.scoring.primaryCategory?.id ?? "unclassified",
          score: result.scoring.finalScore,
          confidence: result.ai.confidence,
        }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("candidate_submission_failed");
      setCandidateState("submitted");
    } catch {
      setCandidateState("failed");
    }
  }

  function startAnother() {
    setText("");
    setResult(null);
    setError("");
    setCopyState("idle");
    setCandidateState("idle");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="publicAnalyzerShell">
      <a className="skipLink" href="#analyzer-main">분석기로 바로가기</a>
      <header className="publicAnalyzerHeader">
        <div className="publicBrandLockup">
          <span className="publicAnalyzerMark" aria-hidden="true">R</span>
          <div>
            <strong>RiskShield</strong>
            <span>Public Analyzer · v0.5</span>
          </div>
        </div>
        <p>표현의 위험 신호와 문맥을 정리해, 최종 판단을 더 정확하게 돕습니다.</p>
      </header>

      <main id="analyzer-main" className="publicAnalyzerMain" tabIndex={-1}>
        <section className="publicAnalyzerIntro" aria-labelledby="analyzer-title">
          <span className="publicAnalyzerEyebrow">ANALYZE BEFORE YOU PUBLISH</span>
          <h1 id="analyzer-title">말하기 전에,<br />위험을 읽습니다.</h1>
          <p>
            단어부터 광고 문구까지 입력하세요. 검증된 규칙 분석과 제한된 AI 문맥 해석을 함께 보여주며,
            어떤 결과도 자동 승인이나 법률 판단으로 사용하지 않습니다.
          </p>
        </section>

        <form className="publicAnalyzerForm" onSubmit={submit} aria-busy={loading}>
          <div className="publicAnalyzerFieldHeader">
            <label htmlFor="public-analysis-input">분석할 표현</label>
            <span>{text.length.toLocaleString("ko-KR")} / {MAX_INPUT_CHARS.toLocaleString("ko-KR")}</span>
          </div>
          <textarea
            ref={inputRef}
            id="public-analysis-input"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError("");
            }}
            maxLength={MAX_INPUT_CHARS}
            rows={7}
            placeholder="단어, 문장, 제품 설명 또는 광고 문구를 입력하세요."
            disabled={loading}
          />
          <div className="publicAnalyzerFormMeta">
            <span>이름·연락처 등 개인정보는 입력하지 마세요.</span>
          </div>

          <fieldset className="profilePicker">
            <legend>분석 프로필</legend>
            <div>
              {PROFILES.map((item) => (
                <label key={item.id} className={profile === item.id ? "isSelected" : undefined}>
                  <input
                    type="radio"
                    name="analysis-profile"
                    value={item.id}
                    checked={profile === item.id}
                    onChange={() => setProfile(item.id)}
                    disabled={loading}
                  />
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                </label>
              ))}
            </div>
            <p>프로필은 해석 관점을 정하며 검증된 v4 점수 기준은 바꾸지 않습니다.</p>
          </fieldset>

          <div className="publicAnalyzerExamples" aria-label="분석 예시">
            {EXAMPLES.map((example) => (
              <button className="pressable quietButton" key={example} type="button" onClick={() => setText(example)} disabled={loading}>
                {example}
              </button>
            ))}
          </div>
          <div className="publicAnalyzerActions">
            <button className="pressable primaryButton" type="submit" disabled={loading || !text.trim()}>
              {loading ? "분석 중…" : "위험 신호 분석"}
            </button>
            {loading && (
              <button className="pressable secondaryButton" type="button" onClick={cancel}>분석 중단</button>
            )}
          </div>
          <div className="publicAnalyzerStatus" aria-live="polite" aria-atomic="true">
            {loading && <span>규칙 결과와 AI 문맥 분석을 확인하고 있습니다. 진행률은 추정하지 않습니다.</span>}
            {result && !loading && !error && <span>분석이 완료되어 결과로 이동했습니다.</span>}
            {error && (
              <div role="alert">
                <span>{error}</span>
                {lastRequest && !loading && (
                  <button className="pressable inlineButton" type="button" onClick={() => analyze(lastRequest)}>다시 시도</button>
                )}
              </div>
            )}
          </div>
        </form>

        <p className="publicAnalyzerNotice">
          이 분석은 사람의 최종 검토를 돕는 보조 도구입니다. <code>no_match</code>는 안전 판정이나 게시 승인이 아닙니다.
        </p>

        {result && (
          <section className="publicAnalyzerResults" aria-labelledby="result-title">
            {result.ai.state === "fallback" && (
              <div className="analysisBanner" role="status">
                <strong>Rules-only 안전 모드</strong>
                <span>AI 문맥 해석을 사용할 수 없어 검증된 규칙 결과만 표시합니다.</span>
              </div>
            )}

            <div className={`publicAnalyzerVerdict status-${result.hybrid.status}`}>
              <div>
                <span>DOMINANT RISK · {result.profile.label}</span>
                <h2 ref={resultHeadingRef} id="result-title" tabIndex={-1}>{statusCopy(result.hybrid.status)}</h2>
                <p>{result.hybrid.reason}</p>
              </div>
              <strong
                className="riskScore"
                aria-label={`종합 위험 점수 ${result.scoring.finalScore}점. 고정 점수 공식 ${result.scoring.policyVersion}`}
              >
                {result.scoring.finalScore}<small>/100</small>
                <em>{result.scoring.primaryCategory?.label ?? "직접 위험 근거 미확인"}</em>
              </strong>
            </div>

            <p className="analysisProfileFocus">
              <strong>프로필 초점</strong>
              <span>{result.profile.focus}</span>
            </p>

            <div className="resultSignalStrip" aria-label="결과 보조 신호">
              <div><span>불확실성</span><strong>{uncertaintyCopy(result.uncertainty.level)}</strong><small>{result.uncertainty.reason}</small></div>
              <div><span>신규 표현 가능성</span><strong>{result.novelty.label}</strong><small>{result.novelty.reason}</small></div>
              <div><span>분석 모드</span><strong>{result.ai.state === "ready" ? "규칙 + AI" : "규칙 전용"}</strong><small>AI만으로 높은 위험을 만들지 않습니다.</small></div>
            </div>

            <div className={`publicAnalyzerResultGrid profile-${result.profile.emphasis}`}>
              <article className="resultCard categoryCard">
                <h3>주요 분야별 위험</h3>
                {result.scoring.categoryScores.length ? (
                  <ul className="publicAnalyzerScores">
                    {result.scoring.categoryScores.map((category) => (
                      <li key={category.id}>
                        <span>{category.label}<small>{category.source === "hybrid" ? "규칙 + AI" : category.source === "rule" ? "규칙" : "AI 문맥"}</small></span>
                        <div aria-hidden="true"><i style={{ width: `${category.score}%` }} /></div>
                        <strong>{category.score}</strong>
                      </li>
                    ))}
                  </ul>
                ) : <p className="emptyCopy">현재 표시할 분야별 위험 축이 없습니다.</p>}
                <p className="scoringPolicyNote">점수 공식 {result.scoring.policyVersion} · 최고 분야 중심, 보조 분야 최대 10점 반영</p>
              </article>

              <article className="resultCard contextCard">
                <h3>문맥 해석</h3>
                <dl className="publicAnalyzerContext">
                  <div><dt>발화 유형</dt><dd>{result.ai.speechAct ?? result.rules.speechAct}</dd></div>
                  <div><dt>정책 관련성</dt><dd>{result.ai.policyRelevance ?? "확인 필요"}</dd></div>
                  <div><dt>문맥 관계</dt><dd>{result.ai.contextRelation ?? "규칙 결과만 사용"}</dd></div>
                  <div><dt>AI 신뢰도</dt><dd>{result.ai.confidence === null ? "제공되지 않음" : `${Math.round(result.ai.confidence * 100)}%`}</dd></div>
                </dl>
              </article>

              <article className="resultCard evidenceCard">
                <h3>판단 근거와 evidence</h3>
                <p>{result.rules.reason ?? result.rules.recommendation}</p>
                {result.rules.evidence.length > 0 ? (
                  <ul className="publicAnalyzerEvidence">
                    {result.rules.evidence.map((item, index) => (
                      <li key={`${item.start}-${item.end}-${index}`}><mark>{item.text}</mark><span>{item.role}</span></li>
                    ))}
                  </ul>
                ) : <p className="emptyCopy">정확히 일치한 근거 구간이 없습니다. 안전하다는 뜻은 아닙니다.</p>}
              </article>

              <article className="resultCard rewriteCard">
                <h3>대체 문구</h3>
                <p>{result.rules.suggestedRewrite ?? "단정적인 표현을 줄이고 확인 가능한 조건과 근거를 함께 제시하세요."}</p>
                <button
                  className="pressable secondaryButton"
                  type="button"
                  onClick={copyRewrite}
                  disabled={!result.rules.suggestedRewrite}
                >
                  {copyState === "copied" ? "복사됨" : copyState === "failed" ? "복사 실패" : "대체 문구 복사"}
                </button>
              </article>
            </div>

            <div className="resultFooterActions">
              <button className="pressable primaryButton" type="button" onClick={startAnother}>다른 문구 분석</button>
              <span>공개 분석 결과는 자동 학습이나 후보 등록에 사용되지 않습니다.</span>
            </div>
            {result.novelty.candidateRegistration === "available" && (
              <div className="candidateOptIn">
                <div>
                  <strong>새 위험 표현 개선에 제공</strong>
                  <p>개인정보가 없는 현재 문구를 검토 대기 후보로 저장합니다. 자동으로 규칙에 추가되지는 않습니다.</p>
                </div>
                <button
                  className="pressable secondaryButton"
                  type="button"
                  onClick={submitCandidate}
                  disabled={candidateState === "submitting" || candidateState === "submitted"}
                >
                  {candidateState === "submitting" ? "제공 중" : candidateState === "submitted" ? "후보 제공 완료" : "동의하고 후보 제공"}
                </button>
                {candidateState === "failed" && <p role="alert">후보를 저장하지 못했습니다. 분석 결과에는 영향이 없습니다.</p>}
              </div>
            )}
            <p className="publicAnalyzerNotice">{result.notice}</p>
          </section>
        )}
      </main>
      <footer className="publicAnalyzerFooter">
        <a href="/access">관리자 로그인</a>
      </footer>
    </div>
  );
}
