"use client";

import { useMemo, useRef, useState } from "react";
import { readCsvDataset, type CsvInspection } from "../../lib/datasets/csv";
import type {
  TrainingRunResult,
  TrainingRunState,
  TrainingSourceRow,
  TrainingStageId,
  TrainingStageReport,
} from "../../lib/training/mvp";
import {
  ProductDataTable,
  ProductDefinitionList,
  ProductMetricGrid,
  type ProductDataColumn,
} from "../data-display/ProductData";
import { Pressable } from "../interaction/Pressable";
import { StatePanel, type ProductState } from "../states/StatePanel";

export type TrainingConfigurationOption = {
  id: string;
  label: string;
  version: string;
  configured: boolean;
  active: boolean;
  description: string | null;
};

export type TrainingConfigurationSet = {
  selectedId: string | null;
  options: TrainingConfigurationOption[];
};

export type TrainingConsoleProps = {
  endpoint: string;
  csrfToken: string;
  developmentFixture?: boolean;
  configurationMessage?: string | null;
  model: TrainingConfigurationSet;
  prompt: TrainingConfigurationSet;
  schema: TrainingConfigurationSet;
};

type PreparedDataset = {
  file: File;
  inspection: CsvInspection;
  datasetVersionId: string;
  rows: TrainingSourceRow[];
};

type StageView = {
  id: TrainingStageId;
  label: string;
  support: string;
  report: TrainingStageReport | null;
};

const stageDefinitions = [
  { id: "collector", label: "Collector", support: "파일 기반 Dataset Version을 사용합니다. 인터넷 Collector는 미활성입니다." },
  { id: "cleaner", label: "Cleaner", support: "CSV 정제와 격리, exact/normalized dedupe를 지원합니다." },
  { id: "cluster", label: "Cluster", support: "기본 expression grouping을 지원합니다." },
  { id: "novelty_detector", label: "Novelty Detector", support: "reviewed skill과의 lexical similarity를 지원합니다." },
  { id: "context_analyst", label: "Context Analyst", support: "semantic context adapter가 없으면 not_configured입니다." },
  { id: "skill_generator", label: "Skill Generator", support: "선택한 모델·prompt binding이 있어야 LLM draft를 생성합니다." },
  { id: "red_team", label: "Red-Team", support: "생성된 positive/negative test를 검토 후보에 연결합니다." },
  { id: "confidence_router", label: "Confidence Router", support: "Waiting Review repository가 있어야 후보를 저장합니다." },
  { id: "feedback_learner", label: "Feedback Learner", support: "feedback backend가 없으면 not_configured입니다." },
] as const satisfies ReadonlyArray<{ id: TrainingStageId; label: string; support: string }>;

const runStates = [
  "not_configured",
  "queued",
  "running",
  "waiting_review",
  "succeeded",
  "degraded",
  "failed",
  "cancel_requested",
  "cancelled",
] as const satisfies readonly TrainingRunState[];

const stateLabels: Record<TrainingRunState, string> = {
  not_configured: "설정되지 않음",
  queued: "대기열",
  running: "실행 중",
  waiting_review: "사람 검토 대기",
  succeeded: "완료",
  degraded: "제한 완료",
  failed: "실패",
  cancel_requested: "중단 요청됨",
  cancelled: "중단됨",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunState(value: unknown): value is TrainingRunState {
  return typeof value === "string" && (runStates as readonly string[]).includes(value);
}

function isStageReport(value: unknown): value is TrainingStageReport {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && stageDefinitions.some((stage) => stage.id === value.id)
    && typeof value.label === "string"
    && isRunState(value.state)
    && Array.isArray(value.history)
    && value.history.every(isRunState)
    && typeof value.attempts === "number"
    && (value.itemCount === null || typeof value.itemCount === "number")
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === "string")
    && (value.errorCode === null || typeof value.errorCode === "string");
}

