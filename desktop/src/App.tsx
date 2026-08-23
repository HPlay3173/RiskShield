import { useCallback, useEffect, useMemo, useState } from "react";
import AdminConsole from "./AdminConsole";
import {
  FOCUS_COPY,
  orderAiFindings,
  orderRuleMatches,
} from "./analysis-focus";
import { analyzeWithReviewedRules } from "./analyzer";
import {
  analyzeByPriority,
  GemmaKeyRequiredError,
  type EngineResult,
} from "./engine";
import {
  buildReviewPresentation,
  contextJudgmentLabel,
} from "./review-report";
import { effectiveHistoryEngine } from "./history";
import {
  accountRead,
  codexAnalyze,
  gemmaAnalyze,
  gemmaKeySaveAndAnalyze,
  listFallbackRules,
  listHistory,
  loginStart,
  logout,
  openExternal,
  rateLimitsRead,
  saveAnalysis,
} from "./tauri";
import type {
  AccountInfo,
  AiAnalysis,
  AnalysisEngine,
  AnalysisFocus,
  AnalysisRecord,
  LoginChallenge,
  RateLimits,
  RulesAnalysis,
  ValidationIssue,
} from "./types";
import { parseAiAnalysis, statusFromAi } from "./validation";

const EMPTY_ACCOUNT: AccountInfo = {
  connected: false,
  email: null,
  planType: null,
  authMode: null,
};

