import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";

import { progressPath } from "../src/server-runs.js";
import { createServer } from "../src/server.js";

const headers = [
  "ID",
  "Title",
  "Case ID",
  "Run",
  "Run ID",
  "Section",
  "Section Hierarchy",
  "Status",
  "Comment",
  "Defects",
  "Assigned To",
  "Priority"
];

test("HTTP run endpoints support import save list open and export flows", async (t) => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-http-"));
  const { server, baseUrl } = await startTestServer(progressDir);
  t.after(() => server.close());

  const workbook = createWorkbook([
    headers,
    [
      "T100",
      "Imported via HTTP",
      "C100",
      "API flow",
      "R100",
      "Smoke",
      "Plan > Smoke",
      "Untested",
      "Imported comment",
      "BUG-100",
      "Taylor",
      "High"
    ]
  ]);

  const importResponse = await fetch(`${baseUrl}/api/import`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent("http-import.xlsx")
    },
    body: workbook
  });
  assert.equal(importResponse.status, 201);
  const importPayload = await importResponse.json();
  assert.equal(importPayload.existingProgressFound, false);
  assert.equal(importPayload.run.runId, "R100");
  assert.equal(importPayload.run.cases[0].currentStatus, "Untested");

  const listResponse = await fetch(`${baseUrl}/api/runs`);
  assert.equal(listResponse.status, 200);
  const listPayload = await listResponse.json();
  assert.equal(listPayload.runs.length, 1);
  assert.equal(listPayload.runs[0].id, importPayload.run.id);

  const openResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(importPayload.run.id)}`);
  assert.equal(openResponse.status, 200);
  const openPayload = await openResponse.json();
  assert.equal(openPayload.run.cases[0].importedComment, "Imported comment");

  const updatedRun = structuredClone(openPayload.run);
  updatedRun.cases[0].currentStatus = "Passed";
  updatedRun.cases[0].localNotes = "Saved over HTTP";

  const saveResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(updatedRun.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run: updatedRun })
  });
  assert.equal(saveResponse.status, 200);
  const savePayload = await saveResponse.json();
  assert.equal(savePayload.run.cases[0].currentStatus, "Passed");
  assert.equal(savePayload.run.cases[0].localNotes, "Saved over HTTP");

  const savedFile = JSON.parse(await readFile(progressPath(progressDir, updatedRun.id), "utf8"));
  assert.equal(savedFile.cases[0].currentStatus, "Passed");
  assert.equal(savedFile.cases[0].localNotes, "Saved over HTTP");

  const exportResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(updatedRun.id)}/export`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-disposition") || "", new RegExp(`${updatedRun.id}\\.json`));
  const exportedRun = await exportResponse.json();
  assert.equal(exportedRun.cases[0].currentStatus, "Passed");
  assert.equal(exportedRun.cases[0].localNotes, "Saved over HTTP");
});

test("HTTP run endpoints return readable errors for representative failures", async (t) => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-http-"));
  const { server, baseUrl } = await startTestServer(progressDir);
  t.after(() => server.close());

  const missingResponse = await fetch(`${baseUrl}/api/runs/missing-run`);
  assert.equal(missingResponse.status, 404);
  assert.match((await missingResponse.json()).error, /not found/i);

  const invalidSaveResponse = await fetch(`${baseUrl}/api/runs/bad-run`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run: { id: "other-run", cases: [] } })
  });
  assert.equal(invalidSaveResponse.status, 400);
  assert.match((await invalidSaveResponse.json()).error, /invalid run payload/i);
});

