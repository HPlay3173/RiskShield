import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CsvInspectionError,
  inspectCsv,
  readCsvDataset,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/datasets/csv.ts";

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

test("UTF-8 BOM and Korean headers produce a byte-exact immutable inspection", async () => {
  const source = [
    "\ufeff키워드 (Keyword),어원/원단어 (Root_Word),분류 (Category)",
    "과장 문구,과장,광고",
    "다른 문구,다른,광고",
  ].join("\r\n");
  const bytes = utf8(source);
  const inspection = await inspectCsv(bytes, { sourceName: "korean.csv" });

  assert.equal(inspection.bom, "utf-8");
  assert.equal(inspection.encoding, "utf-8");
  assert.equal(inspection.delimiter, ",");
  assert.equal(inspection.profile, "controversy");
  assert.equal(inspection.mapping.keyword?.header, "키워드 (Keyword)");
  assert.equal(inspection.mapping.root?.header, "어원/원단어 (Root_Word)");
  assert.equal(inspection.mapping.category?.header, "분류 (Category)");
  assert.equal(inspection.rowCount, 2);
  assert.equal(inspection.validRowCount, 2);
  assert.equal(inspection.canStage, true);
  assert.equal(
    inspection.sha256,
    createHash("sha256").update(bytes).digest("hex"),
    "the hash must include the original BOM and line endings",
  );
});

test("RFC 4180 quoted commas, escaped quotes, and embedded newlines remain in one record", async () => {
  const source = [
    "Keyword,Category,Reason",
    '"문구, 하나",일반,"첫 줄',
    '둘째 ""인용"" 줄"',
  ].join("\r\n");
  const dataset = await readCsvDataset(utf8(source));

  assert.equal(dataset.inspection.rowCount, 1);
  assert.equal(dataset.inspection.validRowCount, 1);
  assert.equal(dataset.rows[0].mapped.keyword, "문구, 하나");
  assert.equal(dataset.rows[0].values[2], '첫 줄\r\n둘째 "인용" 줄');
});

test("malformed quotes and row-width drift are errors instead of silently valid rows", async () => {
  const malformed = await inspectCsv(utf8('Keyword,Category\n"닫히지 않음,일반'));
  assert.equal(malformed.canStage, false);
  assert.equal(malformed.issueCounts.malformed_quote, 1);

  const widthDrift = await inspectCsv(utf8("Keyword,Category\n문구,일반,초과\n정상,일반"));
  assert.equal(widthDrift.canStage, false);
  assert.equal(widthDrift.rowCount, 2);
  assert.equal(widthDrift.invalidRowCount, 1);
  assert.equal(widthDrift.issueCounts.row_width_mismatch, 1);
});

test("delimiter and header validation require unambiguous columns", async () => {
  const inspection = await inspectCsv(utf8("Keyword;Keyword\n하나;둘"));
  assert.equal(inspection.delimiter, ";");
  assert.equal(inspection.delimiterDetected, true);
  assert.equal(inspection.canStage, false);
  assert.equal(inspection.issueCounts.duplicate_header, 1);
  assert.equal(inspection.issueCounts.ambiguous_column_mapping, 1);
});

test("an explicit keyword mapping overrides an unknown source header", async () => {
  const bytes = utf8("표제,분류\n검토 문구,일반");
  const automatic = await inspectCsv(bytes);
  assert.equal(automatic.canStage, false);
  assert.equal(automatic.mapping.keyword, undefined);

  const manual = await inspectCsv(bytes, { mapping: { keyword: "표제", category: 1 } });
  assert.equal(manual.canStage, true);
  assert.equal(manual.mapping.keyword?.source, "manual");
  assert.equal(manual.mapping.keyword?.index, 0);
});

test("all 10,000 rows are processed while preview output stays capped at 50", async () => {
  const rows = ["Keyword,Category"];
  for (let index = 0; index < 10_000; index += 1) rows.push(`표현-${index},일반`);
  const inspection = await inspectCsv(utf8(rows.join("\n")), { previewRows: 500 });

  assert.equal(inspection.rowCount, 10_000);
  assert.equal(inspection.validRowCount, 10_000);
  assert.equal(inspection.invalidRowCount, 0);
  assert.equal(inspection.preview.length, 50);
  assert.equal(inspection.previewLimit, 50);
  assert.equal(inspection.previewTruncated, true);
});

test("empty values, duplicate forms, formula cells, PII, and replacement characters are classified", async () => {
  const source = [
    "Keyword,Category",
    "위험 문구,일반",
    "위험 문구,일반",
    "위험   문구,일반",
    ",일반",
    '"=SUM(1,2)",일반',
    "test@example.com,일반",
    "깨짐\ufffd,일반",
  ].join("\n");
  const inspection = await inspectCsv(utf8(source));

  assert.equal(inspection.exactDuplicateCount, 1);
  assert.equal(inspection.normalizedDuplicateCount, 1);
  assert.equal(inspection.missingRequiredValueCount, 1);
  assert.equal(inspection.formulaCandidateCount, 1);
  assert.equal(inspection.piiCandidateCount, 1);
  assert.equal(inspection.replacementCharacterCount, 1);
  assert.equal(inspection.invalidRowCount, 2);

  const formula = inspection.preview.find((row) => row.flags.includes("formula_candidate"));
  assert.ok(formula?.cells[0].startsWith("'="), "formula preview must be neutralized");
  const pii = inspection.preview.find((row) => row.flags.includes("pii_candidate"));
  assert.equal(pii?.cells[0], "[email]");
  assert.doesNotMatch(JSON.stringify(inspection.issues), /test@example[.]com/u);
});

test("invalid UTF-8 and UTF-16 input fail before lossy decoding", async () => {
  await assert.rejects(
    inspectCsv(new Uint8Array([0x4b, 0x65, 0x79, 0x77, 0x6f, 0x72, 0x64, 0x0a, 0xc3, 0x28])),
    (error: unknown) => error instanceof CsvInspectionError && error.code === "invalid_utf8",
  );
  await assert.rejects(
    inspectCsv(new Uint8Array([0xff, 0xfe, 0x4b, 0x00])),
    (error: unknown) => error instanceof CsvInspectionError && error.code === "unsupported_encoding",
  );
});
