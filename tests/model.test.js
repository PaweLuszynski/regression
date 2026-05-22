import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendNoteToCases,
  appendTextToCaseField,
  applyStepStatusToCase,
  applyStatusToCase,
  applyStatusToCases,
  buildTreeFromCases,
  calculateRunStats,
  getAdjacentVisibleCaseId,
  getKeyboardResizeDelta,
  getNextSavedRunIdAfterDeletion,
  getRunSafetyTimestamps,
  normalizeFailureCommentTemplates,
  latestRunTimestamp,
  getVisibleCaseOrder,
  getNextCaseId,
  getVisibleNavigationState,
  getRunStatuses,
  getStatusColor,
  getEffectiveStepStatus,
  isCheckboxActivationKey,
  isCaseVisibleByLocalId,
  groupCasesBySection,
  normalizeRun,
  resolveUnsavedRunRecovery,
  sortSavedRuns,
  resizeCaseListColumns,
  resizePanelWidths,
  sanitizeCaseListColumns,
  sanitizePanelWidths,
  parseSteps
} from "../public/model.js";

test("buildTreeFromCases creates nested folders from section hierarchy", () => {
  const cases = [
    {
      localId: "a",
      testId: "T1",
      caseId: "C1",
      title: "Root case",
      sectionHierarchy: "Plan > Login > Vendor",
      section: "Vendor",
      currentStatus: "Passed"
    },
    {
      localId: "b",
      testId: "T2",
      caseId: "C2",
      title: "Company case",
      sectionHierarchy: "Plan > Login > Company",
      section: "Company",
      currentStatus: "Failed"
    },
    {
      localId: "c",
      testId: "T3",
      caseId: "C3",
      title: "Missing hierarchy case",
      section: "Fallback Section",
      currentStatus: "Untested"
    }
  ];

  const tree = buildTreeFromCases(cases);

  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[0].name, "Plan");
  assert.equal(tree.children[0].children[0].name, "Login");
  assert.equal(tree.children[0].children[0].children[0].name, "Vendor");
  assert.equal(tree.children[0].children[0].children[0].children[0].type, "test");
  assert.equal(tree.children[0].children[0].children[0].children[0].testId, "T1");
  assert.equal(tree.children[1].name, "Fallback Section");
  assert.deepEqual(tree.children[0].counts, {
    Passed: 1,
    Failed: 1,
    Untested: 0
  });
});

test("getStatusColor returns readable semantic status classes", () => {
  assert.equal(getStatusColor("Passed").className, "status-passed");
  assert.equal(getStatusColor("Untested").className, "status-untested");
  assert.equal(getStatusColor("Failed").className, "status-failed");
  assert.equal(getStatusColor("In test").className, "status-in-test");
  assert.equal(getStatusColor("Retest").className, "status-retest");
  assert.equal(getStatusColor("Blocked").className, "status-blocked");
  assert.equal(getStatusColor("Conditionally Passed").className, "status-conditionally-passed");
  assert.equal(getStatusColor("Unknown").className, "status-unknown");
});

test("getRunStatuses derives custom statuses from imported and local run data", () => {
  const run = {
    cases: [
      {
        originalStatus: "Ready For QA",
        currentStatus: "Blocked By Vendor",
        steps: [
          { status: "Needs Review", currentStatus: "Needs Review" }
        ]
      }
    ]
  };

  assert.deepEqual(getRunStatuses(run), [
    "Ready For QA",
    "Blocked By Vendor",
    "Needs Review"
  ]);
});

test("getRunStatuses deduplicates repeated malformed step status blobs", () => {
  const run = {
    cases: [
      {
        originalStatus: "Untested",
        currentStatus: "Untested",
        stepsStatus: "Untested Untested Untested Untested",
        steps: [
          { status: "Untested", currentStatus: "Untested" }
        ]
      }
    ]
  };

  assert.deepEqual(getRunStatuses(run), ["Untested"]);
});

test("getRunStatuses ignores malformed long status-like text", () => {
  const run = {
    cases: [
      {
        originalStatus: "Passed",
        currentStatus: "Passed",
        steps: [
          {
            status: "Step Description Submit form Expected Result Dashboard opens",
            currentStatus: ""
          }
        ]
      }
    ]
  };

  assert.deepEqual(getRunStatuses(run), ["Passed"]);
});

