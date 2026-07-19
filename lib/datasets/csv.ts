export const CSV_PREVIEW_LIMIT = 50;

export const CSV_FIELD_ROLES = [
  "id",
  "keyword",
  "root",
  "category",
  "matchingType",
  "severity",
  "reason",
  "alternative",
] as const;

export type CsvFieldRole = (typeof CSV_FIELD_ROLES)[number];
export type CsvDelimiter = "," | ";" | "\t" | "|";
export type CsvProfile = "controversy" | "false_advertising" | "hate_speech" | "generic";
export type CsvColumnSelector = string | number;
export type CsvManualMapping = Partial<Record<CsvFieldRole, CsvColumnSelector>>;

export type CsvIssueCode =
  | "ambiguous_column_mapping"
  | "blank_header"
  | "blank_row"
  | "duplicate_header"
  | "duplicate_keyword"
  | "formula_candidate"
  | "invalid_column_mapping"
  | "malformed_quote"
  | "missing_header"
  | "missing_keyword_mapping"
  | "missing_required_value"
  | "normalized_duplicate_keyword"
  | "pii_candidate"
  | "replacement_character"
  | "row_width_mismatch"
  | "unconfirmed_delimiter";

export interface CsvIssue {
  code: CsvIssueCode;
  severity: "error" | "warning";
  message: string;
  row?: number;
  column?: number;
}

export interface CsvColumnMappingEntry {
  index: number;
  header: string;
  source: "auto" | "manual";
}

export type CsvColumnMapping = Partial<Record<CsvFieldRole, CsvColumnMappingEntry>>;

export type CsvRowFlag =
  | "formula_candidate"
  | "normalized_duplicate"
  | "exact_duplicate"
  | "pii_candidate"
  | "replacement_character";

export interface CsvPreviewRow {
  rowNumber: number;
  cells: string[];
  valid: boolean;
  flags: CsvRowFlag[];
}

export interface CsvInspection {
  sourceName: string | null;
  byteSize: number;
  sha256: string;
  encoding: "utf-8";
  bom: "utf-8" | null;
  delimiter: CsvDelimiter;
  delimiterDetected: boolean;
  profile: CsvProfile;
  headers: string[];
  mapping: CsvColumnMapping;
  requiredFields: CsvFieldRole[];
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  emptyRowCount: number;
  missingRequiredValueCount: number;
  exactDuplicateCount: number;
  normalizedDuplicateCount: number;
  replacementCharacterCount: number;
  formulaCandidateCount: number;
  piiCandidateCount: number;
  preview: CsvPreviewRow[];
  previewLimit: number;
  previewTruncated: boolean;
  issues: CsvIssue[];
  issueCounts: Record<string, number>;
  canStage: boolean;
}

export interface CsvDatasetRow {
  rowNumber: number;
  values: string[];
  mapped: Partial<Record<CsvFieldRole, string>>;
  flags: CsvRowFlag[];
}

export interface CsvDataset {
  inspection: CsvInspection;
  rows: CsvDatasetRow[];
}

export interface InspectCsvOptions {
  sourceName?: string;
  delimiter?: CsvDelimiter;
  mapping?: CsvManualMapping;
  requiredFields?: CsvFieldRole[];
  previewRows?: number;
}

export class CsvInspectionError extends Error {
  readonly code: "invalid_utf8" | "unsupported_encoding";

  constructor(code: CsvInspectionError["code"], message: string) {
    super(message);
    this.name = "CsvInspectionError";
    this.code = code;
  }
}

interface ParsedRecord {
  recordNumber: number;
  physicalLine: number;
  cells: string[];
}

