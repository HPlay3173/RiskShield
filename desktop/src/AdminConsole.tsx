import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportFallbackRulesCsv,
  parseFallbackRulesCsv,
} from "./admin-csv";
import {
  deleteFallbackRule,
  importFallbackRules,
  listFallbackRules,
  upsertFallbackRule,
} from "./tauri";
import type {
  FallbackRule,
  FallbackRuleInput,
  FallbackRuleSeverity,
} from "./types";

const EMPTY_RULE: FallbackRuleInput = {
  expression: "",
  category: "관리자 보완 규칙",
  severity: "review",
  reason: "",
  enabled: true,
  source: "missed",
};

type Props = {
  onMessage: (message: string) => void;
};

function severityLabel(severity: FallbackRuleSeverity) {
  if (severity === "high") return "높은 위험";
  if (severity === "review") return "추가 검토";
  return "낮은 위험";
}

export default function AdminConsole({ onMessage }: Props) {
  const [rules, setRules] = useState<FallbackRule[]>([]);
  const [draft, setDraft] = useState<FallbackRuleInput>(EMPTY_RULE);
  const [busy, setBusy] = useState(false);
  const [csvIssues, setCsvIssues] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setRules(await listFallbackRules());
  }, []);

  useEffect(() => {
    void refresh().catch((error) => onMessage(`관리자 규칙을 불러오지 못했습니다: ${String(error)}`));
  }, [onMessage, refresh]);

  const enabledCount = useMemo(
    () => rules.filter((rule) => rule.enabled).length,
    [rules],
  );

  async function saveRule() {
    const expression = draft.expression.trim();
    if (!expression) {
      onMessage("놓친 표현을 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      await upsertFallbackRule({
        ...draft,
        expression,
        category: draft.category.trim() || "관리자 보완 규칙",
        reason: draft.reason.trim() || `"${expression}" 표현을 관리자 보완 규칙으로 검토`,
      });
      setDraft(EMPTY_RULE);
      await refresh();
      onMessage("로컬 보완 규칙을 저장했습니다.");
    } catch (error) {
      onMessage(`규칙을 저장하지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: FallbackRule) {
    setBusy(true);
    try {
      await upsertFallbackRule({ ...rule, enabled: !rule.enabled });
      await refresh();
      onMessage(rule.enabled ? "규칙을 비활성화했습니다." : "규칙을 활성화했습니다.");
    } catch (error) {
      onMessage(`규칙 상태를 바꾸지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(rule: FallbackRule) {
    if (!window.confirm(`“${rule.expression}” 규칙을 삭제할까요?`)) return;
    setBusy(true);
    try {
      await deleteFallbackRule(rule.id);
      if (draft.id === rule.id) setDraft(EMPTY_RULE);
      await refresh();
      onMessage("규칙을 삭제했습니다.");
    } catch (error) {
      onMessage(`규칙을 삭제하지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadCsv(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setCsvIssues([]);
    try {
      const parsed = parseFallbackRulesCsv(await file.text());
      setCsvIssues(parsed.issues);
      if (parsed.rules.length === 0) {
        onMessage("가져올 수 있는 CSV 규칙이 없습니다.");
        return;
      }
      const count = await importFallbackRules(parsed.rules);
      await refresh();
      onMessage(`CSV에서 규칙 ${count}개를 저장했습니다.${parsed.issues.length ? ` 제외 ${parsed.issues.length}건` : ""}`);
    } catch (error) {
      onMessage(`CSV를 가져오지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    const blob = new Blob([exportFallbackRulesCsv(rules)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "riskshield-fallback-rules.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    onMessage("현재 보완 규칙을 CSV로 내보냈습니다.");
  }

  return (
    <section className="admin-shell">
      <div className="admin-heading">
        <div>
          <span className="eyebrow">LOCAL ADMIN</span>
          <h1>Fallback Rules</h1>
          <p>
            이 규칙은 Codex와 Gemma 4를 모두 사용할 수 없을 때만 적용됩니다.
            AI 판정이나 등급을 덮어쓰지 않습니다.
          </p>
        </div>
        <div className="admin-stats">
          <span><strong>{rules.length}</strong> 전체</span>
          <span><strong>{enabledCount}</strong> 활성</span>
        </div>
      </div>

      <div className="admin-grid">
        <form
          className="admin-form panel"
          onSubmit={(event) => {
            event.preventDefault();
            void saveRule();
          }}
        >
          <span className="eyebrow">MISSED EXPRESSION</span>
          <h2>{draft.id ? "보완 규칙 수정" : "Analyzer가 놓친 표현 추가"}</h2>

          <label htmlFor="rule-expression">놓친 표현</label>
          <input
            id="rule-expression"
            value={draft.expression}
            onChange={(event) => setDraft((current) => ({
              ...current,
              expression: event.target.value,
            }))}
            placeholder="예: 새로운 은어 또는 우회 표현"
            disabled={busy}
          />

          <div className="form-row">
            <div>
              <label htmlFor="rule-category">위험 범주</label>
              <input
                id="rule-category"
                value={draft.category}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  category: event.target.value,
                }))}
                disabled={busy}
              />
            </div>
            <div>
              <label htmlFor="rule-severity">위험도</label>
              <select
                id="rule-severity"
                value={draft.severity}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  severity: event.target.value as FallbackRuleSeverity,
                }))}
                disabled={busy}
              >
                <option value="low">낮은 위험</option>
                <option value="review">추가 검토</option>
                <option value="high">높은 위험</option>
              </select>
            </div>
          </div>

          <label htmlFor="rule-reason">판단 이유</label>
          <textarea
            id="rule-reason"
            className="admin-reason"
            value={draft.reason}
            onChange={(event) => setDraft((current) => ({
              ...current,
              reason: event.target.value,
            }))}
            placeholder="이 표현을 보완 규칙으로 넣는 이유"
            disabled={busy}
          />

          <div className="dialog-actions">
            {draft.id && (
              <button type="button" onClick={() => setDraft(EMPTY_RULE)} disabled={busy}>
                수정 취소
              </button>
            )}
            <button className="primary" type="submit" disabled={busy || !draft.expression.trim()}>
              {busy ? "저장 중…" : draft.id ? "변경 저장" : "규칙 추가"}
            </button>
          </div>
        </form>

        <section className="csv-card panel">
          <span className="eyebrow">CSV IMPORT</span>
          <h2>CSV로 여러 규칙 추가</h2>
          <p>
            필수 열은 <code>expression</code> 또는 <code>표현</code>입니다.
            category, severity, reason, enabled 열을 선택적으로 사용할 수 있습니다.
          </p>
          <div className="csv-actions">
            <label className="file-button">
              CSV 가져오기
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) => {
                  void loadCsv(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button type="button" disabled={rules.length === 0} onClick={downloadCsv}>
              현재 규칙 내보내기
            </button>
          </div>
          {csvIssues.length > 0 && (
            <div className="csv-issues">
              <strong>제외된 행</strong>
              {csvIssues.slice(0, 5).map((issue) => <p key={issue}>{issue}</p>)}
              {csvIssues.length > 5 && <p>외 {csvIssues.length - 5}건</p>}
            </div>
          )}
        </section>
      </div>

      <section className="rules-table panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">RULE LIST</span>
            <h2>로컬 보완 규칙</h2>
          </div>
        </div>
        {rules.length === 0 ? (
          <p className="muted">추가된 관리자 규칙이 없습니다.</p>
        ) : (
          <div className="rule-list">
            {rules.map((rule) => (
              <article className={`rule-row ${rule.enabled ? "" : "disabled"}`} key={rule.id}>
                <button
                  className={`rule-toggle ${rule.enabled ? "on" : ""}`}
                  type="button"
                  aria-label={`${rule.expression} ${rule.enabled ? "비활성화" : "활성화"}`}
                  onClick={() => void toggleRule(rule)}
                  disabled={busy}
                >
                  <i />
                </button>
                <div className="rule-copy">
                  <strong>{rule.expression}</strong>
                  <span>{rule.category} · {severityLabel(rule.severity)} · {rule.source === "csv" ? "CSV" : "놓친 분석"}</span>
                  <p>{rule.reason}</p>
                </div>
                <div className="rule-actions">
                  <button type="button" onClick={() => setDraft({ ...rule })} disabled={busy}>
                    수정
                  </button>
                  <button className="danger" type="button" onClick={() => void removeRule(rule)} disabled={busy}>
                    삭제
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
