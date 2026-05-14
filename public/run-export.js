const csvFields = [
  ["Run ID", "runId"],
  ["Run Name", "runName"],
  ["Sheet Name", "sheetName"],
  ["Source File Name", "sourceFileName"],
  ["ID", "testId"],
  ["Case ID", "caseId"],
  ["Title", "title"],
  ["Section", "section"],
  ["Section Hierarchy", "sectionHierarchy"],
  ["Original Status", "originalStatus"],
  ["Current Status", "currentStatus"],
  ["Local Notes", "localNotes"],
  ["Local Defects", "localDefects"],
  ["Local Evidence", "localEvidence"],
  ["Updated At", "updatedAt"]
];

export function buildCsvExport(run) {
  const rows = [csvFields.map(([name]) => name).join(",")];
  for (const testCase of run?.cases || []) {
    rows.push(csvFields.map(([, field]) => {
      if (field === "runId") return csvEscape(run.runId || "");
      if (field === "runName") return csvEscape(run.runName || "");
      if (field === "sheetName") return csvEscape(run.sheetName || "");
      if (field === "sourceFileName") return csvEscape(run.sourceFileName || "");
      return csvEscape(testCase[field] || "");
    }).join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function csvEscape(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
