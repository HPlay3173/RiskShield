"use client";

import { FormEvent, useRef, useState } from "react";

const MAX_INPUT_CHARS = 2_000;
const EXAMPLES = [
  "이 제품은 업계 최고의 배터리 성능을 보장합니다.",
  "부작용 없이 누구나 한 달 안에 감량할 수 있습니다.",
  "100% 수익 보장이라는 표현은 사용하지 마세요.",
];

type PublicAnalysis = {
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
    score: number;
    conflict: boolean;
    reason: string;
  };
  notice: string;
};

function statusCopy(status: PublicAnalysis["hybrid"]["status"]) {
  if (status === "high") return "높은 위험";
  if (status === "attention") return "주의 필요";
  if (status === "review") return "사람 검토 필요";
  return "직접 위험 미확인";
}

export function PublicAnalyzer() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<PublicAnalysis | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (!value) {
      setError("분석할 문구를 입력해 주세요.");
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value }),
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as PublicAnalysis & { message?: string };
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        throw new Error(
          retryAfter
            ? `${payload.message ?? "요청이 많습니다."} ${retryAfter}초 후 다시 시도해 주세요.`
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

  function cancel() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
    setError("분석을 중단했습니다. 입력은 그대로 유지됩니다.");
  }

  return (
    <div className="publicAnalyzerShell">
      <a className="skipLink" href="#analyzer-main">분석기로 바로가기</a>
      <header className="publicAnalyzerHeader">
        <div>
          <span className="publicAnalyzerMark" aria-hidden="true">R</span>
          <div>
            <strong>RiskShield</strong>
            <span>Public Beta Analyzer</span>
          </div>
        </div>
        <p>문구의 위험 신호를 찾고 사람이 검토할 근거를 정리합니다.</p>
      </header>

      <main id="analyzer-main" className="publicAnalyzerMain">
        <section className="publicAnalyzerIntro" aria-labelledby="analyzer-title">
          <span className="publicAnalyzerEyebrow">ANALYZE COPY</span>
          <h1 id="analyzer-title">말하고 싶은 문장을 그대로 입력하세요.</h1>
          <p>
            규칙 분석과 AI 문맥 해석을 함께 사용합니다. 입력은 분석을 위해 처리되며
            장기 저장하지 않습니다.
          </p>
        </section>

        <form className="publicAnalyzerForm" onSubmit={submit}>
          <label htmlFor="public-analysis-input">검토할 문구</label>
          <textarea
            id="public-analysis-input"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError("");
            }}
            maxLength={MAX_INPUT_CHARS}
            rows={7}
            placeholder="광고 문구, 제품 설명, 캠페인 메시지를 입력해 주세요."
            disabled={loading}
          />
          <div className="publicAnalyzerFormMeta">
            <span>이름·연락처 등 개인정보는 입력하지 마세요.</span>
            <span>{text.length.toLocaleString("ko-KR")} / {MAX_INPUT_CHARS.toLocaleString("ko-KR")}</span>
          </div>
          <div className="publicAnalyzerExamples" aria-label="분석 예시">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => setText(example)} disabled={loading}>
                {example}
              </button>
            ))}
          </div>
          <div className="publicAnalyzerActions">
            <button className="publicAnalyzerSubmit" type="submit" disabled={loading || !text.trim()}>
              {loading ? "분석 중…" : "위험 신호 분석"}
            </button>
            {loading && (
              <button className="publicAnalyzerCancel" type="button" onClick={cancel}>중단</button>
            )}
          </div>
          <div className="publicAnalyzerStatus" aria-live="polite" aria-atomic="true">
            {loading && "규칙 결과를 확인하고 AI 문맥 분석을 진행하고 있습니다."}
            {error && <span role="alert">{error}</span>}
          </div>
        </form>

        <p className="publicAnalyzerNotice">
          이 분석은 사람의 최종 판단을 돕는 보조 도구입니다. <code>no_match</code>는
          안전 판정이나 게시 승인이 아닙니다.
        </p>

        {result && (
          <section className="publicAnalyzerResults" aria-labelledby="result-title">
            <div className={`publicAnalyzerVerdict status-${result.hybrid.status}`}>
              <div>
                <span>DOMINANT RISK</span>
                <h2 id="result-title">{statusCopy(result.hybrid.status)}</h2>
                <p>{result.hybrid.reason}</p>
              </div>
              <strong aria-label={`위험 점수 ${result.hybrid.score}점`}>
                {result.hybrid.score}<small>/100</small>
              </strong>
            </div>

            <div className="publicAnalyzerResultGrid">
              <article>
                <h3>분야별 위험 축</h3>
                {result.rules.categoryScores.length ? (
                  <ul className="publicAnalyzerScores">
                    {result.rules.categoryScores.map((category) => (
                      <li key={category.category}>
                        <span>{category.category}</span>
                        <div><i style={{ width: `${category.score}%` }} /></div>
                        <strong>{category.score}</strong>
                      </li>
                    ))}
                  </ul>
                ) : <p>현재 표시할 위험 축이 없습니다.</p>}
              </article>

              <article>
                <h3>문맥 해석</h3>
                <dl className="publicAnalyzerContext">
                  <div><dt>발화 유형</dt><dd>{result.ai.speechAct ?? result.rules.speechAct}</dd></div>
                  <div><dt>정책 관련성</dt><dd>{result.ai.policyRelevance ?? "확인 필요"}</dd></div>
                  <div><dt>AI 상태</dt><dd>{result.ai.state === "ready" ? "해석 완료" : "규칙 결과로 검토 전환"}</dd></div>
                  <div><dt>불확실성</dt><dd>{result.ai.confidence === null ? "확인 필요" : `${Math.round((1 - result.ai.confidence) * 100)}%`}</dd></div>
                </dl>
              </article>

              <article>
                <h3>판단 근거</h3>
                <p>{result.rules.reason ?? result.rules.recommendation}</p>
                {result.rules.evidence.length > 0 && (
                  <ul className="publicAnalyzerEvidence">
                    {result.rules.evidence.map((item, index) => <li key={`${item.start}-${item.end}-${index}`}>“{item.text}”</li>)}
                  </ul>
                )}
              </article>

              <article>
                <h3>대체 문구</h3>
                <p>{result.rules.suggestedRewrite ?? "단정적 표현을 줄이고 확인 가능한 조건과 근거를 함께 제시해 주세요."}</p>
              </article>
            </div>

            <p className="publicAnalyzerNotice">{result.notice}</p>
          </section>
        )}
      </main>
    </div>
  );
}
