import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCsvExport } from "../public/run-export.js";

test("buildCsvExport escapes commas, quotes, and multiline local values", () => {
  const csv = buildCsvExport({
    id: "R100_Worksheet",
    runId: "R100",
    runName: "Regression, \"Main\"",
    sheetName: "Worksheet",
    sourceFileName: "synthetic.xlsx",
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
        updatedAt: "2026-05-14T08:00:00.000Z"
      }
    ]
  });

  const [header] = csv.split("\n");
  assert.equal(
    header,
    "Run ID,Run Name,Sheet Name,Source File Name,ID,Case ID,Title,Section,Section Hierarchy,Original Status,Current Status,Local Notes,Local Defects,Local Evidence,Updated At"
  );
  assert.match(csv, /R100,"Regression, ""Main""",Worksheet,synthetic\.xlsx,T1,C1,Quoted title,Auth,Suite > Auth,Untested,Passed,/);
  assert.match(csv, /"Line 1\nLine 2, still same note"/);
  assert.match(csv, /"BUG-1,""BUG-2"""/);
  assert.match(csv, /"Video, screenshot"/);
});

test("buildCsvExport uses current local values and stable field order", () => {
  const csv = buildCsvExport({
    id: "R200_Worksheet",
    runId: "R200",
    runName: "Execution",
    sheetName: "Sheet A",
    sourceFileName: "origin.xlsx",
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
        updatedAt: "2026-05-14T08:10:00.000Z"
      }
    ]
  });

  const [, row] = csv.trimEnd().split("\n");
  assert.equal(
    row,
    "R200,Execution,Sheet A,origin.xlsx,T9,C9,Updated case,Checkout,Suite > Checkout,Untested,Blocked,Current note,BUG-9,capture.png,2026-05-14T08:10:00.000Z"
  );
});
