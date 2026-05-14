import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import zlib from "node:zlib";

import { buildCsvExport } from "../public/run-export.js";
import { parseTestRailRunFromBuffer } from "../src/parser.js";
import { parseRunProgressCsv } from "../src/run-csv.js";
import { parseRunProgressJson } from "../src/run-json.js";

test("XLSX edit round-trips through JSON export/import while preserving local progress and rawRow", async () => {
  const importedRun = await parseTestRailRunFromBuffer(createWorkbook([
    headers,
    [
      "T300",
      "Round-trip login",
      "",
      "",
      "QA User",
      "C300",
      "Imported comment",
      "BUG-0",
      "REQ-300",
      "User exists",
      "High",
      "Dashboard opens",
      "Round Trip Run",
      "R300",
      "Authentication",
      "Suite > Authentication",
      "Untested",
      "",
      "Untested",
      "1. Dashboard opens",
      "Test Case (Steps)",
      "",
      "",
      "Functional"
    ]
  ]), { sourceFileName: "roundtrip.xlsx" });

  importedRun.cases[0].currentStatus = "Passed";
  importedRun.cases[0].localNotes = "JSON note";
  importedRun.cases[0].localDefects = "BUG-300";
  importedRun.cases[0].localEvidence = "video.mp4";
  importedRun.cases[0].steps[0].currentStatus = "Blocked";

  const restoredRun = parseRunProgressJson(JSON.stringify(importedRun));

  assert.equal(restoredRun.cases[0].originalStatus, "Untested");
  assert.equal(restoredRun.cases[0].currentStatus, "Passed");
  assert.equal(restoredRun.cases[0].localNotes, "JSON note");
  assert.equal(restoredRun.cases[0].localDefects, "BUG-300");
  assert.equal(restoredRun.cases[0].localEvidence, "video.mp4");
  assert.equal(restoredRun.cases[0].steps[0].status, "Untested");
  assert.equal(restoredRun.cases[0].steps[0].currentStatus, "Blocked");
  assert.equal(restoredRun.cases[0].rawRow.Comment, "Imported comment");
});

test("XLSX edit round-trips through CSV export/import while preserving supported local progress and key raw fields", async () => {
  const importedRun = await parseTestRailRunFromBuffer(createWorkbook([
    headers,
    [
      "T301",
      "Round-trip checkout",
      "",
      "",
      "QA User",
      "C301",
      "Imported comment",
      "BUG-0",
      "REQ-301",
      "User exists",
      "High",
      "Order placed",
      "Round Trip Run",
      "R301",
      "Checkout",
      "Suite > Checkout",
      "Untested",
      "",
      "Untested",
      "1. Confirmation shown",
      "Test Case",
      "",
      "",
      "Functional"
    ]
  ]), { sourceFileName: "roundtrip.csv.xlsx" });

  importedRun.cases[0].currentStatus = "Failed";
  importedRun.cases[0].localNotes = "CSV note";
  importedRun.cases[0].localDefects = "BUG-301";
  importedRun.cases[0].localEvidence = "screenshot.png";
  importedRun.cases[0].steps[0].currentStatus = "Blocked";
  importedRun.cases[0].steps[0].localCurrentStatus = "Blocked";

  const csv = buildCsvExport(importedRun);
  const restoredRun = parseRunProgressCsv(csv, { sourceFileName: "restored.csv" });

  assert.equal(restoredRun.cases[0].originalStatus, "Untested");
  assert.equal(restoredRun.cases[0].currentStatus, "Failed");
  assert.equal(restoredRun.cases[0].localNotes, "CSV note");
  assert.equal(restoredRun.cases[0].localDefects, "BUG-301");
  assert.equal(restoredRun.cases[0].localEvidence, "screenshot.png");
  assert.equal(restoredRun.runId, "R301");
  assert.equal(restoredRun.cases[0].priority, "High");
  assert.equal(restoredRun.cases[0].assignedTo, "QA User");
  assert.equal(restoredRun.cases[0].preconditions, "User exists");
  assert.equal(restoredRun.cases[0].importedComment, "Imported comment");
  assert.equal(restoredRun.cases[0].importedDefects, "BUG-0");
  assert.equal(restoredRun.cases[0].rawRow.Comment, "Imported comment");
  assert.equal(restoredRun.cases[0].steps[0].status, "Untested");
  assert.equal(restoredRun.cases[0].steps[0].currentStatus, "Blocked");
  assert.equal(restoredRun.cases[0].steps[0].localCurrentStatus, "Blocked");
});

const headers = [
  "ID",
  "Title",
  "Steps",
  "Steps",
  "Assigned To",
  "Case ID",
  "Comment",
  "Defects",
  "References",
  "Preconditions",
  "Priority",
  "Expected Result",
  "Run",
  "Run ID",
  "Section",
  "Section Hierarchy",
  "Status",
  "Tested By",
  "Steps (Status)",
  "Steps (Expected Result)",
  "Template",
  "Custom Step Results",
  "Tested On",
  "Type"
];

function createWorkbook(rowsOrSheets) {
  const sheets = Array.isArray(rowsOrSheets[0])
    ? [{ name: "Worksheet", rows: rowsOrSheets }]
    : rowsOrSheets;
  const sharedStrings = [];
  const sharedIndex = new Map();
  const worksheetEntries = [];
  const workbookSheets = [];
  const workbookRelationships = [];

  for (const [sheetIndex, sheet] of sheets.entries()) {
    const relationshipId = `rId${sheetIndex + 1}`;
    workbookSheets.push(`<sheet name="${escapeXml(sheet.name)}" sheetId="${sheetIndex + 1}" r:id="${relationshipId}"/>`);
    workbookRelationships.push(
      `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetIndex + 1}.xml"/>`
    );
    worksheetEntries.push([
      `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      buildWorksheetXml(sheet.rows, sharedStrings, sharedIndex)
    ]);
  }

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets.join("")}</sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelationships.join("")}
</Relationships>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
  ${sharedStrings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join("")}
</sst>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  return createZip([
    ["[Content_Types].xml", contentTypesXml],
    ["_rels/.rels", rootRelsXml],
    ["xl/workbook.xml", workbookXml],
    ["xl/_rels/workbook.xml.rels", workbookRelsXml],
    ["xl/sharedStrings.xml", sharedStringsXml],
    ...worksheetEntries
  ]);
}

function buildWorksheetXml(rows, sharedStrings, sharedIndex) {
  const rowXml = rows.map((row, rowIndex) => {
    const cellXml = row.map((value, columnIndex) => buildCellXml(value, rowIndex, columnIndex, sharedStrings, sharedIndex)).join("");
    return `<row r="${rowIndex + 1}">${cellXml}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function buildCellXml(value, rowIndex, columnIndex, sharedStrings, sharedIndex) {
  const text = String(value ?? "");
  if (!sharedIndex.has(text)) {
    sharedIndex.set(text, sharedStrings.length);
    sharedStrings.push(text);
  }
  const index = sharedIndex.get(text);
  return `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="s"><v>${index}</v></c>`;
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function dosDateTime() {
  const year = 2026 - 1980;
  const month = 5;
  const day = 14;
  const hour = 9;
  const minute = 0;
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
