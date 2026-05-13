import path from "node:path";

import { normalizeRun, normalizeStepRows } from "../public/model.js";
import { createRunStorageKey } from "./parser.js";

export const JSON_PROGRESS_SCHEMA = "testrail-local-run-progress";
export const JSON_PROGRESS_SCHEMA_VERSION = 1;

export function parseRunProgressJson(text) {
  let payload;
  try {
    payload = JSON.parse(String(text || ""));
  } catch (error) {
    throw new Error(`Invalid JSON progress file: ${error.message}`);
  }
  return normalizeRestoredRun(payload);
}

export function normalizeRestoredRun(payload) {
  validateSchema(payload);
  const source = payload?.run && typeof payload.run === "object" ? payload.run : payload;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Incompatible JSON progress file: expected a run object.");
  }
  if (!Array.isArray(source.cases)) {
    throw new Error("Incompatible JSON progress file: run does not contain a cases array.");
  }

  const importedAt = stringOrNow(source.importedAt);
  const run = {
    ...source,
    id: restoredRunId(source),
    sourceFileName: safeSourceFileName(source.sourceFileName),
    sheetName: String(source.sheetName || "Worksheet"),
    runName: String(source.runName || source.id || "Restored run"),
    runId: String(source.runId || ""),
    importedAt,
    columns: Array.isArray(source.columns) ? source.columns : [],
    cases: source.cases.map((testCase, index) => normalizeRestoredCase(testCase, index, importedAt))
  };

  return normalizeRun(run);
}

function validateSchema(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }
  if (payload.schema && payload.schema !== JSON_PROGRESS_SCHEMA) {
    throw new Error(`Unsupported JSON progress schema: ${payload.schema}`);
  }
  const version = payload.schemaVersion ?? (payload.schema ? payload.version : undefined);
  if (version != null && Number(version) !== JSON_PROGRESS_SCHEMA_VERSION) {
    throw new Error(`Unsupported JSON progress schema version: ${version}`);
  }
}

function normalizeRestoredCase(testCase, index, importedAt) {
  if (!testCase || typeof testCase !== "object" || Array.isArray(testCase)) {
    throw new Error(`Incompatible JSON progress file: case ${index + 1} is not an object.`);
  }
  if (!testCase.rawRow || typeof testCase.rawRow !== "object" || Array.isArray(testCase.rawRow)) {
    throw new Error(`Incompatible JSON progress file: case ${index + 1} is missing rawRow.`);
  }

  const originalStatus = stringValue(testCase.originalStatus ?? testCase.rawRow.Status);
  return {
    ...testCase,
    localId: stringValue(testCase.localId || testCase.testId || testCase.caseId || `row-${index + 1}`),
    originalStatus,
    currentStatus: stringValue(testCase.currentStatus || originalStatus || "Untested"),
    localNotes: stringValue(testCase.localNotes),
    localDefects: stringValue(testCase.localDefects),
    localEvidence: stringValue(testCase.localEvidence),
    updatedAt: stringValue(testCase.updatedAt || importedAt),
    rawRow: testCase.rawRow,
    steps: normalizeStepRows(testCase.steps)
  };
}

function restoredRunId(run) {
  const explicitId = stringValue(run.id);
  if (explicitId && !path.isAbsolute(explicitId) && !explicitId.includes("/") && !explicitId.includes("\\")) {
    return explicitId;
  }
  return createRunStorageKey(run.runId, run.runName || run.sourceFileName || "restored-run", run.sheetName || "Worksheet");
}

function safeSourceFileName(value) {
  const sourceFileName = stringValue(value);
  return sourceFileName ? path.basename(sourceFileName) : "restored-json";
}

function stringOrNow(value) {
  return stringValue(value) || new Date().toISOString();
}

function stringValue(value) {
  return value == null ? "" : String(value);
}