const DELIMITER_CANDIDATES: readonly CsvDelimiter[] = [",", "\t", ";", "|"];
const MAX_DIAGNOSTICS = 200;
const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/iu;
const PHONE_PATTERN = /(?<!\d)(?:\+?82[ -]?)?0?1[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/u;
const RESIDENT_ID_PATTERN = /(?<!\d)\d{6}[ -]?[1-4]\d{6}(?!\d)/u;
const FORMULA_PATTERN = /^[=+\-@]/u;

class IssueCollector {
  readonly issues: CsvIssue[] = [];
  readonly counts: Record<string, number> = {};
  hasErrors = false;

  add(issue: CsvIssue) {
    this.counts[issue.code] = (this.counts[issue.code] ?? 0) + 1;
    if (issue.severity === "error") this.hasErrors = true;
    if (this.issues.length < MAX_DIAGNOSTICS) this.issues.push(issue);
  }
}

function toBytes(input: Uint8Array | ArrayBuffer) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

async function sha256Hex(bytes: Uint8Array) {
  const stableBuffer = Uint8Array.from(bytes).buffer;
  const digest = await crypto.subtle.digest("SHA-256", stableBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function decodeUtf8(bytes: Uint8Array) {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    throw new CsvInspectionError("unsupported_encoding", "UTF-8 CSV만 지원합니다.");
  }

  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const content = hasBom ? bytes.slice(3) : bytes;
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(content),
      bom: hasBom ? ("utf-8" as const) : null,
    };
  } catch {
    throw new CsvInspectionError("invalid_utf8", "CSV를 손실 없이 UTF-8로 해석할 수 없습니다.");
  }
}

function delimiterCounts(text: string) {
  const counts = new Map<CsvDelimiter, number>(DELIMITER_CANDIDATES.map((value) => [value, 0]));
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted && character === '"' && next === '"') {
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (character === "\r" || character === "\n")) break;
    if (!quoted && counts.has(character as CsvDelimiter)) {
      const delimiter = character as CsvDelimiter;
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }
  return counts;
}

function detectDelimiter(text: string): { delimiter: CsvDelimiter; detected: boolean } {
  const counts = delimiterCounts(text);
  const ordered = [...counts.entries()].sort((left, right) => {
    if (left[1] !== right[1]) return right[1] - left[1];
    return DELIMITER_CANDIDATES.indexOf(left[0]) - DELIMITER_CANDIDATES.indexOf(right[0]);
  });
  const best = ordered[0] ?? [",", 0];
  return { delimiter: best[0], detected: best[1] > 0 };
}

