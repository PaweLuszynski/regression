import path from "node:path";

import { normalizeRun, normalizeStepRows, parseSteps } from "../public/model.js";
import { createRunStorageKey, LOCAL_STATUSES } from "./parser.js";

const REQUIRED_COLUMN_GROUPS = [
  ["ID", "Test ID", "TestId", "testId"],
  ["Title", "title"],
  ["Current Status", "currentStatus", "Status", "status"]
];

const FIELD_ALIASES = {
  testId: ["ID", "Test ID", "TestId", "testId"],
  caseId: ["Case ID", "CaseId", "caseId"],
  title: ["Title", "title"],
  section: ["Section", "section"],
  sectionHierarchy: ["Section Hierarchy", "sectionHierarchy"],
  originalStatus: ["Original Status", "originalStatus"],
  currentStatus: ["Current Status", "currentStatus", "Status", "status"],
  localNotes: ["Local Notes", "localNotes", "Notes"],
  localDefects: ["Local Defects", "localDefects", "Defects"],
  localEvidence: ["Local Evidence", "localEvidence", "Evidence"],
  localStepStatuses: ["Local Step Statuses", "localStepStatuses"],
  updatedAt: ["Updated At", "updatedAt"],
  runId: ["Run ID", "runId"],
  runName: ["Run Name", "runName"],
  sheetName: ["Sheet Name", "sheetName"],
  sourceFileName: ["Source File Name", "sourceFileName"],
  assignedTo: ["Assigned To", "assignedTo"],
  priority: ["Priority", "priority"],
  type: ["Type", "type"],
  template: ["Template", "template"],
  references: ["References", "references"],
  testedBy: ["Tested By", "testedBy"],
  testedOn: ["Tested On", "testedOn"],
  preconditions: ["Preconditions", "preconditions"],
  expectedResult: ["Expected Result", "expectedResult"],
  stepsCombined: ["Steps", "stepsCombined"],
  stepsStep: ["Steps (Step)", "stepsStep"],
  stepsExpectedResult: ["Steps (Expected Result)", "stepsExpectedResult"],
  stepsStatus: ["Steps (Status)", "stepsStatus"],
  testCaseLabels: ["Test Case Labels", "testCaseLabels"],
  testLabels: ["Test Labels", "testLabels"],
  importedComment: ["Comment", "importedComment"],
  importedDefects: ["Defects", "importedDefects"]
};

export function parseRunProgressCsv(text, options = {}) {
  const records = parseCsvRecords(String(text || ""));
  if (records.length === 0) {
    throw new Error("Invalid CSV progress file: no rows were detected.");
  }
  const headers = records[0].map((value) => String(value || "").trim());
  if (headers.every((header) => !header)) {
    throw new Error("Invalid CSV progress file: no headers were detected.");
  }
  const dataRows = records.slice(1).filter((row) => row.some((value) => String(value || "").trim() !== ""));
  if (dataRows.length === 0) {
    throw new Error("Invalid CSV progress file: no test case rows were detected.");
  }

  validateHeaders(headers);
  return normalizeRestoredCsvRun(headers, dataRows, options);
}