test("calculateRunStats uses current statuses and separates completed from passed", () => {
  const stats = calculateRunStats([
    { currentStatus: "Passed" },
    { currentStatus: "Failed" },
    { currentStatus: "In test" },
    { currentStatus: "Untested" },
    { currentStatus: "Conditionally Passed" }
  ]);

  assert.equal(stats.total, 5);
  assert.equal(stats.completed, 4);
  assert.equal(stats.completedPercent, 80);
  assert.equal(stats.passedPercent, 20);
  assert.equal(stats.counts.Passed, 1);
  assert.equal(stats.counts.Untested, 1);
  assert.equal(stats.counts["Conditionally Passed"], 1);
});

test("calculateRunStats tracks custom imported statuses", () => {
  const stats = calculateRunStats([
    { currentStatus: "Ready For QA" },
    { currentStatus: "Blocked By Vendor" }
  ], ["Ready For QA", "Blocked By Vendor"]);

  assert.equal(stats.counts["Ready For QA"], 1);
  assert.equal(stats.counts["Blocked By Vendor"], 1);
});

test("parseSteps aligns numbered steps with numbered expected results", () => {
  const steps = parseSteps({
    "Steps (Step)": "<p>1. Open page.</p><p>2. Submit form.</p>",
    "Steps (Expected Result)": "1. Page opens.\n2. Validation is shown.",
    "Steps (Status)": "1. Passed\n2. Untested"
  });

  assert.deepEqual(steps, [
    {
      step: "Open page.",
      expectedResult: "Page opens.",
      status: "Passed",
      additionalInfo: "",
      references: ""
    },
    {
      step: "Submit form.",
      expectedResult: "Validation is shown.",
      status: "Untested",
      additionalInfo: "",
      references: ""
    }
  ]);
});

test("parseSteps distributes repeated unnumbered step statuses", () => {
  const steps = parseSteps({
    "Steps (Step)": "1. Open page.\n2. Submit form.",
    "Steps (Expected Result)": "1. Page opens.\n2. Validation is shown.",
    "Steps (Status)": "Untested Untested"
  });

  assert.equal(steps[0].status, "Untested");
  assert.equal(steps[1].status, "Untested");
});

test("parseSteps ignores repeated malformed single-line status blobs", () => {
  const steps = parseSteps({
    "Steps (Step)": "1. Open page.\n2. Submit form.",
    "Steps (Expected Result)": "1. Page opens.\n2. Validation is shown.",
    "Steps (Status)": "Untested Untested Untested Untested"
  });

  assert.equal(steps[0].status, "");
  assert.equal(steps[1].status, "");
});

test("parseSteps falls back to rich duplicate Steps content", () => {
  const steps = parseSteps({
    Steps: "",
    Steps__2: "Step Description: Create record\nExpected Result: Record appears"
  });

  assert.deepEqual(steps, [
    {
      step: "Step Description: Create record",
      expectedResult: "Record appears",
      status: "",
      additionalInfo: "",
      references: ""
    }
  ]);
});

test("sanitizePanelWidths uses defaults and enforces minimum widths", () => {
  assert.deepEqual(sanitizePanelWidths({ tree: 10, list: 400, detail: 200 }), {
    tree: 220,
    list: 500,
    detail: 420
  });

  assert.deepEqual(sanitizePanelWidths({ tree: 340, list: 860, detail: 680 }), {
    tree: 340,
    list: 860,
    detail: 680
  });
});

test("resizePanelWidths moves space between adjacent panels without crossing minimums", () => {
  assert.deepEqual(
    resizePanelWidths({ tree: 300, list: 700, detail: 600 }, "tree-list", 80),
    { tree: 380, list: 620, detail: 600 }
  );

  assert.deepEqual(
    resizePanelWidths({ tree: 300, list: 700, detail: 600 }, "tree-list", 400),
    { tree: 500, list: 500, detail: 600 }
  );

  assert.deepEqual(
    resizePanelWidths({ tree: 300, list: 700, detail: 600 }, "list-detail", -220),
    { tree: 300, list: 500, detail: 800 }
  );
});

test("sanitizeCaseListColumns uses defaults and enforces readable minimum widths", () => {
  assert.deepEqual(sanitizeCaseListColumns({ id: 20, title: 120, status: 60 }), {
    id: 70,
    title: 220,
    status: 120
  });

  assert.deepEqual(sanitizeCaseListColumns({ id: 92, title: 540, status: 170 }), {
    id: 92,
    title: 540,
    status: 170
  });
});