function parseCsvRecords(text: string, delimiter: CsvDelimiter, collector: IssueCollector) {
  const records: ParsedRecord[] = [];
  const invalidRecordNumbers = new Set<number>();
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let recordStarted = false;
  let physicalLine = 1;
  let recordStartLine = 1;
  let recordNumber = 1;

  const finishField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
    recordStarted = true;
  };

  const finishRecord = () => {
    finishField();
    records.push({ recordNumber, physicalLine: recordStartLine, cells: row });
    row = [];
    recordNumber += 1;
    recordStartLine = physicalLine + 1;
    recordStarted = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      recordStarted = true;
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
        afterQuote = true;
      } else {
        field += character;
        if (character === "\n" || (character === "\r" && next !== "\n")) physicalLine += 1;
      }
      continue;
    }

    if (afterQuote) {
      if (character === delimiter) {
        finishField();
        continue;
      }
      if (character === "\r" || character === "\n") {
        finishRecord();
        if (character === "\r" && next === "\n") index += 1;
        physicalLine += 1;
        recordStartLine = physicalLine;
        continue;
      }
      collector.add({
        code: "malformed_quote",
        severity: "error",
        message: "닫는 따옴표 뒤에는 구분자나 줄바꿈만 올 수 있습니다.",
        row: recordNumber,
        column: row.length + 1,
      });
      invalidRecordNumbers.add(recordNumber);
      afterQuote = false;
      field += character;
      recordStarted = true;
      continue;
    }

    if (character === '"') {
      if (field.length === 0) {
        inQuotes = true;
        recordStarted = true;
      } else {
        collector.add({
          code: "malformed_quote",
          severity: "error",
          message: "인용되지 않은 필드 중간에 따옴표가 있습니다.",
          row: recordNumber,
          column: row.length + 1,
        });
        invalidRecordNumbers.add(recordNumber);
        field += character;
      }
      continue;
    }

    if (character === delimiter) {
      finishField();
      continue;
    }

    if (character === "\r" || character === "\n") {
      finishRecord();
      if (character === "\r" && next === "\n") index += 1;
      physicalLine += 1;
      recordStartLine = physicalLine;
      continue;
    }

    field += character;
    recordStarted = true;
  }

  if (inQuotes) {
    collector.add({
      code: "malformed_quote",
      severity: "error",
      message: "닫히지 않은 따옴표 필드가 있습니다.",
      row: recordNumber,
      column: row.length + 1,
    });
    invalidRecordNumbers.add(recordNumber);
  }
  if (recordStarted || row.length > 0 || field.length > 0 || afterQuote || inQuotes) finishRecord();
  return { records, invalidRecordNumbers };
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeDatasetExpression(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function profileFor(headers: readonly string[]): CsvProfile {
  const key = headers.map(normalizeHeader).join("|");
  if (key.includes("matchingtype")) return "hate_speech";
  if (key.includes("어원원단어")) return "controversy";
  if (key.includes("rootword") || key.includes("원단어")) return "false_advertising";
  return "generic";
}

const ROLE_PATTERNS: Record<CsvFieldRole, RegExp> = {
  id: /^(?:id|식별자)$/u,
  keyword: /(?:keyword|키워드|표현|문구)/u,
  root: /(?:rootword|어원|원단어)/u,
  category: /(?:category|분류|카테고리)/u,
  matchingType: /(?:matchingtype|매칭유형|일치유형)/u,
  severity: /(?:severity|심각도|위험도)/u,
  reason: /(?:reason|이유|근거)/u,
  alternative: /(?:alternative|대체문구|대안)/u,
};

function resolveManualColumn(selector: CsvColumnSelector, headers: readonly string[]) {
  if (typeof selector === "number") {
    return Number.isInteger(selector) && selector >= 0 && selector < headers.length ? selector : -1;
  }
  const exact = headers.findIndex((header) => header === selector);
  if (exact >= 0) return exact;
  const normalized = normalizeHeader(selector);
  const matches = headers
    .map((header, index) => ({ header: normalizeHeader(header), index }))
    .filter((entry) => entry.header === normalized);
  return matches.length === 1 ? matches[0].index : -1;
}

function buildMapping(
  headers: readonly string[],
  manual: CsvManualMapping | undefined,
  collector: IssueCollector,
): CsvColumnMapping {
  const mapping: CsvColumnMapping = {};
  const normalizedHeaders = headers.map(normalizeHeader);

  for (const role of CSV_FIELD_ROLES) {
    if (manual && Object.prototype.hasOwnProperty.call(manual, role)) {
      const selector = manual[role];
      const index = selector === undefined ? -1 : resolveManualColumn(selector, headers);
      if (index < 0) {
        collector.add({
          code: "invalid_column_mapping",
          severity: role === "keyword" ? "error" : "warning",
          message: `${role} 열 연결을 찾을 수 없습니다.`,
        });
      } else {
        mapping[role] = { index, header: headers[index], source: "manual" };
      }
      continue;
    }

    const matches = normalizedHeaders
      .map((header, index) => ({ header, index }))
      .filter((entry) => ROLE_PATTERNS[role].test(entry.header));
    if (matches.length === 1) {
      const index = matches[0].index;
      mapping[role] = { index, header: headers[index], source: "auto" };
    } else if (matches.length > 1) {
      collector.add({
        code: "ambiguous_column_mapping",
        severity: role === "keyword" ? "error" : "warning",
        message: `${role} 후보 열이 여러 개입니다. 수동 연결이 필요합니다.`,
      });
    }
  }

  if (!mapping.keyword) {
    collector.add({
      code: "missing_keyword_mapping",
      severity: "error",
      message: "분석할 keyword 열을 명시적으로 연결해야 합니다.",
    });
  }
  return mapping;
}

function defaultRequiredFields(profile: CsvProfile): CsvFieldRole[] {
  if (profile === "controversy" || profile === "false_advertising") {
    return ["keyword", "root", "category"];
  }
  if (profile === "hate_speech") {
    return ["id", "keyword", "category", "matchingType", "severity", "reason", "alternative"];
  }
  return ["keyword"];
}

function containsPiiCandidate(value: string) {
  return EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value) || RESIDENT_ID_PATTERN.test(value);
}

function sanitizePreviewCell(value: string) {
  let sanitized = value
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu, "[email]")
    .replace(/(?<!\d)(?:\+?82[ -]?)?0?1[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/gu, "[phone]")
    .replace(/(?<!\d)\d{6}[ -]?[1-4]\d{6}(?!\d)/gu, "[identifier]")
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  if (FORMULA_PATTERN.test(sanitized)) sanitized = `'${sanitized}`;
  if (sanitized.length > 160) sanitized = `${sanitized.slice(0, 159)}…`;
  return sanitized;
}

