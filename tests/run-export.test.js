import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCsvExport } from "../public/run-export.js";
import { parseCsvRecords } from "../src/run-csv.js";

test("buildCsvExport escapes commas, quotes, and multiline local values", () => {
  const csv = buildCsvExport({
    id: "R100_Worksheet",
    runId: "R100",
    runName: "Regression, \"Main\"",
    sheetName: "Worksheet",
    sourceFileName: "synthetic.xlsx",
    columns: [
      { name: "ID", key: "ID" },
      { name: "Comment", key: "Comment" },
      { name: "Defects", key: "Defects" },
      { name: "Run", key: "Run" },
      { name: "Status", key: "Status" }
    ],
    cases: [
      {
        testId: "T1",
        caseId: "C1",
        title: "Quoted title",
        section: "Auth",
        sectionHierarchy: "Suite > Auth",
        originalStatus: "Untested",
        currentStatus: "Passed",
        localNotes: "Line 1\nLine 2, still same note",
        localDefects: "BUG-1,\"BUG-2\"",
        localEvidence: "Video, screenshot",
        updatedAt: "2026-05-14T08:00:00.000Z",
        rawRow: {
          ID: "T1",
          Comment: "Imported, \"comment\"",
          Defects: "BUG-0",
          Run: "Regression, \"Main\"",
          Status: "Untested"
        }
      }
    ]
  });

  const [header] = csv.split("\n");
  assert.equal(
    header,
    "Run ID,Run Name,Sheet Name,Source File Name,ID,Case ID,Title,Section,Section Hierarchy,Original Status,Current Status,Local Notes,Local Defects,Local Evidence,Updated At,Assigned To,Priority,Type,Template,References,Tested By,Tested On,Preconditions,Expected Result,Steps,Steps (Step),Steps (Expected Result),Steps (Status),Test Case Labels,Test Labels,Local Step Statuses,Comment,Defects,Run,Status"
  );
  assert.match(csv, /R100,"Regression, ""Main""",Worksheet,synthetic\.xlsx,T1,C1,Quoted title,Auth,Suite > Auth,Untested,Passed,/);
  assert.match(csv, /"Line 1\nLine 2, still same note"/);
  assert.match(csv, /"BUG-1,""BUG-2"""/);
  assert.match(csv, /"Video, screenshot"/);
  assert.match(csv, /"Imported, ""comment"""/);
});

