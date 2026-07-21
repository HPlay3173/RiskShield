import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INTERPRETER_JSON_SCHEMA,
  INTERPRETER_SCHEMA_VERSION,
  prepareInterpreterInput,
  validateInterpreterPayload,
// @ts-expect-error Node 22 strips TypeScript directly and requires this runtime extension.
} from "../lib/v0-4/interpreter.ts";

const inputText = "효과를 보장합니다";

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(
    new URL(`./fixtures/v0-4/${name}`, import.meta.url),
    "utf8",
  )) as Record<string, unknown>;
}

function currentFixture(): Record<string, unknown> {
  return {
    ...readFixture("interpreter-payload.schema-1.1.0.json"),
    schema_version: INTERPRETER_SCHEMA_VERSION,
  };
}

test("Schema 1.0.0 legacy compatibility fixture is preserved and rejected by the strict 1.2.0 validator", () => {
  const legacy = readFixture("interpreter-payload.schema-1.0.0.json");
  assert.equal(legacy.schema_version, "1.0.0");
  assert.equal("policy_relevance" in legacy, false);
  assert.equal("risk_family" in legacy, false);

  const result = validateInterpreterPayload(legacy, prepareInterpreterInput(inputText));
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.errors.join(" "), /schema_version이 1[.]2[.]0이 아닙니다/u);
    assert.match(result.errors.join(" "), /필수 필드 누락: policy_relevance/u);
    assert.match(result.errors.join(" "), /필수 필드 누락: risk_family/u);
  }
});

test("Schema 1.2.0 accepts the current context-risk payload shape", () => {
  const current = currentFixture();
  const result = validateInterpreterPayload(current, prepareInterpreterInput(inputText));
  assert.equal(result.success, true);
  assert.equal(current.schema_version, INTERPRETER_SCHEMA_VERSION);

  const required = INTERPRETER_JSON_SCHEMA.required as string[];
  assert.ok(required.includes("policy_relevance"));
  assert.ok(required.includes("risk_family"));
});

test("Schema 1.2.0 rejects a payload missing policy_relevance", () => {
  const current = currentFixture();
  delete current.policy_relevance;
  const result = validateInterpreterPayload(current, prepareInterpreterInput(inputText));
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.errors.join(" "), /필수 필드 누락: policy_relevance/u);
});

test("Schema 1.2.0 rejects a payload missing risk_family", () => {
  const current = currentFixture();
  delete current.risk_family;
  const result = validateInterpreterPayload(current, prepareInterpreterInput(inputText));
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.errors.join(" "), /필수 필드 누락: risk_family/u);
});

test("Mixed Schema 1.0.0 version with 1.2.0 fields is rejected explicitly", () => {
  const mixed = {
    ...currentFixture(),
    schema_version: "1.0.0",
  };
  const result = validateInterpreterPayload(mixed, prepareInterpreterInput(inputText));
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.errors.join(" "), /schema_version이 1[.]2[.]0이 아닙니다/u);
});

test("Mixed Schema 1.2.0 version with the legacy 1.0.0 shape is rejected explicitly", () => {
  const mixed = {
    ...readFixture("interpreter-payload.schema-1.0.0.json"),
    schema_version: INTERPRETER_SCHEMA_VERSION,
  };
  const result = validateInterpreterPayload(mixed, prepareInterpreterInput(inputText));
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.errors.join(" "), /필수 필드 누락: policy_relevance/u);
    assert.match(result.errors.join(" "), /필수 필드 누락: risk_family/u);
  }
});