test("resizeCaseListColumns updates one column while preserving other widths", () => {
  assert.deepEqual(
    resizeCaseListColumns({ id: 86, title: 520, status: 150 }, "title", 80),
    { id: 86, title: 600, status: 150 }
  );

  assert.deepEqual(
    resizeCaseListColumns({ id: 86, title: 520, status: 150 }, "status", -80),
    { id: 86, title: 520, status: 120 }
  );

  assert.deepEqual(
    resizeCaseListColumns({ id: 86, title: 520, status: 150 }, "unknown", 80),
    { id: 86, title: 520, status: 150 }
  );
});

test("getKeyboardResizeDelta uses arrow keys and supports larger shift steps", () => {
  assert.equal(getKeyboardResizeDelta("ArrowLeft"), -24);
  assert.equal(getKeyboardResizeDelta("ArrowRight"), 24);
  assert.equal(getKeyboardResizeDelta("ArrowUp"), -24);
  assert.equal(getKeyboardResizeDelta("ArrowDown"), 24);
  assert.equal(getKeyboardResizeDelta("ArrowRight", { shiftKey: true }), 72);
  assert.equal(getKeyboardResizeDelta("Enter"), 0);
});

test("isCheckboxActivationKey identifies Space without catching navigation keys", () => {
  assert.equal(isCheckboxActivationKey(" "), true);
  assert.equal(isCheckboxActivationKey("Space"), true);
  assert.equal(isCheckboxActivationKey("Spacebar"), true);
  assert.equal(isCheckboxActivationKey("Unidentified", "Space"), true);
  assert.equal(isCheckboxActivationKey("ArrowDown"), false);
  assert.equal(isCheckboxActivationKey("Enter"), false);
});

test("getAdjacentVisibleCaseId returns neighboring visible cases without falling out of bounds", () => {
  const ids = ["a", "b", "c"];

  assert.equal(getAdjacentVisibleCaseId("b", ids, 1), "c");
  assert.equal(getAdjacentVisibleCaseId("b", ids, -1), "a");
  assert.equal(getAdjacentVisibleCaseId("a", ids, -1), "a");
  assert.equal(getAdjacentVisibleCaseId("missing", ids, 1), "a");
  assert.equal(getAdjacentVisibleCaseId("missing", ids, -1), "c");
  assert.equal(getAdjacentVisibleCaseId("a", [], 1), null);
});

test("applyStatusToCase updates current status and timestamp without changing original status", () => {
  const cases = [{ localId: "a", originalStatus: "Untested", currentStatus: "Untested", updatedAt: "old" }];
  const result = applyStatusToCase(cases, "a", "Passed", "now");

  assert.equal(result.changed, 1);
  assert.equal(cases[0].originalStatus, "Untested");
  assert.equal(cases[0].currentStatus, "Passed");
  assert.equal(cases[0].updatedAt, "now");
});

test("applyStatusToCases updates only selected cases", () => {
  const cases = [
    { localId: "a", originalStatus: "Untested", currentStatus: "Untested", updatedAt: "old" },
    { localId: "b", originalStatus: "Failed", currentStatus: "Failed", updatedAt: "old" },
    { localId: "c", originalStatus: "Passed", currentStatus: "Passed", updatedAt: "old" }
  ];

  const result = applyStatusToCases(cases, ["a", "c"], "Retest", "now");

  assert.equal(result.changed, 2);
  assert.equal(cases[0].currentStatus, "Retest");
  assert.equal(cases[1].currentStatus, "Failed");
  assert.equal(cases[2].currentStatus, "Retest");
  assert.equal(cases[2].originalStatus, "Passed");
});

test("applyStepStatusToCase updates current step status without overwriting imported step status", () => {
  const cases = [{
    localId: "a",
    updatedAt: "old",
    steps: [{ status: "Untested", currentStatus: "Untested", localCurrentStatus: "" }]
  }];

  const result = applyStepStatusToCase(cases, "a", 0, "Passed", "now");

  assert.equal(result.changed, 1);
  assert.equal(cases[0].steps[0].status, "Untested");
  assert.equal(cases[0].steps[0].currentStatus, "Passed");
  assert.equal(cases[0].steps[0].localCurrentStatus, "Passed");
  assert.equal(cases[0].updatedAt, "now");
});