function mappedValues(cells: readonly string[], mapping: CsvColumnMapping) {
  const mapped: Partial<Record<CsvFieldRole, string>> = {};
  for (const role of CSV_FIELD_ROLES) {
    const entry = mapping[role];
    if (entry) mapped[role] = cells[entry.index] ?? "";
  }
  return mapped;
}

async function analyzeCsv(
  input: Uint8Array | ArrayBuffer,
  options: InspectCsvOptions,
): Promise<CsvDataset> {
  const bytes = toBytes(input);
  const sha256 = await sha256Hex(bytes);
  const decoded = decodeUtf8(bytes);
  const collector = new IssueCollector();
  const detected = detectDelimiter(decoded.text);
  const delimiter = options.delimiter ?? detected.delimiter;
  const delimiterDetected = options.delimiter !== undefined || detected.detected;
  if (!delimiterDetected) {
    collector.add({
      code: "unconfirmed_delimiter",
      severity: "warning",
      message: "구분자를 자동 확인하지 못했습니다. 파일 설정에서 직접 확인해 주세요.",
    });
  }

  const parsed = parseCsvRecords(decoded.text, delimiter, collector);
  const records = parsed.records;
  const headerRecord = records[0];
  const headers = headerRecord?.cells.map((header) => header.trim()) ?? [];
  if (!headerRecord || headers.length === 0) {
    collector.add({ code: "missing_header", severity: "error", message: "CSV header가 필요합니다." });
  }

  const seenHeaders = new Set<string>();
  headers.forEach((header, index) => {
    if (!header) {
      collector.add({
        code: "blank_header",
        severity: "error",
        message: "비어 있는 header가 있습니다.",
        row: 1,
        column: index + 1,
      });
      return;
    }
    const normalized = normalizeHeader(header);
    if (seenHeaders.has(normalized)) {
      collector.add({
        code: "duplicate_header",
        severity: "error",
        message: "중복 header가 있습니다.",
        row: 1,
        column: index + 1,
      });
    }
    seenHeaders.add(normalized);
  });

  const profile = profileFor(headers);
  const mapping = buildMapping(headers, options.mapping, collector);
  const requiredFields = options.requiredFields ?? defaultRequiredFields(profile);
  for (const role of requiredFields) {
    if (!mapping[role]) {
      collector.add({
        code: "invalid_column_mapping",
        severity: "error",
        message: `필수 필드 ${role}의 열 연결이 필요합니다.`,
      });
    }
  }

  const parserInvalidRows = parsed.invalidRecordNumbers;
  const previewLimit = Math.max(0, Math.min(CSV_PREVIEW_LIMIT, options.previewRows ?? CSV_PREVIEW_LIMIT));
  const preview: CsvPreviewRow[] = [];
  const datasetRows: CsvDatasetRow[] = [];
  const seenExact = new Set<string>();
  const seenNormalized = new Set<string>();
  let validRowCount = 0;
  let invalidRowCount = 0;
  let emptyRowCount = 0;
  let missingRequiredValueCount = 0;
  let exactDuplicateCount = 0;
  let normalizedDuplicateCount = 0;
  let replacementCharacterCount = 0;
  let formulaCandidateCount = 0;
  let piiCandidateCount = 0;

  const dataRecords = records.slice(1);
  for (const record of dataRecords) {
    const flags = new Set<CsvRowFlag>();
    let valid = !parserInvalidRows.has(record.recordNumber);
    const blank = record.cells.every((cell) => !cell.trim());
    if (blank) {
      emptyRowCount += 1;
      valid = false;
      collector.add({
        code: "blank_row",
        severity: "error",
        message: "비어 있는 데이터 행입니다.",
        row: record.recordNumber,
      });
    }
    if (record.cells.length !== headers.length) {
      valid = false;
      collector.add({
        code: "row_width_mismatch",
        severity: "error",
        message: `열 수가 header ${headers.length}개와 일치하지 않습니다.`,
        row: record.recordNumber,
      });
    }

    const mapped = mappedValues(record.cells, mapping);
    for (const role of requiredFields) {
      if (mapping[role] && !mapped[role]?.trim()) {
        missingRequiredValueCount += 1;
        valid = false;
        collector.add({
          code: "missing_required_value",
          severity: "error",
          message: `필수 값 ${role}이 비어 있습니다.`,
          row: record.recordNumber,
          column: (mapping[role]?.index ?? 0) + 1,
        });
      }
    }

    record.cells.forEach((cell, columnIndex) => {
      if (cell.includes("\ufffd")) {
        replacementCharacterCount += 1;
        flags.add("replacement_character");
        valid = false;
        collector.add({
          code: "replacement_character",
          severity: "error",
          message: "깨진 문자 후보(U+FFFD)가 있습니다.",
          row: record.recordNumber,
          column: columnIndex + 1,
        });
      }
      if (FORMULA_PATTERN.test(cell.trimStart())) {
        formulaCandidateCount += 1;
        flags.add("formula_candidate");
        collector.add({
          code: "formula_candidate",
          severity: "warning",
          message: "스프레드시트 수식으로 해석될 수 있는 값이 있습니다.",
          row: record.recordNumber,
          column: columnIndex + 1,
        });
      }
      if (containsPiiCandidate(cell)) {
        piiCandidateCount += 1;
        flags.add("pii_candidate");
        collector.add({
          code: "pii_candidate",
          severity: "warning",
          message: "개인정보 후보가 있어 검토가 필요합니다.",
          row: record.recordNumber,
          column: columnIndex + 1,
        });
      }
    });

    const keyword = mapped.keyword?.trim() ?? "";
    if (valid && keyword) {
      const normalized = normalizeDatasetExpression(keyword);
      if (seenExact.has(keyword)) {
        exactDuplicateCount += 1;
        flags.add("exact_duplicate");
        collector.add({
          code: "duplicate_keyword",
          severity: "warning",
          message: "동일한 keyword가 이미 있습니다.",
          row: record.recordNumber,
          column: (mapping.keyword?.index ?? 0) + 1,
        });
      } else if (seenNormalized.has(normalized)) {
        normalizedDuplicateCount += 1;
        flags.add("normalized_duplicate");
        collector.add({
          code: "normalized_duplicate_keyword",
          severity: "warning",
          message: "정규화하면 동일한 keyword가 이미 있습니다.",
          row: record.recordNumber,
          column: (mapping.keyword?.index ?? 0) + 1,
        });
      }
      seenExact.add(keyword);
      seenNormalized.add(normalized);
    }

    if (valid) {
      validRowCount += 1;
      datasetRows.push({
        rowNumber: record.recordNumber,
        values: [...record.cells],
        mapped,
        flags: [...flags],
      });
    } else {
      invalidRowCount += 1;
    }

    if (preview.length < previewLimit) {
      preview.push({
        rowNumber: record.recordNumber,
        cells: record.cells.map(sanitizePreviewCell),
        valid,
        flags: [...flags],
      });
    }
  }

  const inspection: CsvInspection = {
    sourceName: options.sourceName ?? null,
    byteSize: bytes.byteLength,
    sha256,
    encoding: "utf-8",
    bom: decoded.bom,
    delimiter,
    delimiterDetected,
    profile,
    headers,
    mapping,
    requiredFields,
    rowCount: dataRecords.length,
    validRowCount,
    invalidRowCount,
    emptyRowCount,
    missingRequiredValueCount,
    exactDuplicateCount,
    normalizedDuplicateCount,
    replacementCharacterCount,
    formulaCandidateCount,
    piiCandidateCount,
    preview,
    previewLimit,
    previewTruncated: dataRecords.length > preview.length,
    issues: collector.issues,
    issueCounts: collector.counts,
    canStage: !collector.hasErrors && Boolean(mapping.keyword),
  };
  return { inspection, rows: datasetRows };
}

export async function inspectCsv(
  input: Uint8Array | ArrayBuffer,
  options: InspectCsvOptions = {},
): Promise<CsvInspection> {
  return (await analyzeCsv(input, options)).inspection;
}

export async function readCsvDataset(
  input: Uint8Array | ArrayBuffer,
  options: InspectCsvOptions = {},
): Promise<CsvDataset> {
  return analyzeCsv(input, options);
}