function isTrainingResult(value: unknown): value is TrainingRunResult {
  if (!isRecord(value)) return false;
  if (
    typeof value.runId !== "string"
    || !isRunState(value.status)
    || typeof value.datasetVersionId !== "string"
    || typeof value.sourceSha256 !== "string"
    || !Array.isArray(value.stages)
    || !value.stages.every(isStageReport)
  ) return false;
  const stageIds = new Set(value.stages.map((stage) => stage.id));
  if (!stageDefinitions.every((stage) => stageIds.has(stage.id))) return false;
  if (!isRecord(value.metrics)) return false;
  for (const key of [
    "inputRows",
    "cleanedExpressions",
    "quarantinedRows",
    "exactDuplicates",
    "normalizedDuplicates",
    "groups",
    "candidates",
    "draftedCandidates",
    "savedCandidates",
  ]) {
    if (typeof value.metrics[key] !== "number") return false;
  }
  return Array.isArray(value.cleaned)
    && Array.isArray(value.groups)
    && Array.isArray(value.batches)
    && value.batches.every((batch) => isRecord(batch) && typeof batch.id === "string" && Array.isArray(batch.candidateIds))
    && Array.isArray(value.candidates)
    && Array.isArray(value.persistedCandidateIds)
    && value.persistedCandidateIds.every((id) => typeof id === "string")
    && Array.isArray(value.errors)
    && value.errors.every((error) => typeof error === "string");
}

function formatBytes(value: number) {
  if (value < 1_024) return `${value.toLocaleString("ko-KR")} B`;
  if (value < 1_048_576) return `${(value / 1_024).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} KiB`;
  return `${(value / 1_048_576).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} MiB`;
}

function selectedOption(set: TrainingConfigurationSet, selectedId: string) {
  return set.options.find((option) => option.id === selectedId) ?? null;
}

function initialSelection(set: TrainingConfigurationSet) {
  return set.selectedId
    ?? set.options.find((option) => option.active)?.id
    ?? set.options[0]?.id
    ?? "";
}

function sameOriginEndpoint(endpoint: string) {
  const resolved = new URL(endpoint, window.location.href);
  if (resolved.origin !== window.location.origin) throw new Error("허용되지 않은 training endpoint입니다.");
  return `${resolved.pathname}${resolved.search}`;
}

function statusPanelState(status: TrainingRunState): ProductState {
  if (status === "failed") return "error";
  if (status === "cancelled") return "cancelled";
  if (status === "degraded") return "degraded";
  if (status === "not_configured") return "configuration-required";
  if (status === "queued" || status === "running") return "loading";
  if (status === "cancel_requested") return "revalidating";
  return "success";
}

function stageColumns(): ProductDataColumn<StageView>[] {
  return [
    {
      key: "stage",
      header: "Stage",
      rowHeader: true,
      render: (stage) => <><strong>{stage.label}</strong><small>{stage.support}</small></>,
    },
    {
      key: "state",
      header: "상태",
      render: (stage) => stage.report ? stateLabels[stage.report.state] : "실행 결과 대기",
    },
    {
      key: "items",
      header: "Item 수",
      numeric: true,
      render: (stage) => stage.report?.itemCount === null || !stage.report
        ? "보고되지 않음"
        : stage.report.itemCount.toLocaleString("ko-KR"),
    },
    {
      key: "attempts",
      header: "시도",
      numeric: true,
      render: (stage) => stage.report ? stage.report.attempts.toLocaleString("ko-KR") : "보고되지 않음",
    },
    {
      key: "warnings",
      header: "경고",
      render: (stage) => stage.report?.warnings.length ? stage.report.warnings.join(" · ") : "없음",
    },
    {
      key: "error",
      header: "실패 reason",
      render: (stage) => stage.report?.errorCode ?? "없음",
    },
    {
      key: "history",
      header: "상태 이력",
      render: (stage) => stage.report ? stage.report.history.map((state) => stateLabels[state]).join(" → ") : "없음",
    },
  ];
}

