import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyProgressImportResponse,
  classifyXlsxImportResponse,
  shouldSkipRecoveryForProgressImport
} from "../public/import-flow.js";

test("classifyXlsxImportResponse keeps worksheet selection as a visible prompt", () => {
  const result = classifyXlsxImportResponse(409, {
    worksheetSelectionRequired: true,
    availableSheets: ["Smoke", "Regression"],
    message: "Choose one worksheet to import."
  });

  assert.equal(result.kind, "prompt");
  assert.equal(result.prompt.type, "worksheet-selection");
  assert.deepEqual(result.prompt.availableSheets, ["Smoke", "Regression"]);
});

test("classifyXlsxImportResponse keeps existing-progress collision as a visible prompt", () => {
  const result = classifyXlsxImportResponse(409, {
    decisionRequired: true,
    reason: "existing-progress",
    importedRunSummary: {
      runName: "Regression Run",
      runId: "R7",
      sheetName: "Worksheet",
      caseCount: 12
    },
    message: "Saved local progress already exists for this run."
  });

  assert.equal(result.kind, "prompt");
  assert.equal(result.prompt.type, "existing-progress");
  assert.equal(result.prompt.importedRunSummary.runId, "R7");
});

test("classifyXlsxImportResponse blocks legacy auto-resume success until resume is explicit", () => {
  const result = classifyXlsxImportResponse(200, {
    existingProgressFound: true,
    message: "Existing local progress was found and loaded. The import did not overwrite it.",
    run: {
      id: "R30_Worksheet",
      runName: "Regression Run",
      runId: "R30",
      sheetName: "Worksheet",
      cases: [{}, {}]
    }
  });

  assert.equal(result.kind, "prompt");
  assert.equal(result.prompt.type, "existing-progress");
  assert.equal(result.fallbackDetected, true);
});

test("classifyXlsxImportResponse allows explicit resume success to continue", () => {
  const payload = {
    existingProgressFound: true,
    message: "Existing local progress was kept and loaded.",
    run: {
      id: "R30_Worksheet",
      runName: "Regression Run",
      runId: "R30",
      sheetName: "Worksheet",
      cases: [{}]
    }
  };

  const result = classifyXlsxImportResponse(200, payload, { existingAction: "resume" });

  assert.equal(result.kind, "success");
  assert.equal(result.payload, payload);
});

test("shouldSkipRecoveryForProgressImport skips browser recovery for restored CSV runs", () => {
  assert.equal(shouldSkipRecoveryForProgressImport({
    run: { id: "R30_Worksheet", cases: [] },
    importType: "csv"
  }), true);
});

test("classifyProgressImportResponse keeps JSON and CSV collisions as resume or replace decisions", () => {
  for (const importType of ["json", "csv"]) {
    const result = classifyProgressImportResponse(409, {
      decisionRequired: true,
      reason: "existing-progress",
      importedRunSummary: {
        runName: "Regression Run",
        runId: "R8",
        sheetName: "Worksheet",
        caseCount: 3
      },
      message: "Saved local progress already exists for this run."
    }, importType);

    assert.equal(result.kind, "prompt");
    assert.equal(result.prompt.type, "existing-progress");
    assert.equal(result.prompt.importType, importType);
    assert.equal(result.prompt.sourceKind, "progress");
    assert.equal(result.prompt.importedRunSummary.runId, "R8");
  }
});

test("classifyProgressImportResponse allows explicit progress replacement success", () => {
  const payload = {
    run: { id: "R8_Worksheet", cases: [] },
    message: "CSV progress replaced the saved local progress.",
    existingProgressReplaced: true
  };

  const result = classifyProgressImportResponse(201, payload, "csv");

  assert.equal(result.kind, "success");
  assert.equal(result.payload, payload);
});
