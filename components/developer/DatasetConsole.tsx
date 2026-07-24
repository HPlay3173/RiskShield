"use client";

import { useMemo, useRef, useState } from "react";
import {
  CSV_FIELD_ROLES,
  inspectCsv,
  readCsvDataset,
  type CsvDelimiter,
  type CsvFieldRole,
  type CsvInspection,
  type CsvManualMapping,
  type CsvPreviewRow,
} from "../../lib/datasets/csv";
import { arrayBufferToBase64 } from "../../lib/datasets/source-bytes";
import {
  ProductDataTable,
  ProductDefinitionList,
  ProductMetricGrid,
  type ProductDataColumn,
} from "../data-display/ProductData";
import { Pressable } from "../interaction/Pressable";
import { StatePanel } from "../states/StatePanel";

export type InitialCsvValidationMetadata = {
  id: string;
  fileName: string;
  availability: "available" | "missing" | "not_checked";
  validation: "valid" | "warning" | "error" | "not_checked";
  byteSize: number | null;
  rowCount: number | null;
  sha256: string | null;
  checkedAt: string | null;
  message: string | null;
};

export type InitialCsvMetadataTuple = readonly [
  InitialCsvValidationMetadata,
  InitialCsvValidationMetadata,
  InitialCsvValidationMetadata,
];

export type DatasetConsoleProps = {
  initialCsvMetadata: InitialCsvMetadataTuple;
  stagingEndpoint: string;
  csrfToken: string;
  developmentFixture?: boolean;
  configurationMessage?: string | null;
};

type ProvenanceDraft = {
  owner: string;
  license: string;
  purpose: string;
  retention: string;
};

type SubmissionState =
  | { state: "idle" }
  | { state: "staging" }
  | { state: "success"; message: string; datasetVersionId: string | null }
  | { state: "error"; message: string };

const fieldLabels: Record<CsvFieldRole, string> = {
  id: "ID",
  keyword: "Keyword",
  root: "Root expression",
  category: "Category",
  matchingType: "Matching type",
  severity: "Severity",
  reason: "Reason",
  alternative: "Alternative",
};

const profileLabels = {
  controversy: "논란 표현 데이터",
  false_advertising: "허위·과장 광고 데이터",
  hate_speech: "혐오 표현 사전",
  generic: "일반 CSV",
} as const;

const validationLabels: Record<InitialCsvValidationMetadata["validation"], string> = {
  valid: "검증 통과",
  warning: "경고 있음",
  error: "검증 실패",
  not_checked: "미검증",
};

