import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeRestoredCsvRun, parseCsvRecords, parseRunProgressCsv } from "../src/run-csv.js";

test("parseCsvRecords handles quoted commas and line breaks", () => {
  const records = parseCsvRecords('ID,Title,Status\nT1,"Login, happy path","In test"\nT2,"Line 1\nLine 2",Passed\n');
  assert.equal(records.length, 3);
  assert.equal(records[1][1], "Login, happy path");
  assert.equal(records[2][1], "Line 1\nLine 2");
});

test("parseRunProgressCsv restores current and original statuses separately", () => {
  const csv = [
    "Run ID,Run Name,Sheet Name,Source File Name,ID,Case ID,Title,Section,Section Hierarchy,Original Status,Current Status,Local Notes,Local Defects,Local Evidence,Updated At",
    "R30,Regression,Worksheet,backup.csv,T1,C1,Can login,Auth,Suite > Auth,Untested,Passed,\"note\",BUG-1,link,2026-05-06T11:00:00.000Z"
  ].join("\n");

  const run = parseRunProgressCsv(csv);
  assert.equal(run.id, "R30_Worksheet");
  assert.equal(run.runName, "Regression");
  assert.equal(run.sheetName, "Worksheet");
  assert.equal(run.cases[0].testId, "T1");
  assert.equal(run.cases[0].originalStatus, "Untested");
  assert.equal(run.cases[0].currentStatus, "Passed");
  assert.equal(run.cases[0].localNotes, "note");
  assert.equal(run.cases[0].localDefects, "BUG-1");
  assert.equal(run.cases[0].localEvidence, "link");
  assert.equal(run.cases[0].rawRow["Section Hierarchy"], "Suite > Auth");
  assert.deepEqual(run.availableStatuses, ["Untested", "Passed"]);
});

test("parseRunProgressCsv restores richer workbook fields and local step statuses", () => {
  const csv = [
    "Run ID,Run Name,Sheet Name,Source File Name,ID,Case ID,Title,Section,Section Hierarchy,Original Status,Current Status,Local Notes,Local Defects,Local Evidence,Updated At,Assigned To,Priority,Type,Template,References,Tested By,Tested On,Preconditions,Expected Result,Steps,Steps (Step),Steps (Expected Result),Steps (Status),Test Case Labels,Test Labels,Local Step Statuses,Comment,Defects,Run,Status",
    "R40,Regression,Worksheet,backup.csv,T4,C4,Can checkout,Checkout,Suite > Checkout,Untested,Failed,\"note\",BUG-4,video.mp4,2026-05-06T11:00:00.000Z,QA User,High,Functional,Test Case (Steps),REQ-40,Tester,2026-05-06,User exists,Order placed,\"Step Description: Fill cart\nStep Description: Submit order\",\"1. Fill cart\n2. Submit order\",\"1. Order placed\n2. Confirmation shown\",\"Untested\nUntested\",critical,smoke,\"Passed\nBlocked\",Imported comment,BUG-0,Regression,Untested"
  ].join("\n");

  const run = parseRunProgressCsv(csv);
  assert.equal(run.cases[0].assignedTo, "QA User");
  assert.equal(run.cases[0].priority, "High");
  assert.equal(run.cases[0].type, "Functional");
  assert.equal(run.cases[0].template, "Test Case (Steps)");
  assert.equal(run.cases[0].references, "REQ-40");
  assert.equal(run.cases[0].testedBy, "Tester");
  assert.equal(run.cases[0].testedOn, "2026-05-06");
  assert.equal(run.cases[0].preconditions, "User exists");
  assert.equal(run.cases[0].expectedResult, "Order placed");
  assert.equal(run.cases[0].importedComment, "Imported comment");
  assert.equal(run.cases[0].importedDefects, "BUG-0");
  assert.equal(run.cases[0].steps[0].status, "Untested");
  assert.equal(run.cases[0].steps[0].currentStatus, "Passed");
  assert.equal(run.cases[0].steps[1].currentStatus, "Blocked");
  assert.equal(run.cases[0].rawRow.Comment, "Imported comment");
  assert.equal(run.cases[0].rawRow.Defects, "BUG-0");
  assert.equal(run.cases[0].rawRow["Test Labels"], "smoke");
});

test("parseRunProgressCsv falls back original status to current status when missing", () => {
  const csv = [
    "ID,Title,Status",
    "T2,Run checkout,Retest"
  ].join("\n");
  const run = parseRunProgressCsv(csv, { sourceFileName: "progress.csv" });
  assert.equal(run.id, "CSV_Restored_Run_CSV");
  assert.equal(run.cases[0].originalStatus, "Retest");
  assert.equal(run.cases[0].currentStatus, "Retest");
  assert.deepEqual(run.availableStatuses, ["Retest"]);
});

test("parseRunProgressCsv rejects missing required columns", () => {
  assert.throws(
    () => parseRunProgressCsv("ID,Title\nT1,Case one"),
    /missing required columns: Current Status/
  );
});

test("parseRunProgressCsv rejects empty csv", () => {
  assert.throws(
    () => parseRunProgressCsv(""),
    /no rows were detected/
  );
});

test("normalizeRestoredCsvRun accepts case id alias and keeps row values in rawRow", () => {
  const run = normalizeRestoredCsvRun(
    ["Test ID", "CaseId", "title", "status", "Notes"],
    [["T7", "C7", "Alias title", "Failed", "Investigate"]],
    { sourceFileName: "aliases.csv" }
  );
  assert.equal(run.cases[0].testId, "T7");
  assert.equal(run.cases[0].caseId, "C7");
  assert.equal(run.cases[0].currentStatus, "Failed");
  assert.equal(run.cases[0].localNotes, "Investigate");
  assert.equal(run.cases[0].rawRow.CaseId, "C7");
});
