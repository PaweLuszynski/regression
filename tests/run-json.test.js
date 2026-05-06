import assert from "node:assert/strict";
import { test } from "node:test";

import {
  JSON_PROGRESS_SCHEMA,
  JSON_PROGRESS_SCHEMA_VERSION,
  normalizeRestoredRun,
  parseRunProgressJson
} from "../src/run-json.js";

function sampleRun() {
  return {
    id: "R30_export",
    sourceFileName: "export.xlsx",
    sheetName: "Worksheet",
    runName: "Regression",
    runId: "R30",
    version: "2.11",
    importedAt: "2026-05-06T10:00:00.000Z",
    columns: [{ index: 0, name: "ID", key: "ID" }],
    cases: [
      {
        localId: "T1",
        testId: "T1",
        caseId: "C1",
        title: "Can restore",
        originalStatus: "Untested",
        currentStatus: "Passed",
        localNotes: "Restored note",
        localDefects: "BUG-1",
        localEvidence: "Screenshot link",
        updatedAt: "2026-05-06T11:00:00.000Z",
        rawRow: {
          ID: "T1",
          Status: "Untested",
          Unknown: "preserve me"
        },
        unexpectedCaseField: "still here"
      }
    ],
    unexpectedRunField: "also here"
  };
}

test("normalizeRestoredRun accepts current exported run shape and preserves local progress", () => {
  const run = normalizeRestoredRun(sampleRun());

  assert.equal(run.id, "R30_export");
  assert.equal(run.runName, "Regression");
  assert.equal(run.columns[0].key, "ID");
  assert.equal(run.version, "2.11");
  assert.equal(run.unexpectedRunField, "also here");
  assert.equal(run.cases.length, 1);
  assert.equal(run.cases[0].originalStatus, "Untested");
  assert.equal(run.cases[0].currentStatus, "Passed");
  assert.equal(run.cases[0].localNotes, "Restored note");
  assert.equal(run.cases[0].localDefects, "BUG-1");
  assert.equal(run.cases[0].localEvidence, "Screenshot link");
  assert.equal(run.cases[0].updatedAt, "2026-05-06T11:00:00.000Z");
  assert.equal(run.cases[0].rawRow.Unknown, "preserve me");
  assert.equal(run.cases[0].unexpectedCaseField, "still here");
});

test("parseRunProgressJson accepts wrapped schema progress files", () => {
  const restored = parseRunProgressJson(JSON.stringify({
    schema: JSON_PROGRESS_SCHEMA,
    schemaVersion: JSON_PROGRESS_SCHEMA_VERSION,
    run: sampleRun()
  }));

  assert.equal(restored.runId, "R30");
  assert.equal(restored.cases[0].currentStatus, "Passed");
});

test("normalizeRestoredRun creates a stable id from metadata when id is missing", () => {
  const run = sampleRun();
  delete run.id;

  assert.equal(normalizeRestoredRun(run).id, "R30_export");
});

test("parseRunProgressJson rejects invalid JSON with a readable error", () => {
  assert.throws(
    () => parseRunProgressJson("{not json"),
    /Invalid JSON progress file/
  );
});

test("parseRunProgressJson rejects incompatible progress schema", () => {
  assert.throws(
    () => parseRunProgressJson(JSON.stringify({
      schema: JSON_PROGRESS_SCHEMA,
      schemaVersion: 999,
      run: sampleRun()
    })),
    /Unsupported JSON progress schema version/
  );
});

test("normalizeRestoredRun rejects files without test cases", () => {
  assert.throws(
    () => normalizeRestoredRun({ runName: "Missing cases" }),
    /does not contain a cases array/
  );
});