test("getNextCaseId returns the next visible id or null for the last case", () => {
  assert.equal(getNextCaseId("a", ["a", "b", "c"]), "b");
  assert.equal(getNextCaseId("c", ["a", "b", "c"]), null);
  assert.equal(getNextCaseId("missing", ["a", "b", "c"]), "a");
});

test("getVisibleNavigationState exposes previous and next visible cases", () => {
  assert.deepEqual(getVisibleNavigationState("b", ["a", "b", "c"]), {
    previousId: "a",
    nextId: "c",
    hasPrevious: true,
    hasNext: true
  });
  assert.deepEqual(getVisibleNavigationState("a", ["a", "b", "c"]), {
    previousId: null,
    nextId: "b",
    hasPrevious: false,
    hasNext: true
  });
  assert.deepEqual(getVisibleNavigationState("missing", ["a", "b"]), {
    previousId: null,
    nextId: "a",
    hasPrevious: false,
    hasNext: true
  });
});

test("isCaseVisibleByLocalId checks the current visible case set by stable local id", () => {
  const visibleCases = [
    { localId: "T1", title: "Visible one" },
    { localId: "T2", title: "Visible two" }
  ];

  assert.equal(isCaseVisibleByLocalId(visibleCases, "T2"), true);
  assert.equal(isCaseVisibleByLocalId(visibleCases, "T3"), false);
  assert.equal(isCaseVisibleByLocalId(null, "T2"), false);
});

test("groupCasesBySection groups by hierarchy leaf while preserving visible order", () => {
  const cases = [
    {
      localId: "a",
      testId: "T1",
      title: "Login",
      sectionHierarchy: "Plan > Start",
      section: "Start"
    },
    {
      localId: "b",
      testId: "T2",
      title: "Logout",
      sectionHierarchy: "Plan > Start",
      section: "Start"
    },
    {
      localId: "c",
      testId: "T3",
      title: "Vendor",
      sectionHierarchy: "Plan > Registration > Vendor",
      section: "Vendor"
    },
    {
      localId: "d",
      testId: "T4",
      title: "Fallback",
      section: "Fallback Section"
    },
    {
      localId: "e",
      testId: "T5",
      title: "No Section"
    }
  ];

  const groups = groupCasesBySection(cases);

  assert.deepEqual(groups.map((group) => group.label), [
    "Start",
    "Registration / Vendor",
    "Fallback Section",
    "Ungrouped"
  ]);
  assert.deepEqual(groups.map((group) => group.cases.map((testCase) => testCase.localId)), [
    ["a", "b"],
    ["c"],
    ["d"],
    ["e"]
  ]);
  assert.deepEqual(getVisibleCaseOrder(groups), ["a", "b", "c", "d", "e"]);
});

test("appendNoteToCases appends notes without overwriting existing local notes", () => {
  const cases = [
    { localId: "a", localNotes: "Existing", updatedAt: "old" },
    { localId: "b", localNotes: "", updatedAt: "old" }
  ];

  const result = appendNoteToCases(cases, ["a", "b"], "New note", "2026-05-05T10:00:00.000Z");

  assert.equal(result.changed, 2);
  assert.match(cases[0].localNotes, /Existing\n\n\[2026-05-05T10:00:00.000Z\]\nNew note/);
  assert.equal(cases[1].localNotes, "[2026-05-05T10:00:00.000Z]\nNew note");
});

test("appendTextToCaseField appends timestamped local fields without imported overwrite", () => {
  const cases = [{
    localId: "a",
    importedComment: "Imported comment stays",
    importedDefects: "BUG-1",
    localNotes: "Existing note",
    localDefects: "",
    localEvidence: "",
    updatedAt: "old"
  }];

  assert.deepEqual(
    appendTextToCaseField(cases, "a", "localNotes", "Observed failure", "2026-05-05T10:00:00.000Z", {
      prefix: "Failure note"
    }),
    { changed: 1 }
  );
  assert.deepEqual(
    appendTextToCaseField(cases, "a", "localEvidence", "Screenshot captured", "2026-05-05T10:05:00.000Z"),
    { changed: 1 }
  );

  assert.equal(cases[0].importedComment, "Imported comment stays");
  assert.equal(cases[0].importedDefects, "BUG-1");
  assert.match(cases[0].localNotes, /Existing note\n\n\[2026-05-05T10:00:00.000Z\]\nFailure note\nObserved failure/);
  assert.equal(cases[0].localEvidence, "[2026-05-05T10:05:00.000Z]\nScreenshot captured");
  assert.equal(cases[0].updatedAt, "2026-05-05T10:05:00.000Z");
});

