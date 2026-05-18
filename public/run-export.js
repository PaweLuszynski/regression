const coreCsvColumns = [
  csvColumn("Run ID", (_run, testCase) => testCase.rawRow?.["Run ID"] || _run.runId || ""),
  csvColumn("Run Name", (run, testCase) => testCase.rawRow?.Run || run.runName || ""),
  csvColumn("Sheet Name", (run) => run.sheetName || ""),
  csvColumn("Source File Name", (run) => run.sourceFileName || ""),
  csvColumn("ID", (_run, testCase) => testCase.testId || testCase.rawRow?.ID || ""),
  csvColumn("Case ID", (_run, testCase) => testCase.caseId || testCase.rawRow?.["Case ID"] || ""),
  csvColumn("Title", (_run, testCase) => testCase.title || testCase.rawRow?.Title || ""),
  csvColumn("Section", (_run, testCase) => testCase.section || testCase.rawRow?.Section || ""),
  csvColumn("Section Hierarchy", (_run, testCase) => testCase.sectionHierarchy || testCase.rawRow?.["Section Hierarchy"] || ""),
  csvColumn("Original Status", (_run, testCase) => testCase.originalStatus || testCase.rawRow?.Status || ""),
  csvColumn("Current Status", (_run, testCase) => testCase.currentStatus || ""),
  csvColumn("Local Notes", (_run, testCase) => testCase.localNotes || ""),
  csvColumn("Local Defects", (_run, testCase) => testCase.localDefects || ""),
  csvColumn("Local Evidence", (_run, testCase) => testCase.localEvidence || ""),
  csvColumn("Updated At", (_run, testCase) => testCase.updatedAt || "")
];

const extendedCsvColumns = [
  csvColumn("Assigned To", (_run, testCase) => testCase.assignedTo || testCase.rawRow?.["Assigned To"] || ""),
  csvColumn("Priority", (_run, testCase) => testCase.priority || testCase.rawRow?.Priority || ""),
  csvColumn("Type", (_run, testCase) => testCase.type || testCase.rawRow?.Type || ""),
  csvColumn("Template", (_run, testCase) => testCase.template || testCase.rawRow?.Template || ""),
  csvColumn("References", (_run, testCase) => testCase.references || testCase.rawRow?.References || ""),
  csvColumn("Tested By", (_run, testCase) => testCase.testedBy || testCase.rawRow?.["Tested By"] || ""),
  csvColumn("Tested On", (_run, testCase) => testCase.testedOn || testCase.rawRow?.["Tested On"] || ""),
  csvColumn("Preconditions", (_run, testCase) => testCase.preconditions || testCase.rawRow?.Preconditions || ""),
  csvColumn("Expected Result", (_run, testCase) => testCase.expectedResult || testCase.rawRow?.["Expected Result"] || ""),
  csvColumn("Steps", (_run, testCase) => testCase.stepsCombined || testCase.rawRow?.Steps || ""),
  csvColumn("Steps (Step)", (_run, testCase) => testCase.stepsStep || testCase.rawRow?.["Steps (Step)"] || ""),
  csvColumn("Steps (Expected Result)", (_run, testCase) => testCase.stepsExpectedResult || testCase.rawRow?.["Steps (Expected Result)"] || ""),
  csvColumn("Steps (Status)", (_run, testCase) => testCase.stepsStatus || testCase.rawRow?.["Steps (Status)"] || ""),
  csvColumn("Test Case Labels", (_run, testCase) => testCase.testCaseLabels || testCase.rawRow?.["Test Case Labels"] || ""),
  csvColumn("Test Labels", (_run, testCase) => testCase.rawRow?.["Test Labels"] || ""),
  csvColumn("Local Step Statuses", (_run, testCase) => serializeLocalStepStatuses(testCase.steps))
];

const exportedHeaders = new Set([
  ...coreCsvColumns.map((column) => column.header),
  ...extendedCsvColumns.map((column) => column.header)
]);

export function buildCsvExport(run) {
  const rawColumns = collectRawColumns(run).filter((header) => !exportedHeaders.has(header));
  const columns = [
    ...coreCsvColumns,
    ...extendedCsvColumns,
    ...rawColumns.map((header) => csvColumn(header, (_run, testCase) => testCase.rawRow?.[header] || ""))
  ];

  const rows = [columns.map((column) => column.header).join(",")];
  for (const testCase of run?.cases || []) {
    rows.push(columns.map((column) => csvEscape(column.getValue(run, testCase))).join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function collectRawColumns(run) {
  const ordered = [];
  const seen = new Set();
  const add = (header) => {
    if (!header || header === "__rowNumber" || seen.has(header)) {
      return;
    }
    seen.add(header);
    ordered.push(header);
  };

  for (const column of Array.isArray(run?.columns) ? run.columns : []) {
    add(String(column?.key || column?.name || "").trim());
  }
  for (const testCase of Array.isArray(run?.cases) ? run.cases : []) {
    for (const header of Object.keys(testCase?.rawRow || {})) {
      add(header);
    }
  }
  return ordered;
}

function serializeLocalStepStatuses(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "";
  }
  return steps.map((row) => resolveLocalStepStatus(row)).join("\n");
}

function csvColumn(header, getValue) {
  return { header, getValue };
}

function resolveLocalStepStatus(row) {
  if (!row || typeof row !== "object") {
    return "";
  }
  if (row.localCurrentStatus != null && String(row.localCurrentStatus) !== "") {
    return String(row.localCurrentStatus);
  }
  if (row.currentStatus && row.currentStatus !== row.status) {
    return String(row.currentStatus);
  }
  return "";
}