const emptyProvenance: ProvenanceDraft = {
  owner: "",
  license: "",
  purpose: "",
  retention: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBytes(value: number | null) {
  if (value === null) return "확인되지 않음";
  if (value < 1_024) return `${value.toLocaleString("ko-KR")} B`;
  if (value < 1_048_576) return `${(value / 1_024).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} KiB`;
  return `${(value / 1_048_576).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} MiB`;
}

function displayNumber(value: number | null) {
  return value === null ? "확인되지 않음" : value.toLocaleString("ko-KR");
}

function displayDate(value: string | null) {
  if (!value) return "확인되지 않음";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(parsed);
}

function delimiterLabel(delimiter: CsvDelimiter) {
  if (delimiter === "\t") return "Tab";
  if (delimiter === ",") return "Comma (,)";
  if (delimiter === ";") return "Semicolon (;)";
  return "Pipe (|)";
}

function sameOriginEndpoint(endpoint: string) {
  const resolved = new URL(endpoint, window.location.href);
  if (resolved.origin !== window.location.origin) throw new Error("허용되지 않은 staging endpoint입니다.");
  return `${resolved.pathname}${resolved.search}`;
}

function initialColumns(): ProductDataColumn<InitialCsvValidationMetadata>[] {
  return [
    { key: "file", header: "초기 CSV", rowHeader: true, render: (item) => item.fileName },
    {
      key: "state",
      header: "상태",
      render: (item) => item.availability === "missing" ? "파일 없음" : validationLabels[item.validation],
    },
    { key: "rows", header: "행 수", numeric: true, render: (item) => displayNumber(item.rowCount) },
    { key: "bytes", header: "Byte size", numeric: true, render: (item) => formatBytes(item.byteSize) },
    { key: "sha", header: "SHA-256", render: (item) => item.sha256 ? <code>{item.sha256}</code> : "확인되지 않음" },
    { key: "checked", header: "검증 시각", render: (item) => displayDate(item.checkedAt) },
    { key: "message", header: "검증 메모", render: (item) => item.message ?? "기록 없음" },
  ];
}

function previewColumns(inspection: CsvInspection): ProductDataColumn<CsvPreviewRow>[] {
  return [
    { key: "row", header: "행", rowHeader: true, numeric: true, render: (row) => row.rowNumber },
    { key: "valid", header: "검증", render: (row) => row.valid ? "유효" : "오류" },
    ...inspection.headers.map((header, index) => ({
      key: `column-${index}`,
      header: header || `열 ${index + 1}`,
      render: (row: CsvPreviewRow) => row.cells[index] ?? "",
    })),
    { key: "flags", header: "검사 flag", render: (row) => row.flags.length ? row.flags.join(" · ") : "없음" },
  ];
}

export function DatasetConsole({
  initialCsvMetadata,
  stagingEndpoint,
  csrfToken,
  developmentFixture = false,
  configurationMessage,
}: DatasetConsoleProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inspectionRequestRef = useRef(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<CsvInspection | null>(null);
  const [manualMapping, setManualMapping] = useState<CsvManualMapping>({});
  const [delimiterOverride, setDelimiterOverride] = useState<CsvDelimiter | "">("");
  const [inspecting, setInspecting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [inspectionError, setInspectionError] = useState("");
  const [provenance, setProvenance] = useState<ProvenanceDraft>(emptyProvenance);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });

  const configured = Boolean(stagingEndpoint.trim() && csrfToken.trim());
  const provenanceComplete = Object.values(provenance).every((value) => value.trim());
  const hasWarnings = inspection?.issues.some((issue) => issue.severity === "warning") ?? false;
  const readyToStage = Boolean(
    selectedFile
    && inspection?.canStage
    && provenanceComplete
    && configured
    && (!hasWarnings || warningsAcknowledged)
    && submission.state !== "staging",
  );
  const initialMetadataReady = initialCsvMetadata.length === 3;
  const initialMetadataColumns = useMemo(() => initialColumns(), []);
  const currentPreviewColumns = useMemo(
    () => inspection ? previewColumns(inspection) : [],
    [inspection],
  );

  async function inspectSelected(
    file: File,
    mapping: CsvManualMapping,
    delimiter: CsvDelimiter | "",
  ) {
    const requestId = inspectionRequestRef.current + 1;
    inspectionRequestRef.current = requestId;
    setInspecting(true);
    setInspectionError("");
    setSubmission({ state: "idle" });
    setWarningsAcknowledged(false);
    try {
      const result = await inspectCsv(await file.arrayBuffer(), {
        sourceName: file.name,
        mapping,
        delimiter: delimiter || undefined,
        previewRows: 50,
      });
      if (inspectionRequestRef.current !== requestId) return;
      setInspection(result);
    } catch (error) {
      if (inspectionRequestRef.current !== requestId) return;
      setInspection(null);
      setInspectionError(error instanceof Error ? error.message : "CSV를 검사하지 못했습니다.");
    } finally {
      if (inspectionRequestRef.current === requestId) setInspecting(false);
    }
  }

  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase("ko-KR").endsWith(".csv")) {
      setSelectedFile(null);
      setInspection(null);
      setInspectionError(".csv 파일만 선택할 수 있습니다.");
      return;
    }
    setSelectedFile(file);
    setManualMapping({});
    setDelimiterOverride("");
    setProvenance(emptyProvenance);
    void inspectSelected(file, {}, "");
  }

  function changeMapping(role: CsvFieldRole, value: string) {
    if (!selectedFile) return;
    const next = { ...manualMapping };
    if (value === "auto") delete next[role];
    else next[role] = Number(value);
    setManualMapping(next);
    void inspectSelected(selectedFile, next, delimiterOverride);
  }

  function changeDelimiter(value: CsvDelimiter | "") {
    setDelimiterOverride(value);
    if (selectedFile) void inspectSelected(selectedFile, manualMapping, value);
  }

  async function stageDataset() {
    if (!selectedFile || !inspection || !readyToStage) return;
    setSubmission({ state: "staging" });
    try {
      const sourceBuffer = await selectedFile.arrayBuffer();
      const dataset = await readCsvDataset(sourceBuffer, {
        sourceName: selectedFile.name,
        mapping: manualMapping,
        delimiter: delimiterOverride || undefined,
        previewRows: 50,
      });
      if (!dataset.inspection.canStage || dataset.inspection.sha256 !== inspection.sha256) {
        throw new Error("staging 직전 CSV 검증 결과가 달라졌습니다. 다시 검사해 주세요.");
      }

      const response = await fetch(sameOriginEndpoint(stagingEndpoint), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-riskshield-csrf": csrfToken,
        },
        body: JSON.stringify({
          source: {
            name: selectedFile.name,
            mediaType: selectedFile.type || "text/csv",
            lastModified: new Date(selectedFile.lastModified).toISOString(),
            byteSize: dataset.inspection.byteSize,
            sha256: dataset.inspection.sha256,
            bytesBase64: arrayBufferToBase64(sourceBuffer),
          },
          inspection: {
            encoding: dataset.inspection.encoding,
            bom: dataset.inspection.bom,
            delimiter: dataset.inspection.delimiter,
            delimiterDetected: dataset.inspection.delimiterDetected,
            profile: dataset.inspection.profile,
            headers: dataset.inspection.headers,
            mapping: dataset.inspection.mapping,
            requiredFields: dataset.inspection.requiredFields,
            rowCount: dataset.inspection.rowCount,
            validRowCount: dataset.inspection.validRowCount,
            issueCounts: dataset.inspection.issueCounts,
          },
          provenance,
          warningsAcknowledged: hasWarnings ? warningsAcknowledged : false,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "Dataset Version을 staging에 등록하지 못했습니다.";
        throw new Error(message);
      }
      if (!isRecord(payload) || payload.acknowledged !== true) {
        throw new Error("서버 acknowledgement를 확인하지 못했습니다.");
      }
      setSubmission({
        state: "success",
        message: typeof payload.message === "string"
          ? payload.message
          : "서버가 staging 등록을 확인했습니다.",
        datasetVersionId: typeof payload.datasetVersionId === "string" ? payload.datasetVersionId : null,
      });
    } catch (error) {
      setSubmission({
        state: "error",
        message: error instanceof Error ? error.message : "Dataset Version을 staging에 등록하지 못했습니다.",
      });
    }
  }

  return (
    <section className="datasetConsole" aria-label="CSV 데이터 등록">
      <header className="datasetConsoleHeader">
        <div>
          <p>1단계 · 자료 등록</p>
          <h2>새 표현 자료 추가</h2>
          <p>CSV를 선택하면 형식과 개인정보 가능성을 먼저 검사합니다. 등록해도 분석 규칙으로 바로 반영되지는 않습니다.</p>
        </div>
        {developmentFixture ? <strong className="developmentDataBadge">개발 데이터</strong> : null}
      </header>

      <details className="initialCsvValidation technicalDetails">
        <summary><span><strong>기본 제공 자료 3개</strong><small>개발 확인용 파일과 해시 정보</small></span><b>열기</b></summary>
        <div className="technicalDetailsBody">
        {!initialMetadataReady ? (
          <StatePanel state="configuration-required" title="초기 CSV metadata 3건이 필요합니다." />
        ) : (
          <ProductDataTable
            caption="초기 CSV 3종 검증 metadata"
            columns={initialMetadataColumns}
            rows={initialCsvMetadata}
            getRowKey={(item) => item.id}
          />
        )}
        </div>
      </details>

      {!configured ? (
        <StatePanel
          state="configuration-required"
          title="Staging 연결 설정이 필요합니다."
          description={configurationMessage || "same-origin staging endpoint와 CSRF token이 준비되어야 등록할 수 있습니다."}
        />
      ) : null}

      <section className="datasetFileSection" aria-labelledby="dataset-file-title">
        <h3 id="dataset-file-title">CSV 파일 선택</h3>
        <div
          className="datasetDropZone"
          data-drag-active={dragActive ? "true" : "false"}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            acceptFile(event.dataTransfer.files[0]);
          }}
        >
          <strong className="datasetDropTitle">검사할 CSV를 끌어다 놓으세요</strong>
          <input
            ref={inputRef}
            id="dataset-csv-file"
            className="srOnly"
            type="file"
            accept=".csv,text/csv,text/plain"
            aria-describedby="dataset-file-help dataset-file-status"
            onChange={(event) => {
              acceptFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <p id="dataset-file-help">또는 아래 버튼으로 컴퓨터에 있는 파일을 선택하세요.</p>
          <label className="pressable secondaryButton datasetFilePicker" htmlFor="dataset-csv-file">
            {selectedFile ? "다른 CSV 선택" : "CSV 파일 선택"}
          </label>
          <p id="dataset-file-status" className="datasetSelectedFile" role="status">
            {selectedFile ? <><strong>{selectedFile.name}</strong> · {formatBytes(selectedFile.size)}</> : "선택된 파일 없음"}
          </p>
        </div>
      </section>

      {inspecting ? (
        <StatePanel state="loading" title="CSV 파일을 검사하고 있습니다." description="파일 내용과 구조가 그대로인지 확인할 때까지 기다려 주세요." />
      ) : null}
      {inspectionError ? <StatePanel state="error" title="CSV 검사 실패" description={inspectionError} /> : null}

      {inspection ? (
        <>
          <section className="datasetInspectionSummary" aria-labelledby="inspection-summary-title">
            <h3 id="inspection-summary-title">파일 검사 결과</h3>
            <ProductDefinitionList
              label="CSV 파일 metadata"
              items={[
                { key: "name", term: "파일명", description: inspection.sourceName ?? "확인되지 않음" },
                { key: "sha", term: "SHA-256", description: <code>{inspection.sha256}</code> },
                { key: "encoding", term: "Encoding", description: inspection.encoding },
                { key: "bom", term: "BOM", description: inspection.bom ?? "없음" },
                { key: "delimiter", term: "Delimiter", description: `${delimiterLabel(inspection.delimiter)} · ${inspection.delimiterDetected ? "확인됨" : "수동 확인 필요"}` },
                { key: "headers", term: "Header", description: `${inspection.headers.length.toLocaleString("ko-KR")}개 · ${inspection.headers.join(" · ") || "없음"}` },
                { key: "profile", term: "Profile", description: profileLabels[inspection.profile] },
                { key: "bytes", term: "Byte size", description: formatBytes(inspection.byteSize) },
              ]}
            />
            <ProductMetricGrid
              label="CSV 행 검사 요약"
              metrics={[
                { key: "rows", label: "전체 행", value: inspection.rowCount, numeric: true },
                { key: "valid", label: "유효 행", value: inspection.validRowCount, numeric: true, tone: "positive" },
                { key: "invalid", label: "오류 행", value: inspection.invalidRowCount, numeric: true, tone: inspection.invalidRowCount ? "critical" : "neutral" },
                { key: "blank", label: "빈 행", value: inspection.emptyRowCount, numeric: true, tone: inspection.emptyRowCount ? "critical" : "neutral" },
                { key: "required", label: "필수값 누락", value: inspection.missingRequiredValueCount, numeric: true, tone: inspection.missingRequiredValueCount ? "critical" : "neutral" },
                { key: "exact", label: "완전 중복", value: inspection.exactDuplicateCount, numeric: true, tone: inspection.exactDuplicateCount ? "warning" : "neutral" },
                { key: "normalized", label: "정규화 중복", value: inspection.normalizedDuplicateCount, numeric: true, tone: inspection.normalizedDuplicateCount ? "warning" : "neutral" },
                { key: "replacement", label: "깨진 문자", value: inspection.replacementCharacterCount, numeric: true, tone: inspection.replacementCharacterCount ? "critical" : "neutral" },
                { key: "pii", label: "개인정보 후보", value: inspection.piiCandidateCount, numeric: true, tone: inspection.piiCandidateCount ? "warning" : "neutral" },
                { key: "formula", label: "Formula 후보", value: inspection.formulaCandidateCount, numeric: true, tone: inspection.formulaCandidateCount ? "warning" : "neutral" },
              ]}
            />
          </section>

          <section className="datasetMappingSection" aria-labelledby="dataset-mapping-title">
            <h3 id="dataset-mapping-title">열 연결</h3>
            <p>Keyword는 필수입니다. 자동 감지 결과를 확인하거나 header를 직접 연결하세요.</p>
            <label>
              <span>Delimiter 확인</span>
              <select value={delimiterOverride} onChange={(event) => changeDelimiter(event.target.value as CsvDelimiter | "")} disabled={inspecting}>
                <option value="">자동 감지 ({delimiterLabel(inspection.delimiter)})</option>
                <option value=",">Comma (,)</option>
                <option value=";">Semicolon (;)</option>
                <option value="\t">Tab</option>
                <option value="|">Pipe (|)</option>
              </select>
            </label>
            <div className="datasetColumnMappingGrid">
              {CSV_FIELD_ROLES.map((role) => {
                const automatic = inspection.mapping[role];
                const manual = manualMapping[role];
                return (
                  <label key={role}>
                    <span>{fieldLabels[role]}{inspection.requiredFields.includes(role) ? " · 필수" : ""}</span>
                    <select
                      value={manual === undefined ? "auto" : String(manual)}
                      onChange={(event) => changeMapping(role, event.target.value)}
                      disabled={inspecting}
                    >
                      <option value="auto">자동 감지{automatic ? ` · ${automatic.header}` : " · 없음"}</option>
                      {inspection.headers.map((header, index) => (
                        <option key={`${index}-${header}`} value={index}>{index + 1}. {header || "빈 header"}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="datasetIssuesSection" aria-labelledby="dataset-issues-title">
            <h3 id="dataset-issues-title">검사 issue</h3>
            {inspection.issues.length ? (
              <ul className="datasetIssueList">
                {inspection.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.row ?? "all"}-${issue.column ?? "all"}-${index}`} data-severity={issue.severity}>
                    <strong>{issue.severity === "error" ? "오류" : "경고"} · {issue.code}</strong>
                    <span>{issue.message}</span>
                    {issue.row ? <small>행 {issue.row}{issue.column ? ` · 열 ${issue.column}` : ""}</small> : null}
                  </li>
                ))}
              </ul>
            ) : <StatePanel state="success" title="구조 검사 issue가 없습니다." compact />}
          </section>

          <section className="datasetPreviewSection" aria-labelledby="dataset-preview-title">
            <h3 id="dataset-preview-title">개인정보를 가린 미리보기</h3>
            <p>
              개인정보 후보는 마스킹하고 formula 후보는 문자열로 표시합니다. 최대 {inspection.previewLimit}행만 표시합니다.
              {inspection.previewTruncated ? " 전체 데이터는 preview에 포함되지 않습니다." : ""}
            </p>
            <ProductDataTable
              caption="CSV sanitized preview — 모든 열"
              columns={currentPreviewColumns}
              rows={inspection.preview}
              getRowKey={(row) => row.rowNumber}
              emptyContent="미리 볼 데이터 행이 없습니다."
              className="datasetPreviewAllColumns"
            />
          </section>

          <section className="datasetProvenanceSection" aria-labelledby="dataset-provenance-title">
            <h3 id="dataset-provenance-title">자료 출처와 이용 조건</h3>
            <div className="datasetProvenanceGrid">
              <label>
                <span>자료 책임자</span>
                <input value={provenance.owner} onChange={(event) => setProvenance((current) => ({ ...current, owner: event.target.value }))} />
              </label>
              <label>
                <span>이용 조건·라이선스</span>
                <input value={provenance.license} onChange={(event) => setProvenance((current) => ({ ...current, license: event.target.value }))} />
              </label>
              <label>
                <span>이용 가능 목적</span>
                <textarea rows={3} value={provenance.purpose} onChange={(event) => setProvenance((current) => ({ ...current, purpose: event.target.value }))} />
              </label>
              <label>
                <span>보관 기간</span>
                <input value={provenance.retention} onChange={(event) => setProvenance((current) => ({ ...current, retention: event.target.value }))} placeholder="예: 검토 종료 후 30일" />
              </label>
            </div>
          </section>

          {hasWarnings ? (
            <label className="datasetWarningAcknowledgement">
              <input type="checkbox" checked={warningsAcknowledged} onChange={(event) => setWarningsAcknowledged(event.target.checked)} />
              <span>중복·개인정보·수식 가능성 경고를 확인했으며, 등록 후에도 자동으로 분석 규칙이 되지 않음을 이해했습니다.</span>
            </label>
          ) : null}

          {!inspection.canStage ? (
            <StatePanel state="error" title="현재 CSV는 등록할 수 없습니다." description="오류 항목과 필수 표현 열 연결을 먼저 해결해 주세요." />
          ) : !provenanceComplete ? (
            <StatePanel state="configuration-required" title="자료 출처 정보가 필요합니다." description="책임자, 이용 조건, 사용 목적, 보관 기간을 모두 확인해 주세요." />
          ) : null}

          <div className="datasetStagingActions">
            <Pressable disabled={!readyToStage} onClick={() => void stageDataset()}>
              {submission.state === "staging" ? "등록 중…" : "후보 생성용 데이터로 등록"}
            </Pressable>
            <p>등록은 candidate 생성 흐름의 시작일 뿐이며 CSV 행을 active skill로 만들지 않습니다.</p>
          </div>

          <div className="datasetSubmissionStatus" aria-live="polite" aria-atomic="true">
            {submission.state === "success" ? (
              <StatePanel
                state="success"
                title="서버가 staging 등록을 확인했습니다."
                description={`${submission.message}${submission.datasetVersionId ? ` · Dataset Version ${submission.datasetVersionId}` : ""}`}
              />
            ) : null}
            {submission.state === "error" ? <StatePanel state="error" title="Staging 등록 실패" description={submission.message} /> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