export function normalizeRestoredCsvRun(headers, dataRows, options = {}) {
  const rows = dataRows.map((row, index) => rowToObject(headers, row, index));
  const runId = firstNonEmpty(rows.map((row) => getField(row, "runId")));
  const runName = firstNonEmpty(rows.map((row) => getField(row, "runName"))) || "CSV Restored Run";
  const sourceFileName = safeSourceFileName(
    firstNonEmpty(rows.map((row) => getField(row, "sourceFileName"))) ||
    options.sourceFileName ||
    "restored.csv"
  );
  const sheetName = firstNonEmpty(rows.map((row) => getField(row, "sheetName"))) || "CSV";
  const importedAt = new Date().toISOString();
  const id = createRunStorageKey(runId, runName || sourceFileName, sheetName);

  const cases = rows.map((rawRow, index) => {
    const testId = valueOrEmpty(getField(rawRow, "testId"));
    const caseId = valueOrEmpty(getField(rawRow, "caseId"));
    const currentStatus = normalizeStatus(valueOrEmpty(getField(rawRow, "currentStatus")) || "Untested");
    const originalStatusRaw = valueOrEmpty(getField(rawRow, "originalStatus"));
    const originalStatus = normalizeStatus(originalStatusRaw || currentStatus || "Untested");
    const importedStepRows = parseSteps(rawRow, { availableStatuses: LOCAL_STATUSES });
    const steps = applyLocalStepStatuses(
      normalizeStepRows(importedStepRows, LOCAL_STATUSES),
      valueOrEmpty(getField(rawRow, "localStepStatuses"))
    );
    const explicitStep = valueOrEmpty(getField(rawRow, "stepsStep"));
    const explicitExpected = valueOrEmpty(getField(rawRow, "stepsExpectedResult"));
    const fallbackSteps = valueOrEmpty(getField(rawRow, "stepsCombined"));
    const stepsCombined = explicitStep || explicitExpected
      ? [explicitStep, explicitExpected].filter(Boolean).join("\n\nExpected Result:\n")
      : fallbackSteps;

    return {
      localId: testId || caseId || `row-${index + 2}`,
      testId,
      caseId,
      title: valueOrEmpty(getField(rawRow, "title")),
      assignedTo: valueOrEmpty(getField(rawRow, "assignedTo")),
      priority: valueOrEmpty(getField(rawRow, "priority")),
      section: valueOrEmpty(getField(rawRow, "section")),
      sectionHierarchy: valueOrEmpty(getField(rawRow, "sectionHierarchy")),
      type: valueOrEmpty(getField(rawRow, "type")),
      template: valueOrEmpty(getField(rawRow, "template")),
      originalStatus,
      currentStatus,
      importedComment: valueOrEmpty(getField(rawRow, "importedComment")),
      localNotes: valueOrEmpty(getField(rawRow, "localNotes")),
      importedDefects: valueOrEmpty(getField(rawRow, "importedDefects")),
      localDefects: valueOrEmpty(getField(rawRow, "localDefects")),
      references: valueOrEmpty(getField(rawRow, "references")),
      localEvidence: valueOrEmpty(getField(rawRow, "localEvidence")),
      preconditions: valueOrEmpty(getField(rawRow, "preconditions")),
      expectedResult: valueOrEmpty(getField(rawRow, "expectedResult")),
      stepsCombined,
      stepsStep: explicitStep,
      stepsExpectedResult: explicitExpected,
      stepsStatus: valueOrEmpty(getField(rawRow, "stepsStatus")),
      steps,
      testedBy: valueOrEmpty(getField(rawRow, "testedBy")),
      testedOn: valueOrEmpty(getField(rawRow, "testedOn")),
      testCaseLabels: valueOrEmpty(getField(rawRow, "testCaseLabels")),
      updatedAt: valueOrEmpty(getField(rawRow, "updatedAt")) || importedAt,
      rawRow
    };
  });

  const columns = headers.map((name, index) => ({
    index,
    name,
    key: name
  }));

  return normalizeRun({
    id,
    sourceFileName,
    sheetName,
    runName,
    runId: valueOrEmpty(runId),
    importedAt,
    columns,
    cases
  });
}

function validateHeaders(headers) {
  const missing = REQUIRED_COLUMN_GROUPS
    .filter((aliases) => !aliases.some((name) => headers.includes(name)))
    .map((aliases) => aliases[0]);
  if (missing.length > 0) {
    throw new Error(
      `Invalid CSV progress file: missing required columns: ${missing.join(", ")}.`
    );
  }
}

function rowToObject(headers, row, index) {
  const rawRow = {};
  for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
    const header = headers[columnIndex] || `Column ${columnIndex + 1}`;
    rawRow[header] = String(row[columnIndex] ?? "");
  }
  rawRow.__rowNumber = String(index + 2);
  return rawRow;
}

function getField(row, field) {
  const aliases = FIELD_ALIASES[field] || [];
  for (const alias of aliases) {
    const value = row[alias];
    if (String(value || "").trim() !== "") {
      return value;
    }
  }
  return "";
}

function normalizeStatus(status) {
  const lowered = String(status || "").trim().toLowerCase();
  return LOCAL_STATUSES.find((candidate) => candidate.toLowerCase() === lowered) || valueOrEmpty(status);
}

function applyLocalStepStatuses(stepRows, serializedStatuses) {
  if (!Array.isArray(stepRows) || stepRows.length === 0) {
    return stepRows;
  }
  const statuses = splitLocalStepStatuses(serializedStatuses);
  if (statuses.length === 0) {
    return stepRows;
  }
  return stepRows.map((row, index) => ({
    ...row,
    localCurrentStatus: index < statuses.length ? normalizeStatus(statuses[index]) : "",
    currentStatus: index < statuses.length
      ? (normalizeStatus(statuses[index]) || row.currentStatus || row.status)
      : row.currentStatus
  }));
}

function splitLocalStepStatuses(value) {
  const text = String(value ?? "");
  if (!text) {
    return [];
  }
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n").map((part) => part.trim());
}

function firstNonEmpty(values) {
  return values.map((value) => valueOrEmpty(value)).find(Boolean) || "";
}

function safeSourceFileName(value) {
  const source = valueOrEmpty(value);
  return source ? path.basename(source) : "restored.csv";
}

function valueOrEmpty(value) {
  return value == null ? "" : String(value).trim();
}

export function parseCsvRecords(text) {
  const records = [];
  let row = [];
  let value = "";
  let index = 0;
  let inQuotes = false;

  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      value += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      row.push(value);
      value = "";
      index += 1;
      continue;
    }
    if (char === "\n") {
      row.push(value);
      records.push(row);
      row = [];
      value = "";
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    value += char;
    index += 1;
  }

  if (inQuotes) {
    throw new Error("Invalid CSV progress file: quoted value was not closed.");
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    records.push(row);
  }

  return records;
}