export function TrainingConsole({
  endpoint,
  csrfToken,
  developmentFixture = false,
  configurationMessage,
  model,
  prompt,
  schema,
}: TrainingConsoleProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const [modelId, setModelId] = useState(() => initialSelection(model));
  const [promptId, setPromptId] = useState(() => initialSelection(prompt));
  const [schemaId, setSchemaId] = useState(() => initialSelection(schema));
  const [prepared, setPrepared] = useState<PreparedDataset | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [datasetError, setDatasetError] = useState("");
  const [runStatus, setRunStatus] = useState<TrainingRunState | null>(null);
  const [result, setResult] = useState<TrainingRunResult | null>(null);
  const [runError, setRunError] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const selectedModel = selectedOption(model, modelId);
  const selectedPrompt = selectedOption(prompt, promptId);
  const selectedSchema = selectedOption(schema, schemaId);
  const endpointConfigured = Boolean(endpoint.trim() && csrfToken.trim());
  const configurationReady = Boolean(
    endpointConfigured
    && selectedModel?.configured
    && selectedPrompt?.configured
    && selectedSchema?.configured,
  );
  const requestActive = runStatus === "running" || runStatus === "queued" || runStatus === "cancel_requested";
  const stageViews = useMemo<StageView[]>(() => stageDefinitions.map((stage) => ({
    ...stage,
    report: result?.stages.find((report) => report.id === stage.id) ?? null,
  })), [result]);
  const columns = useMemo(() => stageColumns(), []);

  async function prepareFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase("ko-KR").endsWith(".csv")) {
      setPrepared(null);
      setDatasetError(".csv 파일만 선택할 수 있습니다.");
      return;
    }
    setDatasetLoading(true);
    setDatasetError("");
    setPrepared(null);
    setResult(null);
    setRunStatus(null);
    setRunError("");
    setLatencyMs(null);
    try {
      const dataset = await readCsvDataset(await file.arrayBuffer(), {
        sourceName: file.name,
        previewRows: 0,
      });
      if (dataset.inspection.rowCount > 10_000) {
        throw new Error(`Training 입력은 최대 10,000행입니다. 현재 ${dataset.inspection.rowCount.toLocaleString("ko-KR")}행입니다.`);
      }
      if (!dataset.inspection.canStage || !dataset.inspection.mapping.keyword) {
        throw new Error("CSV 검증 또는 keyword mapping을 통과하지 못했습니다. Dataset Console에서 먼저 확인해 주세요.");
      }
      const sourcePrefix = dataset.inspection.sha256.slice(0, 16);
      const rows = dataset.rows.map<TrainingSourceRow>((row) => ({
        id: `${sourcePrefix}:${row.rowNumber}:${row.mapped.id?.trim() || "row"}`,
        expression: row.mapped.keyword?.trim() ?? "",
        root: row.mapped.root?.trim() || null,
        category: row.mapped.category?.trim() || null,
        sourceRow: row.rowNumber,
        flags: [...row.flags],
      }));
      if (!rows.length || rows.some((row) => !row.expression)) {
        throw new Error("Training에 사용할 유효 keyword 행이 없습니다.");
      }
      setPrepared({
        file,
        inspection: dataset.inspection,
        datasetVersionId: `dataset_${dataset.inspection.sha256.slice(0, 20)}`,
        rows,
      });
    } catch (error) {
      setDatasetError(error instanceof Error ? error.message : "CSV를 읽지 못했습니다.");
    } finally {
      setDatasetLoading(false);
    }
  }

  async function startRun() {
    if (!prepared || !configurationReady || requestActive) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    controllerRef.current = controller;
    const startedAt = performance.now();
    setRunStatus("running");
    setResult(null);
    setRunError("");
    setLatencyMs(null);
    try {
      const response = await fetch(sameOriginEndpoint(endpoint), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-riskshield-csrf": csrfToken,
        },
        body: JSON.stringify({
          datasetVersionId: prepared.datasetVersionId,
          sourceSha256: prepared.inspection.sha256,
          rows: prepared.rows.map((row) => ({
            id: row.id,
            keyword: row.expression,
            root: row.root ?? null,
            category: row.category ?? null,
            sourceRow: row.sourceRow ?? null,
            flags: row.flags ?? [],
          })),
          configuration: {
            model: { id: selectedModel?.id, version: selectedModel?.version },
            prompt: { id: selectedPrompt?.id, version: selectedPrompt?.version },
            schema: { id: selectedSchema?.id, version: selectedSchema?.version },
          },
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (requestIdRef.current !== requestId) return;
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "Training run을 완료하지 못했습니다.";
        throw new Error(message);
      }
      if (!isRecord(payload) || payload.acknowledged !== true || !isTrainingResult(payload.result)) {
        throw new Error("서버 acknowledgement 또는 TrainingRunResult 계약을 확인하지 못했습니다.");
      }
      setResult(payload.result);
      setRunStatus(payload.result.status);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        setRunStatus("cancelled");
        setRunError("");
      } else {
        setRunStatus("failed");
        setRunError(error instanceof Error ? error.message : "Training run을 완료하지 못했습니다.");
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLatencyMs(Math.max(0, Math.round(performance.now() - startedAt)));
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  }

  function requestCancellation() {
    if (!controllerRef.current || !requestActive) return;
    setRunStatus("cancel_requested");
    controllerRef.current.abort();
  }

  return (
    <section className="trainingConsole" aria-label="지속 인텔리전스 Training Pipeline">
      <header className="trainingConsoleHeader">
        <div>
          <p>CONTINUAL INTELLIGENCE MVP</p>
          <h2>Training Pipeline</h2>
          <p>실행되지 않은 단계는 성공으로 표시하지 않으며, 서버가 보고한 item·warning·failure만 표시합니다.</p>
        </div>
        {developmentFixture ? <strong className="developmentDataBadge">개발 데이터</strong> : null}
      </header>

      {!configurationReady ? (
        <StatePanel
          state="configuration-required"
          title="Training 실행 설정이 필요합니다."
          description={configurationMessage || "same-origin endpoint, CSRF, model, prompt, schema 설정을 확인해 주세요."}
        />
      ) : null}

      <section className="trainingDatasetSection" aria-labelledby="training-dataset-title">
        <h3 id="training-dataset-title">Dataset Version</h3>
        <label htmlFor="training-csv-file">실행할 검증된 로컬 CSV</label>
        <input
          ref={fileInputRef}
          id="training-csv-file"
          className="trainingNativeFileInput"
          type="file"
          accept=".csv,text/csv,text/plain"
          disabled={requestActive || datasetLoading}
          onChange={(event) => {
            void prepareFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <Pressable disabled={requestActive || datasetLoading} onClick={() => fileInputRef.current?.click()}>
          검증된 CSV 선택
        </Pressable>
        {datasetLoading ? <StatePanel state="loading" title="전체 CSV를 검증하고 있습니다." description="최대 10,000행을 읽고 SHA와 mapping을 확인합니다." compact /> : null}
        {datasetError ? <StatePanel state="error" title="Dataset Version 준비 실패" description={datasetError} compact /> : null}
        {prepared ? (
          <ProductDefinitionList
            label="선택한 Dataset Version"
            items={[
              { key: "version", term: "Dataset Version", description: <code>{prepared.datasetVersionId}</code> },
              { key: "file", term: "파일", description: prepared.file.name },
              { key: "sha", term: "SHA-256", description: <code>{prepared.inspection.sha256}</code> },
              { key: "rows", term: "전체 / 실행 입력", description: `${prepared.inspection.rowCount.toLocaleString("ko-KR")} / ${prepared.rows.length.toLocaleString("ko-KR")}행` },
              { key: "size", term: "크기", description: formatBytes(prepared.inspection.byteSize) },
              { key: "mapping", term: "Mapping", description: `keyword=${prepared.inspection.mapping.keyword?.header ?? "없음"}, root=${prepared.inspection.mapping.root?.header ?? "없음"}, category=${prepared.inspection.mapping.category?.header ?? "없음"}` },
              { key: "warnings", term: "CSV 경고", description: prepared.inspection.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code).join(" · ") || "없음" },
            ]}
          />
        ) : null}
      </section>

      <section className="trainingConfigurationSection" aria-labelledby="training-config-title">
        <h3 id="training-config-title">모델·Prompt·Schema</h3>
        <div className="trainingConfigurationGrid">
          <label>
            <span>모델</span>
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={requestActive}>
              <option value="">선택 필요</option>
              {model.options.map((option) => <option key={option.id} value={option.id} disabled={!option.configured}>{option.label} · {option.version}{option.configured ? "" : " · 설정 필요"}</option>)}
            </select>
            {selectedModel?.description ? <small>{selectedModel.description}</small> : null}
          </label>
          <label>
            <span>Prompt</span>
            <select value={promptId} onChange={(event) => setPromptId(event.target.value)} disabled={requestActive}>
              <option value="">선택 필요</option>
              {prompt.options.map((option) => <option key={option.id} value={option.id} disabled={!option.configured}>{option.label} · {option.version}{option.configured ? "" : " · 설정 필요"}</option>)}
            </select>
            {selectedPrompt?.description ? <small>{selectedPrompt.description}</small> : null}
          </label>
          <label>
            <span>Schema</span>
            <select value={schemaId} onChange={(event) => setSchemaId(event.target.value)} disabled={requestActive}>
              <option value="">선택 필요</option>
              {schema.options.map((option) => <option key={option.id} value={option.id} disabled={!option.configured}>{option.label} · {option.version}{option.configured ? "" : " · 설정 필요"}</option>)}
            </select>
            {selectedSchema?.description ? <small>{selectedSchema.description}</small> : null}
          </label>
        </div>
      </section>

      <section className="trainingRunControls" aria-labelledby="training-run-title">
        <h3 id="training-run-title">실행 제어</h3>
        <div className="trainingRunActions">
          <Pressable disabled={!prepared || !configurationReady || requestActive} onClick={() => void startRun()}>
            {result || runStatus === "failed" || runStatus === "cancelled" ? "재시도" : "실행 시작"}
          </Pressable>
          <Pressable disabled={!requestActive || runStatus === "cancel_requested"} onClick={requestCancellation}>
            {runStatus === "cancel_requested" ? "중단 요청됨" : "실행 중단"}
          </Pressable>
        </div>
        {runStatus ? (
          <StatePanel
            state={statusPanelState(runStatus)}
            title={stateLabels[runStatus]}
            description={runError || (runStatus === "running" ? "서버의 실제 stage report를 기다리고 있습니다." : undefined)}
            compact
          />
        ) : null}
      </section>

      <section className="trainingStagesSection" aria-labelledby="training-stages-title">
        <h3 id="training-stages-title">9개 Stage</h3>
        <ProductDataTable
          caption="Training stage 실제 상태"
          columns={columns}
          rows={stageViews}
          getRowKey={(stage) => stage.id}
        />
      </section>

      {result ? (
        <>
          <section className="trainingMetricsSection" aria-labelledby="training-metrics-title">
            <h3 id="training-metrics-title">실행 결과</h3>
            <ProductMetricGrid
              label="Training 실제 지표"
              metrics={[
                { key: "input", label: "입력 행", value: result.metrics.inputRows, numeric: true },
                { key: "cleaned", label: "정제 표현", value: result.metrics.cleanedExpressions, numeric: true },
                { key: "quarantined", label: "격리 행", value: result.metrics.quarantinedRows, numeric: true, tone: result.metrics.quarantinedRows ? "warning" : "neutral" },
                { key: "exact", label: "Exact 중복", value: result.metrics.exactDuplicates, numeric: true },
                { key: "normalized", label: "Normalized 중복", value: result.metrics.normalizedDuplicates, numeric: true },
                { key: "groups", label: "표현군", value: result.metrics.groups, numeric: true },
                { key: "candidates", label: "후보", value: result.metrics.candidates, numeric: true },
                { key: "drafted", label: "Draft 생성", value: result.metrics.draftedCandidates, numeric: true },
                { key: "saved", label: "검토함 저장", value: result.metrics.savedCandidates, numeric: true },
                { key: "latency", label: "Request latency", value: latencyMs === null ? "측정되지 않음" : `${latencyMs.toLocaleString("ko-KR")} ms`, numeric: true },
                { key: "cost", label: "비용", value: "미측정" },
              ]}
            />
          </section>

          <section className="trainingCheckpointSection" aria-labelledby="training-checkpoint-title">
            <h3 id="training-checkpoint-title">Checkpoint와 저장 ID</h3>
            <ProductDefinitionList
              items={[
                { key: "run", term: "Run ID", description: <code>{result.runId}</code> },
                { key: "dataset", term: "Dataset Version", description: <code>{result.datasetVersionId}</code> },
                { key: "sha", term: "Source SHA-256", description: <code>{result.sourceSha256}</code> },
              ]}
            />
            <div className="trainingBatchCheckpoints">
              <h4>Batch checkpoint</h4>
              {result.batches.length ? (
                <ul>{result.batches.map((batch) => <li key={batch.id}><code>{batch.id}</code> · {batch.candidateIds.length.toLocaleString("ko-KR")}개 후보</li>)}</ul>
              ) : <p>생성된 batch checkpoint가 없습니다.</p>}
            </div>
            <div className="trainingPersistedIds">
              <h4>Persisted candidate IDs</h4>
              {result.persistedCandidateIds.length ? (
                <pre tabIndex={0}><code>{result.persistedCandidateIds.join("\n")}</code></pre>
              ) : <p>저장된 후보 ID가 없습니다.</p>}
            </div>
            {result.persistedCandidateIds.length ? (
              <a className="reviewInboxLink" href={`/admin/review?run=${encodeURIComponent(result.runId)}`}>Review Inbox에서 확인</a>
            ) : null}
          </section>

          {result.errors.length ? (
            <StatePanel state="error" title="Training error가 보고되었습니다.">
              <ul>{result.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>
            </StatePanel>
          ) : null}
        </>
      ) : latencyMs !== null ? (
        <ProductDefinitionList
          label="마지막 요청 측정"
          items={[
            { key: "latency", term: "Request latency", description: `${latencyMs.toLocaleString("ko-KR")} ms` },
            { key: "cost", term: "비용", description: "미측정" },
          ]}
        />
      ) : null}
    </section>
  );
}