function formatReset(timestamp: number) {
  if (!timestamp) return "알 수 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

export default function App() {
  const [screen, setScreen] = useState<"analyzer" | "admin">("analyzer");
  const [input, setInput] = useState("");
  const [focus, setFocus] = useState<AnalysisFocus>("balanced");
  const [account, setAccount] = useState<AccountInfo>(EMPTY_ACCOUNT);
  const [limits, setLimits] = useState<RateLimits | null>(null);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [rules, setRules] = useState<RulesAnalysis | null>(null);
  const [ai, setAi] = useState<AiAnalysis | null>(null);
  const [engine, setEngine] = useState<AnalysisEngine | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingGemmaInput, setPendingGemmaInput] = useState<string | null>(null);
  const [gemmaKeyInput, setGemmaKeyInput] = useState("");
  const [gemmaKeyError, setGemmaKeyError] = useState<string | null>(null);
  const [gemmaKeyBusy, setGemmaKeyBusy] = useState(false);
  const [message, setMessage] = useState("판정 순서: Codex → Gemma 4 → 로컬 규칙");

  const refreshAccount = useCallback(async () => {
    try {
      const next = await accountRead();
      setAccount(next);
      setAuthError(null);
      if (next.connected) {
        setChallenge(null);
        setLimits(await rateLimitsRead().catch(() => null));
      }
    } catch (error) {
      const detail = String(error);
      setAuthError(detail);
      setMessage(detail);
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
    void listHistory().then(setHistory).catch(() => undefined);
  }, [refreshAccount]);

  useEffect(() => {
    if (!challenge) return;
    const timer = window.setInterval(() => void refreshAccount(), 2500);
    return () => window.clearInterval(timer);
  }, [challenge, refreshAccount]);

  const review = useMemo(
    () => buildReviewPresentation(engine, ai, rules),
    [ai, engine, rules],
  );
  const status = useMemo(() => {
    if (ai) return statusFromAi(ai);
    return rules?.status ?? null;
  }, [ai, rules]);
  const interactionLocked = busy || gemmaKeyBusy || pendingGemmaInput !== null;
  const focusedAiFindings = useMemo(
    () => orderAiFindings(ai?.findings ?? [], focus),
    [ai, focus],
  );
  const focusedRuleMatches = useMemo(
    () => orderRuleMatches(rules?.matches ?? [], focus),
    [focus, rules],
  );

  async function connect() {
    setAuthBusy(true);
    setAuthError(null);
    setMessage("Codex CLI를 시작하고 로그인 코드를 요청하는 중입니다.");
    try {
      const next = await loginStart();
      setChallenge(next);
      setMessage("브라우저에서 코드를 입력한 뒤 이 화면으로 돌아오세요.");
      try {
        await openExternal(next.verificationUrl);
      } catch {
        setAuthError("로그인 페이지를 자동으로 열지 못했습니다. 아래 ‘로그인 페이지 열기’를 누르세요.");
      }
    } catch (error) {
      const detail = String(error);
      setAuthError(detail);
      setMessage(detail);
    } finally {
      setAuthBusy(false);
    }
  }

  async function disconnect() {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await logout();
      setAccount(EMPTY_ACCOUNT);
      setLimits(null);
      setMessage("Codex 계정 연결을 해제했습니다.");
    } catch (error) {
      const detail = String(error);
      setAuthError(detail);
      setMessage(detail);
    } finally {
      setAuthBusy(false);
    }
  }

  async function callGemma(source: string): Promise<AiAnalysis> {
    try {
      return parseAiAnalysis(JSON.stringify(await gemmaAnalyze(source)));
    } catch (error) {
      const detail = String(error);
      if (detail.includes("GEMMA_KEY_MISSING")) {
        throw new GemmaKeyRequiredError();
      }
      if (detail.includes("GEMMA_AUTH_INVALID")) {
        throw new GemmaKeyRequiredError("저장한 키가 유효하지 않습니다. 새 키를 입력하세요.");
      }
      throw error;
    }
  }

  async function applyResult(source: string, result: EngineResult) {
    const nextRules = result.rules;
    const nextAi = result.ai;
    const nextIssues = result.issues;
    const nextEngine = result.engine;
    const mode: "hybrid" | "rules-only" = nextEngine === "rules" ? "rules-only" : "hybrid";

    if (nextEngine === "codex") {
      setMessage(nextIssues.length
        ? `Codex로 판정하고 검증에 실패한 판단 ${nextIssues.length}개만 제외했습니다.`
        : "Codex로 판정을 완료했습니다.");
    } else if (nextEngine === "gemma") {
      setMessage(nextIssues.length
        ? `Codex를 사용할 수 없어 Gemma 4로 판정하고 잘못된 판단 ${nextIssues.length}개를 제외했습니다.`
        : "Codex를 사용할 수 없어 Gemma 4로 판정을 완료했습니다.");
    } else {
      setMessage("Codex와 Gemma 4를 모두 사용할 수 없어 로컬 규칙 안전 모드로 판정했습니다.");
    }

    setInput(source);
    setRules(nextRules);
    setAi(nextAi);
    setEngine(nextEngine);
    setIssues(nextIssues);
    try {
      await saveAnalysis({
        input: source,
        rules: nextRules,
        ai: nextAi,
        mode,
        focus,
        engine: nextEngine,
        validationIssues: nextIssues,
      });
      setHistory(await listHistory());
    } catch {
      setMessage((current) => `${current} 기록 저장은 실패했습니다.`);
    }
  }

  async function runAnalysis() {
    const source = input.trim();
    if (!source) return;
    setBusy(true);
    setAi(null);
    setRules(null);
    setEngine(null);
    setIssues([]);

    try {
      const fallbackRules = await listFallbackRules().catch(() => []);
      const result = await analyzeByPriority(source, {
        codexEnabled: account.connected,
        codex: async () => parseAiAnalysis(JSON.stringify(await codexAnalyze(source))),
        gemma: () => callGemma(source),
        rules: () => analyzeWithReviewedRules(source, fallbackRules),
      });
      await applyResult(source, result);
    } catch (error) {
      if (error instanceof GemmaKeyRequiredError) {
        setPendingGemmaInput(source);
        setGemmaKeyError(error.message === "Gemma API 키가 필요합니다." ? null : error.message);
        setMessage("Codex를 사용할 수 없어 Gemma 4 무료 API 키가 필요합니다.");
      } else {
        setMessage(`분석을 완료하지 못했습니다: ${String(error)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveGemmaKeyAndContinue() {
    const apiKey = gemmaKeyInput.trim();
    const source = pendingGemmaInput;
    if (!apiKey || !source) return;
    setGemmaKeyBusy(true);
    setGemmaKeyError(null);
    try {
      const fallbackRules = await listFallbackRules().catch(() => []);
      const result = await analyzeByPriority(source, {
        codexEnabled: false,
        codex: () => codexAnalyze(source),
        gemma: async () => {
          try {
            const raw = await gemmaKeySaveAndAnalyze(apiKey, source);
            return parseAiAnalysis(JSON.stringify(raw));
          } catch (error) {
            if (String(error).includes("GEMMA_AUTH_INVALID")) {
              throw new GemmaKeyRequiredError("입력한 키가 유효하지 않습니다. 다시 확인하세요.");
            }
            throw error;
          }
        },
        rules: () => analyzeWithReviewedRules(source, fallbackRules),
      });
      setGemmaKeyInput("");
      setPendingGemmaInput(null);
      await applyResult(source, result);
    } catch (error) {
      if (error instanceof GemmaKeyRequiredError) {
        setGemmaKeyError(error.message);
      } else {
        setGemmaKeyError(`키를 저장하거나 분석을 재개하지 못했습니다: ${String(error)}`);
      }
    } finally {
      setGemmaKeyBusy(false);
    }
  }

  async function useRulesForPending() {
    const source = pendingGemmaInput;
    if (!source) return;
    setPendingGemmaInput(null);
    setGemmaKeyInput("");
    setGemmaKeyError(null);
    const fallbackRules = await listFallbackRules().catch(() => []);
    await applyResult(source, {
      engine: "rules",
      ai: null,
      rules: analyzeWithReviewedRules(source, fallbackRules),
      issues: [],
    });
  }

  function importTextFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(txt|md|csv)$/iu.test(file.name)) {
      setMessage("현재 TXT, MD, CSV 파일만 불러올 수 있습니다.");
      return;
    }
    void file.text().then(setInput);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            <strong>RiskShield</strong>
            <span>Desktop · v0.8.1 alpha</span>
          </div>
        </div>
        <nav className="topnav" aria-label="주요 화면">
          <button
            className={screen === "analyzer" ? "active" : ""}
            onClick={() => setScreen("analyzer")}
          >
            분석기
          </button>
          <button
            className={screen === "admin" ? "active" : ""}
            onClick={() => setScreen("admin")}
          >
            관리자
          </button>
        </nav>
        <div className="account">
          <span className={`dot ${account.connected ? "online" : ""}`} />
          <div>
            <strong>{account.connected ? account.email ?? "ChatGPT 연결됨" : "Codex 미연결"}</strong>
            <span>{account.connected ? `${account.planType ?? "ChatGPT"} 플랜` : "Gemma 4 대체 엔진 사용"}</span>
          </div>
          <button
            className="ghost"
            disabled={busy || authBusy}
            onClick={account.connected ? disconnect : connect}
          >
            {authBusy ? "Codex 준비 중…" : account.connected ? "연결 해제" : "Codex 로그인"}
          </button>
        </div>
      </header>

      {authError && (
        <section className="auth-error" role="alert">
          <div>
            <strong>Codex 연결 실패</strong>
            <p>{authError}</p>
          </div>
          {!account.connected && !authBusy && (
            <button onClick={connect}>다시 시도</button>
          )}
        </section>
      )}

      {challenge && !account.connected && (
        <section className="login-banner">
          <div>
            <span className="eyebrow">DEVICE LOGIN</span>
            <strong>{challenge.userCode}</strong>
            <p>열린 OpenAI 페이지에 위 코드를 입력하세요.</p>
          </div>
          <button onClick={() => void openExternal(challenge.verificationUrl)}>로그인 페이지 열기</button>
        </section>
      )}

      {screen === "admin" ? (
        <AdminConsole onMessage={setMessage} />
      ) : (
        <>
      <section className="workspace">
        <div className="editor-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SOURCE</span>
              <h1>문구 위험 분석</h1>
            </div>
            <label className="file-button">
              파일 불러오기
              <input
                type="file"
                accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
                disabled={interactionLocked}
                onChange={(event) => importTextFile(event.target.files?.[0])}
              />
            </label>
          </div>
          <div className="focus-picker" aria-label="분석 결과 보기 방식">
            {(Object.keys(FOCUS_COPY) as AnalysisFocus[]).map((value) => (
              <button
                type="button"
                className={focus === value ? "active" : ""}
                key={value}
                disabled={interactionLocked}
                onClick={() => setFocus(value)}
              >
                <strong>{FOCUS_COPY[value].label}</strong>
                <span>{FOCUS_COPY[value].description}</span>
              </button>
            ))}
          </div>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="광고, 게시물, 안내 문구를 붙여 넣으세요."
            spellCheck={false}
            disabled={interactionLocked}
          />
          <div className="editor-footer">
            <span>{input.length.toLocaleString()}자</span>
            <button className="primary" disabled={busy || !input.trim()} onClick={runAnalysis}>
              {busy ? "분석 중…" : "위험 분석"}
            </button>
          </div>
        </div>

        <aside className="result-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">RESULT</span>
              <h2>판정 결과</h2>
            </div>
            <span className={`status-chip ${status ?? "idle"}`}>
              {status === "high" ? "높은 위험" : status === "review" || status === "attention"
                ? "추가 검토" : status === "no_match" ? "규칙 미일치" : "대기"}
            </span>
          </div>

          {!rules && !ai ? (
            <div className="empty-state">
              <span>◇</span>
              <p>왼쪽에 문구를 입력하고 분석을 시작하세요.</p>
            </div>
          ) : (
            <div className="result-content">
              {rules && (
                <div className="score-row">
                  <div className="score">{rules.finalScore}</div>
                  <div>
                    <strong>로컬 규칙 위험 점수</strong>
                    <p>{rules.reason ?? "검토된 위험 규칙과 일치하지 않았습니다."}</p>
                  </div>
                </div>
              )}

              {rules && (
                <section className="result-block">
                  <h3>Analyzer v4 최종 장애조치 · {FOCUS_COPY[focus].label}</h3>
                  {focusedRuleMatches.length === 0
                    ? <p className="muted">Analyzer v4 규칙 일치 없음</p>
                    : focusedRuleMatches.slice(0, 4).map((match) => (
                      <article key={match.skill.id} className="finding">
                        <strong>{match.skill.category}</strong>
                        <p>{match.skill.riskReason}</p>
                        <code>{match.hits.map((hit) => hit.text).join(" · ")}</code>
                      </article>
                    ))}
                </section>
              )}

              {ai && (
                <section className="result-block">
                  <h3>
                    {engine === "gemma" ? "Gemma 4 판정" : "Codex 판정"}
                    {" · "}{FOCUS_COPY[focus].label}
                  </h3>
                  <p>{ai.summary}</p>
                  {ai.findings.length === 0 && (
                    <p className="muted">
                      {engine === "gemma" ? "Gemma 4가" : "Codex가"} 직접적인 위험 표현을 찾지 않았습니다.
                    </p>
                  )}
                  {focusedAiFindings.map((finding, index) => (
                    <article className="finding ai" key={`${finding.category}-${index}`}>
                      <div>
                        <strong>{finding.category}</strong>
                        <span>{finding.severity}</span>
                      </div>
                      <p>{finding.explanation}</p>
                      <code>“{finding.evidence}”</code>
                      {finding.rewrite && <p className="rewrite">대체: {finding.rewrite}</p>}
                    </article>
                  ))}
                </section>
              )}

              {review && (
                <section className="context-judgment result-block">
                  <div className="report-heading">
                    <h3>문맥 판단</h3>
                    <span>{contextJudgmentLabel(review.contextJudgment.type)}</span>
                  </div>
                  <p>{review.contextJudgment.explanation}</p>
                </section>
              )}

              {review && ai && (
                <div className="score-row result-block">
                  <div className="score">{review.riskScore}</div>
                  <div>
                    <strong>판정 위험 점수</strong>
                    <p>
                      {engine === "gemma" ? "Gemma 4" : "Codex"}가 전체 문맥을 바탕으로
                      산정한 참고 점수이며, 위 판정을 변경하지 않습니다.
                    </p>
                  </div>
                </div>
              )}

              {review && (
                <section className="suggested-rewrite result-block">
                  <h3>수정 문구 제안</h3>
                  <p>{review.suggestedRewrite ?? "현재 제안할 수정 문구가 없습니다."}</p>
                </section>
              )}

              {issues.length > 0 && (
                <section className="validation-warning">
                  <strong>일부 {engine === "gemma" ? "Gemma 4" : "Codex"} 판단 제외</strong>
                  {issues.map((issue) => <p key={issue.message}>{issue.message}</p>)}
                </section>
              )}

              <div className="provenance">
                <span>판정 엔진</span>
                <strong>{engine === "codex"
                  ? "Codex"
                  : engine === "gemma"
                    ? "Gemma 4 API"
                    : "Analyzer v4 로컬 규칙"}</strong>
              </div>
            </div>
          )}
        </aside>
      </section>

      <section className="bottom-grid">
        <div className="usage-card panel">
          <span className="eyebrow">CODEX USAGE</span>
          <h2>계정 한도</h2>
          {limits?.primary ? (
            <>
              <div className="meter"><i style={{ width: `${limits.primary.usedPercent}%` }} /></div>
              <div className="usage-meta">
                <strong>{limits.primary.usedPercent}% 사용</strong>
                <span>{formatReset(limits.primary.resetsAt)} 초기화</span>
              </div>
            </>
          ) : <p className="muted">로그인하면 Codex 한도를 표시합니다.</p>}
        </div>
        <div className="history-card panel">
          <span className="eyebrow">LOCAL HISTORY</span>
          <h2>최근 분석</h2>
          <div className="history-list">
            {history.length === 0
              ? <p className="muted">저장된 분석이 없습니다.</p>
              : history.slice(0, 5).map((record) => (
                <button key={record.id} disabled={interactionLocked} onClick={() => {
                  const nextEngine = effectiveHistoryEngine(record);
                  setInput(record.input);
                  setRules(record.rules);
                  setAi(record.ai);
                  setFocus(record.focus ?? "balanced");
                  setEngine(nextEngine);
                  setIssues(record.validationIssues);
                }}>
                  <span>{record.input}</span>
                  <small>{effectiveHistoryEngine(record) === "codex"
                    ? "Codex"
                    : effectiveHistoryEngine(record) === "gemma"
                      ? "Gemma 4"
                      : "규칙 안전 모드"}</small>
                </button>
              ))}
          </div>
        </div>
      </section>
        </>
      )}

      <footer>{message}</footer>

      {pendingGemmaInput && (
        <div className="dialog-backdrop">
          <form
            className="key-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gemma-key-title"
            onSubmit={(event) => {
              event.preventDefault();
              void saveGemmaKeyAndContinue();
            }}
          >
            <span className="eyebrow">GEMMA 4 FALLBACK</span>
            <h2 id="gemma-key-title">무료 API 키 한 번만 입력</h2>
            <p>
              Codex를 지금 사용할 수 없습니다. 입력한 키는 이 앱의 파일이나 기록이 아닌
              Windows 자격 증명 관리자에 바로 저장됩니다.
            </p>
            <label htmlFor="gemma-api-key">Google AI Studio API 키</label>
            <input
              id="gemma-api-key"
              type="password"
              value={gemmaKeyInput}
              onChange={(event) => setGemmaKeyInput(event.target.value)}
              placeholder="AIza…"
              autoComplete="off"
              autoFocus
              disabled={gemmaKeyBusy}
            />
            {gemmaKeyError && <p className="key-error" role="alert">{gemmaKeyError}</p>}
            <div className="dialog-actions">
              <button type="button" disabled={gemmaKeyBusy} onClick={() => void useRulesForPending()}>
                이번에는 규칙만
              </button>
              <button className="primary" type="submit" disabled={gemmaKeyBusy || !gemmaKeyInput.trim()}>
                {gemmaKeyBusy ? "저장·분석 중…" : "저장하고 계속"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
