import { useCallback, useEffect, useMemo, useState } from "react";
import { analyzeWithReviewedRules } from "./analyzer";
import {
  accountRead,
  codexAnalyze,
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
  AnalysisRecord,
  LoginChallenge,
  RateLimits,
  RulesAnalysis,
  ValidationIssue,
} from "./types";
import { reconcileSeverity, validateAiAnalysis } from "./validation";

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
  const [input, setInput] = useState("");
  const [account, setAccount] = useState<AccountInfo>(EMPTY_ACCOUNT);
  const [limits, setLimits] = useState<RateLimits | null>(null);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [rules, setRules] = useState<RulesAnalysis | null>(null);
  const [ai, setAi] = useState<AiAnalysis | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [message, setMessage] = useState("기존 Analyzer v4 규칙은 로그인 없이 사용할 수 있습니다.");

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

  const status = useMemo(() => {
    if (!rules) return null;
    const aiHigh = ai?.findings.some((finding) => finding.severity === "high");
    if (aiHigh && rules.status === "high") return "high";
    if (rules.status === "high" || ai?.findings.length) return "review";
    return rules.status;
  }, [ai, rules]);

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

  async function runAnalysis() {
    const source = input.trim();
    if (!source) return;
    setBusy(true);
    setAi(null);
    setIssues([]);

    const localRules = analyzeWithReviewedRules(source);
    setRules(localRules);
    let nextAi: AiAnalysis | null = null;
    let nextIssues: ValidationIssue[] = [];
    let mode: "hybrid" | "rules-only" = "rules-only";

    if (account.connected) {
      try {
        const received = await codexAnalyze(source, localRules);
        const reconciled = reconcileSeverity(localRules, received);
        nextIssues = validateAiAnalysis(source, reconciled);
        if (nextIssues.length === 0) {
          nextAi = reconciled;
          mode = "hybrid";
          setMessage("Analyzer v4 규칙과 Codex 문맥 검토를 모두 완료했습니다.");
        } else {
          setMessage("Codex 응답 검증에 실패해 안전하게 규칙 결과만 표시합니다.");
        }
      } catch (error) {
        setMessage(`Codex를 사용할 수 없어 규칙 분석으로 완료했습니다: ${String(error)}`);
      }
    } else {
      setMessage("Codex 미연결 상태라 Analyzer v4 규칙만 사용했습니다.");
    }

    setAi(nextAi);
    setIssues(nextIssues);
    try {
      await saveAnalysis({
        input: source,
        rules: localRules,
        ai: nextAi,
        mode,
        validationIssues: nextIssues,
      });
      setHistory(await listHistory());
    } catch {
      setMessage((current) => `${current} 기록 저장은 실패했습니다.`);
    } finally {
      setBusy(false);
    }
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
            <span>Desktop · v0.6.1 alpha</span>
          </div>
        </div>
        <div className="account">
          <span className={`dot ${account.connected ? "online" : ""}`} />
          <div>
            <strong>{account.connected ? account.email ?? "ChatGPT 연결됨" : "Codex 미연결"}</strong>
            <span>{account.connected ? `${account.planType ?? "ChatGPT"} 플랜` : "규칙 분석만 사용 가능"}</span>
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
                onChange={(event) => importTextFile(event.target.files?.[0])}
              />
            </label>
          </div>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="광고, 게시물, 안내 문구를 붙여 넣으세요."
            spellCheck={false}
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

          {!rules ? (
            <div className="empty-state">
              <span>◇</span>
              <p>왼쪽에 문구를 입력하고 분석을 시작하세요.</p>
            </div>
          ) : (
            <div className="result-content">
              <div className="score-row">
                <div className="score">{rules.finalScore}</div>
                <div>
                  <strong>규칙 위험 점수</strong>
                  <p>{rules.reason ?? "검토된 위험 규칙과 일치하지 않았습니다."}</p>
                </div>
              </div>

              <section className="result-block">
                <h3>검출 근거</h3>
                {rules.matches.length === 0
                  ? <p className="muted">Analyzer v4 규칙 일치 없음</p>
                  : rules.matches.slice(0, 4).map((match) => (
                    <article key={match.skill.id} className="finding">
                      <strong>{match.skill.category}</strong>
                      <p>{match.skill.riskReason}</p>
                      <code>{match.hits.map((hit) => hit.text).join(" · ")}</code>
                    </article>
                  ))}
              </section>

              {ai && (
                <section className="result-block">
                  <h3>Codex 문맥 검토</h3>
                  <p>{ai.summary}</p>
                  {ai.findings.map((finding, index) => (
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

              {issues.length > 0 && (
                <section className="validation-warning">
                  <strong>AI 출력 차단</strong>
                  {issues.map((issue) => <p key={issue.message}>{issue.message}</p>)}
                </section>
              )}

              <div className="provenance">
                <span>판정 엔진</span>
                <strong>{ai ? "Analyzer v4 + Codex" : "Analyzer v4 규칙 전용"}</strong>
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
                <button key={record.id} onClick={() => {
                  setInput(record.input);
                  setRules(record.rules);
                  setAi(record.ai);
                  setIssues(record.validationIssues);
                }}>
                  <span>{record.input}</span>
                  <small>{record.mode === "hybrid" ? "규칙 + Codex" : "규칙 전용"}</small>
                </button>
              ))}
          </div>
        </div>
      </section>

      <footer>{message}</footer>
    </main>
  );
}