test("appendTextToCaseField ignores unsupported fields and blank text", () => {
  const cases = [{ localId: "a", localNotes: "Existing", updatedAt: "old" }];

  assert.deepEqual(appendTextToCaseField(cases, "a", "importedComment", "Nope", "now"), { changed: 0 });
  assert.deepEqual(appendTextToCaseField(cases, "a", "localNotes", "  ", "now"), { changed: 0 });
  assert.equal(cases[0].localNotes, "Existing");
  assert.equal(cases[0].updatedAt, "old");
});

test("normalizeFailureCommentTemplates trims dedupes and falls back to defaults", () => {
  assert.deepEqual(normalizeFailureCommentTemplates([
    " Actual result differs ",
    "",
    "actual result differs",
    "Needs retest"
  ]), [
    "Actual result differs",
    "Needs retest"
  ]);

  assert.deepEqual(normalizeFailureCommentTemplates([]), [
    "Actual result differs",
    "Blocked by environment",
    "Needs retest"
  ]);
});

test("resolveUnsavedRunRecovery discards stale cache when server data is newer", () => {
  const serverRun = {
    id: "R1",
    savedAt: "2026-05-06T12:10:00.000Z",
    cases: [{ updatedAt: "2026-05-06T12:10:00.000Z" }]
  };
  const cached = {
    cachedAt: "2026-05-06T12:00:00.000Z",
    run: {
      id: "R1",
      cases: [{ updatedAt: "2026-05-06T11:59:00.000Z" }]
    }
  };

  const result = resolveUnsavedRunRecovery(serverRun, cached);
  assert.equal(result.action, "discard");
});

test("resolveUnsavedRunRecovery applies cache when cache timestamp is newer", () => {
  const serverRun = {
    id: "R1",
    savedAt: "2026-05-06T12:00:00.000Z",
    cases: [{ updatedAt: "2026-05-06T12:00:00.000Z" }]
  };
  const cachedRun = {
    id: "R1",
    cases: [{ updatedAt: "2026-05-06T12:06:00.000Z", currentStatus: "Passed" }]
  };
  const result = resolveUnsavedRunRecovery(serverRun, {
    cachedAt: "2026-05-06T12:06:00.000Z",
    run: cachedRun
  });

  assert.equal(result.action, "apply");
  assert.equal(result.run, cachedRun);
});

test("resolveUnsavedRunRecovery keeps cache pending when timestamps are invalid", () => {
  const serverRun = {
    id: "R1",
    savedAt: "not-a-time",
    cases: [{ updatedAt: "" }]
  };
  const cachedRun = {
    id: "R1",
    cases: [{ updatedAt: "also-bad" }]
  };
  const result = resolveUnsavedRunRecovery(serverRun, {
    cachedAt: "bad-time",
    run: cachedRun
  });

  assert.equal(result.action, "pending");
  assert.equal(result.run, cachedRun);
});

test("latestRunTimestamp returns most recent valid timestamp from run fields", () => {
  const timestamp = latestRunTimestamp({
    importedAt: "2026-05-06T10:00:00.000Z",
    savedAt: "2026-05-06T11:00:00.000Z",
    cases: [
      { updatedAt: "2026-05-06T09:00:00.000Z" },
      { updatedAt: "2026-05-06T12:00:00.000Z" }
    ]
  });

  assert.equal(timestamp, Date.parse("2026-05-06T12:00:00.000Z"));
});

test("getRunSafetyTimestamps reports latest save and browser-local export state", () => {
  const run = {
    id: "run-1",
    importedAt: "2026-05-06T09:00:00.000Z",
    savedAt: "2026-05-06T12:00:00.000Z",
    cases: [{ updatedAt: "2026-05-06T10:00:00.000Z" }]
  };

  assert.deepEqual(getRunSafetyTimestamps(run, {
    "run-1": { exportedAt: "2026-05-06T13:00:00.000Z", type: "csv" }
  }), {
    savedAt: "2026-05-06T12:00:00.000Z",
    exportedAt: "2026-05-06T13:00:00.000Z",
    exportType: "csv"
  });
});