test("HTTP CSV import saves and reloads UI-visible local step statuses", async (t) => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-http-csv-"));
  const { server, baseUrl } = await startTestServer(progressDir);
  t.after(() => server.close());

  const csv = [
    "Run ID,Run Name,Sheet Name,Source File Name,ID,Title,Current Status,Steps (Step),Steps (Expected Result),Steps (Status),Local Step Statuses",
    "R900,CSV Restore,Worksheet,restore.csv,T900,Step restore,In test,\"First step\nSecond step\",\"First expected\nSecond expected\",\"Untested\nUntested\",\"Passed\nFailed\""
  ].join("\n");

  const importResponse = await fetch(`${baseUrl}/api/import-csv`, {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      "x-file-name": encodeURIComponent("restore.csv")
    },
    body: csv
  });
  const importPayload = await importResponse.json();

  assert.equal(importResponse.status, 201);
  assert.equal(importPayload.run.cases[0].steps[0].status, "Untested");
  assert.equal(importPayload.run.cases[0].steps[0].localCurrentStatus, "Passed");
  assert.equal(importPayload.run.cases[0].steps[0].currentStatus, "Passed");
  assert.equal(importPayload.run.cases[0].steps[1].status, "Untested");
  assert.equal(importPayload.run.cases[0].steps[1].localCurrentStatus, "Failed");
  assert.equal(importPayload.run.cases[0].steps[1].currentStatus, "Failed");

  const openResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(importPayload.run.id)}`);
  const openPayload = await openResponse.json();

  assert.equal(openResponse.status, 200);
  assert.equal(openPayload.run.cases[0].steps[0].currentStatus, "Passed");
  assert.equal(openPayload.run.cases[0].steps[1].currentStatus, "Failed");
});

test("HTTP JSON restore failure leaves existing saved run unchanged", async (t) => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-http-json-invalid-"));
  const { server, baseUrl } = await startTestServer(progressDir);
  t.after(() => server.close());

  const run = {
    id: "R903_Worksheet",
    sourceFileName: "restore.json",
    sheetName: "Worksheet",
    runName: "JSON Restore",
    runId: "R903",
    importedAt: "2026-05-15T10:00:00.000Z",
    columns: [{ index: 0, name: "ID", key: "ID" }],
    cases: [{
      localId: "T903",
      testId: "T903",
      caseId: "C903",
      title: "Keep existing JSON",
      originalStatus: "Untested",
      currentStatus: "Passed",
      localNotes: "keep me",
      updatedAt: "2026-05-15T10:01:00.000Z",
      rawRow: { ID: "T903", Status: "Untested" },
      steps: []
    }]
  };

  const firstImport = await fetch(`${baseUrl}/api/import-json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(run)
  });
  assert.equal(firstImport.status, 201);

  const invalidImport = await fetch(`${baseUrl}/api/import-json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json"
  });
  const invalidPayload = await invalidImport.json();
  assert.equal(invalidImport.status, 400);
  assert.match(invalidPayload.error, /Invalid JSON progress file/);

  const savedFile = JSON.parse(await readFile(progressPath(progressDir, run.id), "utf8"));
  assert.equal(savedFile.cases[0].currentStatus, "Passed");
  assert.equal(savedFile.cases[0].localNotes, "keep me");
});

test("HTTP CSV restore failure leaves existing saved run unchanged", async (t) => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-http-csv-invalid-"));
  const { server, baseUrl } = await startTestServer(progressDir);
  t.after(() => server.close());

  const csv = [
    "Run ID,Run Name,Sheet Name,Source File Name,ID,Title,Current Status,Local Notes",
    "R904,CSV Restore,Worksheet,restore.csv,T904,Keep existing CSV,Passed,keep me"
  ].join("\n");

  const firstImport = await fetch(`${baseUrl}/api/import-csv`, {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      "x-file-name": encodeURIComponent("restore.csv")
    },
    body: csv
  });
  const firstPayload = await firstImport.json();
  assert.equal(firstImport.status, 201);

  const invalidImport = await fetch(`${baseUrl}/api/import-csv`, {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      "x-file-name": encodeURIComponent("restore.csv")
    },
    body: 'ID,Title,Current Status\nT904,"Bad"quote,Failed'
  });
  const invalidPayload = await invalidImport.json();
  assert.equal(invalidImport.status, 400);
  assert.match(invalidPayload.error, /Invalid CSV progress file/);

  const savedFile = JSON.parse(await readFile(progressPath(progressDir, firstPayload.run.id), "utf8"));
  assert.equal(savedFile.cases[0].currentStatus, "Passed");
  assert.equal(savedFile.cases[0].localNotes, "keep me");
});

test("HTTP JSON import requires resume or replace decision before overwriting saved progress", async (t) => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-http-json-collision-"));
  const { server, baseUrl } = await startTestServer(progressDir);
  t.after(() => server.close());

  const progressRun = {
    id: "R901_Worksheet",
    sourceFileName: "restore.json",
    sheetName: "Worksheet",
    runName: "JSON Restore",
    runId: "R901",
    importedAt: "2026-05-15T10:00:00.000Z",
    columns: [{ index: 0, name: "ID", key: "ID" }],
    cases: [{
      localId: "T901",
      testId: "T901",
      caseId: "C901",
      title: "JSON collision",
      originalStatus: "Untested",
      currentStatus: "Passed",
      localNotes: "fresh progress",
      localDefects: "",
      localEvidence: "",
      updatedAt: "2026-05-15T10:01:00.000Z",
      rawRow: { ID: "T901", Status: "Untested" },
      steps: []
    }]
  };

  const firstImport = await fetch(`${baseUrl}/api/import-json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(progressRun)
  });
  const firstPayload = await firstImport.json();
  assert.equal(firstImport.status, 201);

  const savedRun = structuredClone(firstPayload.run);
  savedRun.cases[0].localNotes = "do not overwrite silently";
  const saveResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(savedRun.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run: savedRun })
  });
  assert.equal(saveResponse.status, 200);

  const collisionResponse = await fetch(`${baseUrl}/api/import-json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(progressRun)
  });
  const collisionPayload = await collisionResponse.json();
  assert.equal(collisionResponse.status, 409);
  assert.equal(collisionPayload.decisionRequired, true);
  assert.equal(collisionPayload.reason, "existing-progress");
  assert.equal(collisionPayload.importedRunSummary.runId, "R901");

  const stillSaved = JSON.parse(await readFile(progressPath(progressDir, savedRun.id), "utf8"));
  assert.equal(stillSaved.cases[0].localNotes, "do not overwrite silently");

  const resumeResponse = await fetch(`${baseUrl}/api/import-json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-import-existing-action": "resume"
    },
    body: JSON.stringify(progressRun)
  });
  const resumePayload = await resumeResponse.json();
  assert.equal(resumeResponse.status, 200);
  assert.equal(resumePayload.existingProgressFound, true);
  assert.match(resumePayload.message, /kept and loaded/i);
  assert.equal(resumePayload.run.cases[0].localNotes, "do not overwrite silently");

  const replaceResponse = await fetch(`${baseUrl}/api/import-json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-import-existing-action": "replace"
    },
    body: JSON.stringify(progressRun)
  });
  const replacePayload = await replaceResponse.json();
  assert.equal(replaceResponse.status, 200);
  assert.equal(replacePayload.existingProgressReplaced, true);
  assert.equal(replacePayload.run.cases[0].localNotes, "fresh progress");
});

test("HTTP CSV import requires resume or replace decision before overwriting saved progress", async (t) => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-http-csv-collision-"));
  const { server, baseUrl } = await startTestServer(progressDir);
  t.after(() => server.close());

  const csv = [
    "Run ID,Run Name,Sheet Name,Source File Name,ID,Title,Current Status,Local Notes",
    "R902,CSV Restore,Worksheet,restore.csv,T902,CSV collision,Passed,fresh csv progress"
  ].join("\n");

  const firstImport = await fetch(`${baseUrl}/api/import-csv`, {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      "x-file-name": encodeURIComponent("restore.csv")
    },
    body: csv
  });
  const firstPayload = await firstImport.json();
  assert.equal(firstImport.status, 201);

  const savedRun = structuredClone(firstPayload.run);
  savedRun.cases[0].localNotes = "keep until confirmed";
  const saveResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(savedRun.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run: savedRun })
  });
  assert.equal(saveResponse.status, 200);

  const collisionResponse = await fetch(`${baseUrl}/api/import-csv`, {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      "x-file-name": encodeURIComponent("restore.csv")
    },
    body: csv
  });
  const collisionPayload = await collisionResponse.json();
  assert.equal(collisionResponse.status, 409);
  assert.equal(collisionPayload.decisionRequired, true);
  assert.equal(collisionPayload.reason, "existing-progress");
  assert.equal(collisionPayload.importedRunSummary.runId, "R902");

  const stillSaved = JSON.parse(await readFile(progressPath(progressDir, savedRun.id), "utf8"));
  assert.equal(stillSaved.cases[0].localNotes, "keep until confirmed");

  const resumeResponse = await fetch(`${baseUrl}/api/import-csv`, {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      "x-file-name": encodeURIComponent("restore.csv"),
      "x-import-existing-action": "resume"
    },
    body: csv
  });
  const resumePayload = await resumeResponse.json();
  assert.equal(resumeResponse.status, 200);
  assert.equal(resumePayload.existingProgressFound, true);
  assert.match(resumePayload.message, /kept and loaded/i);
  assert.equal(resumePayload.run.cases[0].localNotes, "keep until confirmed");

  const replaceResponse = await fetch(`${baseUrl}/api/import-csv`, {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      "x-file-name": encodeURIComponent("restore.csv"),
      "x-import-existing-action": "replace"
    },
    body: csv
  });
  const replacePayload = await replaceResponse.json();
  assert.equal(replaceResponse.status, 200);
  assert.equal(replacePayload.existingProgressReplaced, true);
  assert.equal(replacePayload.run.cases[0].localNotes, "fresh csv progress");
});

async function startTestServer(progressDir) {
  const server = createServer({
    host: "127.0.0.1",
    port: 4173,
    progressDir
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`
  };
}

function createWorkbook(rows) {
  return createZip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Worksheet" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`],
    ["xl/worksheets/sheet1.xml", sheetXml(rows)]
  ]);
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

function dosDateTime() {
  const year = 2026 - 1980;
  const month = 5;
  const day = 12;
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
