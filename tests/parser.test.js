import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import zlib from "node:zlib";

import { inspectWorkbookFromBuffer, parseTestRailRunFromBuffer } from "../src/parser.js";

function dosDateTime() {
  const year = 2026 - 1980;
  const month = 5;
  const day = 5;
  const hour = 10;
  const minute = 30;
  const second = 0;
  return {
    time: (hour << 11) | (minute << 5) | (second / 2),
    date: (year << 9) | (month << 5) | day
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const [name, text] of entries) {
    const nameBuffer = Buffer.from(name);
    const content = Buffer.from(text);
    const compressed = zlib.deflateRawSync(content);
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function sheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const cellRef = `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}`;
      return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>${rowXml}</sheetData>
    </worksheet>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createWorkbook(sheetConfigs) {
  const sheets = Array.isArray(sheetConfigs?.[0])
    ? [{ name: "Worksheet", rows: sheetConfigs }]
    : sheetConfigs;
  const overrides = sheets.map((sheet, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join("");
  const workbookSheets = sheets.map((sheet, index) => (
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join("");
  const relationships = sheets.map((sheet, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join("");
  const entries = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}
      </Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>${workbookSheets}</sheets>
      </workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}
      </Relationships>`]
  ];
  for (const [index, sheet] of sheets.entries()) {
    entries.push([`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet.rows)]);
  }
  return createZip(entries);
}

const headers = [
  "ID",
  "Title",
  "Steps",
  "Steps",
  "Assigned To",
  "Case ID",
  "Comment",
  "Defects",
  "Expected Result",
  "Preconditions",
  "Priority",
  "References",
  "Run",
  "Run ID",
  "Section",
  "Section Hierarchy",
  "Status",
  "Steps (Expected Result)",
  "Steps (Status)",
  "Steps (Step)",
  "Template",
  "Tested By",
  "Tested On",
  "Type"
];

test("parses TestRail rows while preserving duplicate headers and raw values", async () => {
  const workbook = createWorkbook([
    headers,
    [
      "T4142",
      "Can log in",
      "duplicate one",
      "Step Description: open login\\nExpected Result: form displays",
      "Lisa Speicher",
      "C109",
      "<p>Imported comment</p>",
      "BUG-7",
      "Dashboard opens",
      "<ul><li>User exists</li></ul>",
      "Medium",
      "REQ-1",
      "Full regression Chrome 2.11v",
      "R30",
      "Authentication",
      "Smoke > Authentication",
      "Passed",
      "<p>See dashboard</p>",
      "Untested",
      "<p>Submit credentials</p>",
      "Test Case (Steps)",
      "Lisa Speicher",
      "2026-05-04",
      "Functional"
    ]
  ]);

  const run = await parseTestRailRunFromBuffer(workbook, {
    sourceFileName: "testrail_run_export.xlsx"
  });

  assert.equal(run.sheetName, "Worksheet");
  assert.equal(run.runName, "Full regression Chrome 2.11v");
  assert.equal(run.runId, "R30");
  assert.deepEqual(run.columns.slice(0, 4).map((column) => column.key), [
    "ID",
    "Title",
    "Steps",
    "Steps__2"
  ]);

  assert.equal(run.cases.length, 1);
  const testCase = run.cases[0];
  assert.equal(testCase.testId, "T4142");
  assert.equal(testCase.caseId, "C109");
  assert.equal(testCase.title, "Can log in");
  assert.equal(testCase.assignedTo, "Lisa Speicher");
  assert.equal(testCase.priority, "Medium");
  assert.equal(testCase.section, "Authentication");
  assert.equal(testCase.originalStatus, "Passed");
  assert.equal(testCase.currentStatus, "Passed");
  assert.equal(testCase.importedComment, "Imported comment");
  assert.equal(testCase.importedDefects, "BUG-7");
  assert.equal(testCase.references, "REQ-1");
  assert.equal(testCase.preconditions, "- User exists");
  assert.equal(testCase.expectedResult, "Dashboard opens");
  assert.equal(testCase.stepsStep, "Submit credentials");
  assert.equal(testCase.stepsExpectedResult, "See dashboard");
  assert.equal(testCase.stepsStatus, "Untested");
  assert.deepEqual(testCase.steps, [{
    step: "Submit credentials",
    expectedResult: "See dashboard",
    status: "Untested",
    additionalInfo: "",
    references: ""
  }]);
  assert.equal(testCase.testedBy, "Lisa Speicher");
  assert.equal(testCase.testedOn, "2026-05-04");
  assert.equal(testCase.type, "Functional");
  assert.equal(testCase.template, "Test Case (Steps)");
  assert.equal(testCase.rawRow.Steps, "duplicate one");
  assert.equal(testCase.rawRow.Steps__2, "Step Description: open login\\nExpected Result: form displays");
});

test("falls back to rich duplicate Steps when explicit step columns are empty", async () => {
  const workbook = createWorkbook([
    headers,
    [
      "T5000", "Fallback case", "", "Step Description: do thing\\nExpected Result: it works",
      "Lisa Speicher", "C500", "", "", "", "", "High", "", "Full regression Chrome 2.11v",
      "R30", "Section", "Section", "Untested", "", "", "", "Template", "", "", "Functional"
    ]
  ]);

  const run = await parseTestRailRunFromBuffer(workbook, {
    sourceFileName: "testrail_run_export.xlsx"
  });

  assert.equal(run.cases[0].stepsCombined, "Step Description: do thing\\nExpected Result: it works");
  assert.equal(run.cases[0].stepsStep, "Step Description: do thing\\nExpected Result: it works");
  assert.equal(run.cases[0].stepsExpectedResult, "");
});

test("inspects multi-sheet workbooks and requires explicit selection when multiple sheets are usable", async () => {
  const workbook = createWorkbook([
    { name: "Smoke", rows: [headers, ["T1", "Smoke case", "", "", "", "C1", "", "", "", "", "", "", "Smoke Run", "R1", "Section", "Plan > Smoke", "Untested", "", "", "", "", "", "", "Functional"]] },
    { name: "Regression", rows: [headers, ["T2", "Regression case", "", "", "", "C2", "", "", "", "", "", "", "Regression Run", "R2", "Section", "Plan > Regression", "Passed", "", "Needs Review", "1. Confirm result", "", "", "", "Functional"]] }
  ]);

  const inspection = inspectWorkbookFromBuffer(workbook);
  assert.deepEqual(inspection.usableSheets.map((sheet) => sheet.name), ["Smoke", "Regression"]);

  await assert.rejects(
    () => parseTestRailRunFromBuffer(workbook, { sourceFileName: "multi.xlsx" }),
    /Multiple usable worksheets were found/
  );
});

test("parses the explicitly selected worksheet from a multi-sheet workbook", async () => {
  const workbook = createWorkbook([
    { name: "Smoke", rows: [headers, ["T1", "Smoke case", "", "", "", "C1", "", "", "", "", "", "", "Smoke Run", "R1", "Section", "Plan > Smoke", "Untested", "", "", "", "", "", "", "Functional"]] },
    { name: "Regression", rows: [headers, ["T2", "Regression case", "", "", "", "C2", "", "", "", "", "", "", "Regression Run", "R2", "Section", "Plan > Regression", "Ready For QA", "", "Needs Review", "1. Confirm result", "", "", "", "Functional"]] }
  ]);

  const run = await parseTestRailRunFromBuffer(workbook, {
    sourceFileName: "multi.xlsx",
    sheetName: "Regression"
  });

  assert.equal(run.sheetName, "Regression");
  assert.equal(run.runId, "R2");
  assert.equal(run.cases[0].testId, "T2");
});

test("falls back to the single usable worksheet when other sheets are empty", async () => {
  const workbook = createWorkbook([
    { name: "Summary", rows: [[""], [""]] },
    { name: "Worksheet", rows: [headers, ["T3", "Only usable case", "", "", "", "C3", "", "", "", "", "", "", "Run", "R3", "Section", "Plan > Main", "Untested", "", "", "", "", "", "", "Functional"]] }
  ]);

  const run = await parseTestRailRunFromBuffer(workbook, {
    sourceFileName: "single-usable.xlsx"
  });

  assert.equal(run.sheetName, "Worksheet");
  assert.equal(run.cases[0].testId, "T3");
});

test("rejects missing selected worksheets with a clear error", async () => {
  const workbook = createWorkbook([
    { name: "Worksheet", rows: [headers, ["T4", "Case", "", "", "", "C4", "", "", "", "", "", "", "Run", "R4", "Section", "Plan > Main", "Untested", "", "", "", "", "", "", "Functional"]] }
  ]);

  await assert.rejects(
    () => parseTestRailRunFromBuffer(workbook, {
      sourceFileName: "missing-sheet.xlsx",
      sheetName: "NotHere"
    }),
    /Selected worksheet 'NotHere' was not found/
  );
});

test("rejects invalid workbooks with useful errors", async () => {
  await assert.rejects(
    () => parseTestRailRunFromBuffer(Buffer.from("not an xlsx"), { sourceFileName: "bad.xlsx" }),
    /Invalid XLSX file/
  );
});

test("rejects sheets without headers or rows", async () => {
  const emptyWorkbook = createWorkbook([{ name: "Worksheet", rows: [] }]);
  await assert.rejects(
    () => parseTestRailRunFromBuffer(emptyWorkbook, { sourceFileName: "empty.xlsx" }),
    /No headers were detected/
  );

  const headerOnlyWorkbook = createWorkbook([{ name: "Worksheet", rows: [headers] }]);
  await assert.rejects(
    () => parseTestRailRunFromBuffer(headerOnlyWorkbook, { sourceFileName: "header-only.xlsx" }),
    /No test rows were detected/
  );
});