test("getRunSafetyTimestamps falls back to latest run timestamp when savedAt is missing", () => {
  const run = {
    id: "run-2",
    importedAt: "2026-05-06T09:00:00.000Z",
    cases: [{ updatedAt: "2026-05-06T10:00:00.000Z" }]
  };

  assert.equal(getRunSafetyTimestamps(run, {}).savedAt, "2026-05-06T10:00:00.000Z");
});

test("normalizeRun materializes available statuses and editable step state", () => {
  const run = normalizeRun({
    id: "run",
    cases: [{
      localId: "T1",
      originalStatus: "Ready For QA",
      currentStatus: "Ready For QA",
      rawRow: {
        "Steps (Step)": "1. Open page",
        "Steps (Expected Result)": "1. Page opens",
        "Steps (Status)": "1. Needs Review"
      }
    }]
  });

  assert.deepEqual(run.availableStatuses, ["Ready For QA", "Needs Review"]);
  assert.equal(run.cases[0].steps[0].status, "Needs Review");
  assert.equal(run.cases[0].steps[0].currentStatus, "Needs Review");
});

test("normalizeRun preserves blank local step status when no imported step status exists", () => {
  const run = normalizeRun({
    id: "run",
    cases: [{
      localId: "T1",
      originalStatus: "Passed",
      currentStatus: "Passed",
      steps: [{
        step: "Open page",
        expectedResult: "Page opens",
        status: "",
        currentStatus: ""
      }]
    }]
  });

  assert.equal(run.cases[0].steps[0].status, "");
  assert.equal(run.cases[0].steps[0].currentStatus, "");
});

test("getEffectiveStepStatus returns the UI-visible local step override", () => {
  assert.equal(getEffectiveStepStatus({
    status: "Untested",
    localCurrentStatus: "Passed",
    currentStatus: "Passed"
  }), "Passed");
  assert.equal(getEffectiveStepStatus({
    status: "Untested",
    localCurrentStatus: "",
    currentStatus: "Untested"
  }), "Untested");
});

test("sortSavedRuns orders runs by newest, oldest, run name, and run ID", () => {
  const runs = [
    {
      id: "run-c",
      runName: "Zulu",
      runId: "R-20",
      importedAt: "2026-05-06T08:00:00.000Z",
      savedAt: "2026-05-06T09:00:00.000Z",
      updatedAt: "2026-05-06T09:00:00.000Z"
    },
    {
      id: "run-a",
      runName: "Alpha",
      runId: "R-02",
      importedAt: "2026-05-06T07:00:00.000Z",
      savedAt: "2026-05-06T12:00:00.000Z",
      updatedAt: "2026-05-06T12:00:00.000Z"
    },
    {
      id: "run-b",
      runName: "Bravo",
      runId: "R-10",
      importedAt: "2026-05-06T06:00:00.000Z",
      savedAt: "2026-05-06T10:00:00.000Z",
      updatedAt: "2026-05-06T10:00:00.000Z"
    }
  ];

  assert.deepEqual(sortSavedRuns(runs, "newest").map((run) => run.id), ["run-a", "run-b", "run-c"]);
  assert.deepEqual(sortSavedRuns(runs, "oldest").map((run) => run.id), ["run-c", "run-b", "run-a"]);
  assert.deepEqual(sortSavedRuns(runs, "run-name").map((run) => run.id), ["run-a", "run-b", "run-c"]);
  assert.deepEqual(sortSavedRuns(runs, "run-id").map((run) => run.id), ["run-a", "run-b", "run-c"]);
});

test("getNextSavedRunIdAfterDeletion switches only when the active run was deleted", () => {
  const runs = [
    { id: "run-a", runName: "Alpha", runId: "R-02", updatedAt: "2026-05-06T12:00:00.000Z" },
    { id: "run-b", runName: "Bravo", runId: "R-10", updatedAt: "2026-05-06T10:00:00.000Z" },
    { id: "run-c", runName: "Zulu", runId: "R-20", updatedAt: "2026-05-06T09:00:00.000Z" }
  ];

  assert.equal(getNextSavedRunIdAfterDeletion(runs, "run-b", "run-b", "newest"), "run-a");
  assert.equal(getNextSavedRunIdAfterDeletion(runs, "run-c", "run-a", "newest"), "run-a");
  assert.equal(getNextSavedRunIdAfterDeletion([{ id: "run-a" }], "run-a", "run-a", "newest"), null);
});
