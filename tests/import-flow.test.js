import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { test } from "node:test";
import zlib from "node:zlib";

import { createServer } from "../src/server.js";
import { createLegacyRunStorageKey } from "../src/parser.js";
import { progressPath } from "../src/server-runs.js";

test("HTTP import requires worksheet selection for multiple usable sheets and imports the selected sheet", async () => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-import-flow-"));
  const server = createServer({ host: "127.0.0.1", port: 4173, progressDir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const workbook = createWorkbook([
      { name: "Smoke", rows: [headers, ["T1", "Smoke", "", "", "", "C1", "", "", "", "", "", "", "Smoke Run", "R1", "Section", "Plan > Smoke", "Untested", "", "", "", "", "", "", "Functional"]] },
      { name: "Regression", rows: [headers, ["T2", "Regression", "", "", "", "C2", "", "", "", "", "", "", "Regression Run", "R2", "Section", "Plan > Regression", "Passed", "", "", "", "", "", "", "Functional"]] }
    ]);

    const selectionResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("multi-sheet.xlsx")
      },
      body: workbook
    });
    const selectionPayload = await selectionResponse.json();
    assert.equal(selectionResponse.status, 409);
    assert.equal(selectionPayload.worksheetSelectionRequired, true);
    assert.deepEqual(selectionPayload.availableSheets, ["Smoke", "Regression"]);

    const importResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("multi-sheet.xlsx"),
        "x-import-sheet-name": encodeURIComponent("Regression")
      },
      body: workbook
    });
    const importPayload = await importResponse.json();
    assert.equal(importResponse.status, 201);
    assert.equal(importPayload.run.sheetName, "Regression");
    assert.equal(importPayload.run.runId, "R2");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("HTTP import requires explicit resume or replace when saved local progress already exists", async () => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-import-collision-"));
  const server = createServer({ host: "127.0.0.1", port: 4173, progressDir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const workbook = createWorkbook([
      { name: "Worksheet", rows: [headers, ["T7", "Collision case", "", "", "", "C7", "", "", "", "", "", "", "Regression Run", "R7", "Section", "Plan > Main", "Untested", "", "", "", "", "", "", "Functional"]] }
    ]);

    const firstImport = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("collision.xlsx")
      },
      body: workbook
    });
    const firstPayload = await firstImport.json();
    assert.equal(firstImport.status, 201);

    const updatedRun = structuredClone(firstPayload.run);
    updatedRun.cases[0].localNotes = "Keep this progress";
    const saveResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(updatedRun.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run: updatedRun })
    });
    assert.equal(saveResponse.status, 200);

    const collisionResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("collision.xlsx")
      },
      body: workbook
    });
    const collisionPayload = await collisionResponse.json();
    assert.equal(collisionResponse.status, 409);
    assert.equal(collisionPayload.decisionRequired, true);
    assert.equal(collisionPayload.reason, "existing-progress");

    const resumeResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("collision.xlsx"),
        "x-import-existing-action": "resume"
      },
      body: workbook
    });
    const resumePayload = await resumeResponse.json();
    assert.equal(resumeResponse.status, 200);
    assert.equal(resumePayload.run.cases[0].localNotes, "Keep this progress");

    const replaceResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("collision.xlsx"),
        "x-import-existing-action": "replace"
      },
      body: workbook
    });
    const replacePayload = await replaceResponse.json();
    assert.equal(replaceResponse.status, 200);
    assert.equal(replacePayload.existingProgressReplaced, true);
    assert.equal(replacePayload.run.cases[0].localNotes, "");

    const savedRun = JSON.parse(await readFile(progressPath(progressDir, replacePayload.run.id), "utf8"));
    assert.equal(savedRun.cases[0].localNotes, "");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("HTTP import collision uses the saved run key rather than the source file name", async () => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-import-run-key-"));
  const server = createServer({ host: "127.0.0.1", port: 4173, progressDir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const workbook = createWorkbook([
      { name: "Worksheet", rows: [headers, ["T11", "Stable ID case", "", "", "", "C11", "", "", "", "", "", "", "Shared Run", "R11", "Section", "Plan > Main", "Untested", "", "", "", "", "", "", "Functional"]] }
    ]);

    const firstImport = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("first-name.xlsx")
      },
      body: workbook
    });
    assert.equal(firstImport.status, 201);

    const collisionResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("different-name.xlsx")
      },
      body: workbook
    });
    const collisionPayload = await collisionResponse.json();
    assert.equal(collisionResponse.status, 409);
    assert.equal(collisionPayload.decisionRequired, true);
    assert.equal(collisionPayload.importedRunSummary.runId, "R11");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("HTTP worksheet selection does not bypass existing-progress collision handling", async () => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-import-sheet-collision-"));
  const server = createServer({ host: "127.0.0.1", port: 4173, progressDir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const workbook = createWorkbook([
      { name: "Archive", rows: [headers, ["T20", "Archive case", "", "", "", "C20", "", "", "", "", "", "", "Archive Run", "R20", "Section", "Plan > Archive", "Untested", "", "", "", "", "", "", "Functional"]] },
      { name: "Main", rows: [headers, ["T21", "Main case", "", "", "", "C21", "", "", "", "", "", "", "Main Run", "R21", "Section", "Plan > Main", "Untested", "", "", "", "", "", "", "Functional"]] }
    ]);

    const firstImport = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("multi.xlsx"),
        "x-import-sheet-name": encodeURIComponent("Main")
      },
      body: workbook
    });
    const firstPayload = await firstImport.json();
    assert.equal(firstImport.status, 201);

    const updatedRun = structuredClone(firstPayload.run);
    updatedRun.cases[0].localNotes = "preserve me";
    const saveResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(updatedRun.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run: updatedRun })
    });
    assert.equal(saveResponse.status, 200);

    const initialSelectionResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("multi.xlsx")
      },
      body: workbook
    });
    const initialSelectionPayload = await initialSelectionResponse.json();
    assert.equal(initialSelectionResponse.status, 409);
    assert.equal(initialSelectionPayload.worksheetSelectionRequired, true);

    const collisionResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("multi.xlsx"),
        "x-import-sheet-name": encodeURIComponent("Main")
      },
      body: workbook
    });
    const collisionPayload = await collisionResponse.json();
    assert.equal(collisionResponse.status, 409);
    assert.equal(collisionPayload.decisionRequired, true);
    assert.equal(collisionPayload.reason, "existing-progress");
    assert.equal(collisionPayload.importedRunSummary.sheetName, "Main");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("HTTP import collision still finds legacy filename-based saved runs", async () => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-import-legacy-collision-"));
  const server = createServer({ host: "127.0.0.1", port: 4173, progressDir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const workbook = createWorkbook([
      { name: "Worksheet", rows: [headers, ["T31", "Legacy collision", "", "", "", "C31", "", "", "", "", "", "", "Legacy Run", "R31", "Section", "Plan > Main", "Untested", "", "", "", "", "", "", "Functional"]] }
    ]);

    const legacyId = createLegacyRunStorageKey("R31", "legacy-name.xlsx");
    await writeFile(progressPath(progressDir, legacyId), JSON.stringify({
      id: legacyId,
      sourceFileName: "legacy-name.xlsx",
      sheetName: "Worksheet",
      runName: "Legacy Run",
      runId: "R31",
      importedAt: "2026-05-13T10:00:00.000Z",
      savedAt: "2026-05-13T10:01:00.000Z",
      columns: [{ index: 0, name: "ID", key: "ID" }],
      cases: [{
        localId: "T31",
        testId: "T31",
        caseId: "C31",
        title: "Legacy collision",
        originalStatus: "Untested",
        currentStatus: "Passed",
        localNotes: "legacy progress",
        localDefects: "",
        localEvidence: "",
        updatedAt: "2026-05-13T10:02:00.000Z",
        rawRow: { ID: "T31", Status: "Untested" },
        steps: []
      }]
    }, null, 2));

    const collisionResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("new-name.xlsx")
      },
      body: workbook
    });
    const collisionPayload = await collisionResponse.json();
    assert.equal(collisionResponse.status, 409);
    assert.equal(collisionPayload.decisionRequired, true);

    const resumeResponse = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("new-name.xlsx"),
        "x-import-existing-action": "resume"
      },
      body: workbook
    });
    const resumePayload = await resumeResponse.json();
    assert.equal(resumeResponse.status, 200);
    assert.equal(resumePayload.run.cases[0].localNotes, "legacy progress");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("HTTP import rejects missing selected worksheets with a readable error", async () => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-import-missing-sheet-"));
  const server = createServer({ host: "127.0.0.1", port: 4173, progressDir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const workbook = createWorkbook([
      { name: "Worksheet", rows: [headers, ["T9", "Case", "", "", "", "C9", "", "", "", "", "", "", "Run", "R9", "Section", "Plan > Main", "Untested", "", "", "", "", "", "", "Functional"]] }
    ]);

    const response = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("missing-sheet.xlsx"),
        "x-import-sheet-name": encodeURIComponent("NotHere")
      },
      body: workbook
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.match(payload.error, /Selected worksheet 'NotHere' was not found/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

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

function createWorkbook(sheets) {
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