test("buildCsvExport uses current local values, includes workbook fields, and exports local step statuses", () => {
  const csv = buildCsvExport({
    id: "R200_Worksheet",
    runId: "R200",
    runName: "Execution",
    sheetName: "Sheet A",
    sourceFileName: "origin.xlsx",
    columns: [
      { name: "ID", key: "ID" },
      { name: "Title", key: "Title" },
      { name: "Assigned To", key: "Assigned To" },
      { name: "Case ID", key: "Case ID" },
      { name: "Comment", key: "Comment" },
      { name: "Defects", key: "Defects" },
      { name: "References", key: "References" },
      { name: "Preconditions", key: "Preconditions" },
      { name: "Priority", key: "Priority" },
      { name: "Expected Result", key: "Expected Result" },
      { name: "Run", key: "Run" },
      { name: "Run ID", key: "Run ID" },
      { name: "Section", key: "Section" },
      { name: "Section Hierarchy", key: "Section Hierarchy" },
      { name: "Status", key: "Status" },
      { name: "Tested By", key: "Tested By" },
      { name: "Steps (Status)", key: "Steps (Status)" },
      { name: "Steps (Expected Result)", key: "Steps (Expected Result)" },
      { name: "Steps (Step)", key: "Steps (Step)" },
      { name: "Template", key: "Template" },
      { name: "Tested On", key: "Tested On" },
      { name: "Type", key: "Type" },
      { name: "Test Case Labels", key: "Test Case Labels" }
    ],
    cases: [
      {
        testId: "T9",
        caseId: "C9",
        title: "Updated case",
        section: "Checkout",
        sectionHierarchy: "Suite > Checkout",
        originalStatus: "Untested",
        currentStatus: "Blocked",
        localNotes: "Current note",
        localDefects: "BUG-9",
        localEvidence: "capture.png",
        updatedAt: "2026-05-14T08:10:00.000Z",
        assignedTo: "QA User",
        priority: "High",
        type: "Functional",
        template: "Test Case (Steps)",
        references: "REQ-9",
        testedBy: "Tester",
        testedOn: "2026-05-14",
        preconditions: "User exists",
        expectedResult: "Order placed",
        stepsCombined: "1. Fill cart",
        stepsStep: "1. Fill cart",
        stepsExpectedResult: "1. Order placed",
        stepsStatus: "Untested",
        testCaseLabels: "critical",
        steps: [
          { step: "Fill cart", expectedResult: "Order placed", status: "Untested", currentStatus: "Passed", localCurrentStatus: "Passed" },
          { step: "Submit", expectedResult: "Confirmation shown", status: "Untested", currentStatus: "Blocked", localCurrentStatus: "Blocked" }
        ],
        rawRow: {
          ID: "T9",
          Title: "Imported title",
          "Assigned To": "QA User",
          "Case ID": "C9",
          Comment: "Imported comment",
          Defects: "BUG-0",
          References: "REQ-9",
          Preconditions: "User exists",
          Priority: "High",
          "Expected Result": "Order placed",
          Run: "Execution",
          "Run ID": "R200",
          Section: "Checkout",
          "Section Hierarchy": "Suite > Checkout",
          Status: "Untested",
          "Tested By": "Tester",
          "Steps (Status)": "Untested",
          "Steps (Expected Result)": "1. Order placed",
          "Steps (Step)": "1. Fill cart",
          Template: "Test Case (Steps)",
          "Tested On": "2026-05-14",
          Type: "Functional",
          "Test Case Labels": "critical"
        }
      }
    ]
  });

  const [headers, row] = parseCsvRecords(csv);
  assert.deepEqual(headers.slice(0, 20), [
    "Run ID",
    "Run Name",
    "Sheet Name",
    "Source File Name",
    "ID",
    "Case ID",
    "Title",
    "Section",
    "Section Hierarchy",
    "Original Status",
    "Current Status",
    "Local Notes",
    "Local Defects",
    "Local Evidence",
    "Updated At",
    "Assigned To",
    "Priority",
    "Type",
    "Template",
    "References"
  ]);
  const rowByHeader = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  assert.equal(rowByHeader["Title"], "Updated case");
  assert.equal(rowByHeader["Current Status"], "Blocked");
  assert.equal(rowByHeader["Local Notes"], "Current note");
  assert.equal(rowByHeader["Assigned To"], "QA User");
  assert.equal(rowByHeader["Priority"], "High");
  assert.equal(rowByHeader["Tested By"], "Tester");
  assert.equal(rowByHeader["Preconditions"], "User exists");
  assert.equal(rowByHeader["Steps (Step)"], "1. Fill cart");
  assert.equal(rowByHeader["Steps (Expected Result)"], "1. Order placed");
  assert.equal(rowByHeader["Steps (Status)"], "Untested");
  assert.equal(rowByHeader["Local Step Statuses"], "Passed\nBlocked");
  assert.equal(rowByHeader["Comment"], "Imported comment");
  assert.equal(rowByHeader["Defects"], "BUG-0");
  assert.equal(rowByHeader["Run"], "Execution");
  assert.equal(rowByHeader["Status"], "Untested");
});

test("buildCsvExport keeps Local Step Statuses separate from imported step statuses", () => {
  const csv = buildCsvExport({
    runId: "R210",
    runName: "Execution",
    sheetName: "Sheet A",
    sourceFileName: "origin.xlsx",
    columns: [
      { name: "Steps (Status)", key: "Steps (Status)" }
    ],
    cases: [
      {
        testId: "T10",
        caseId: "C10",
        title: "Mixed step edits",
        originalStatus: "Untested",
        currentStatus: "In test",
        stepsStatus: "Untested\nUntested\nUntested",
        steps: [
          { step: "One", expectedResult: "A", status: "Untested", currentStatus: "Passed", localCurrentStatus: "Passed" },
          { step: "Two", expectedResult: "B", status: "Untested", currentStatus: "Untested", localCurrentStatus: "" },
          { step: "Three", expectedResult: "C", status: "Untested", currentStatus: "Failed", localCurrentStatus: "Failed" }
        ],
        rawRow: {
          "Steps (Status)": "Untested\nUntested\nUntested"
        }
      }
    ]
  });

  const [headers, row] = parseCsvRecords(csv);
  const rowByHeader = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  assert.equal(rowByHeader["Steps (Status)"], "Untested\nUntested\nUntested");
  assert.equal(rowByHeader["Local Step Statuses"], "Passed\n\nFailed");
});
