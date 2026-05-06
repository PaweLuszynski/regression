import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { test } from "node:test";

import { listSavedRunsFromDir, normalizePathname, parseJsonText } from "../src/server-runs.js";

test("listSavedRunsFromDir skips corrupted progress files and keeps valid runs", async () => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-progress-"));
  await writeFile(path.join(progressDir, "valid.json"), JSON.stringify({
    id: "valid",
    runName: "Valid run",
    runId: "R1",
    sourceFileName: "valid.xlsx",
    sheetName: "Worksheet",
    importedAt: "2026-05-06T12:00:00.000Z",
    cases: [{ localId: "T1", updatedAt: "2026-05-06T12:00:00.000Z" }]
  }));
  await writeFile(path.join(progressDir, "broken.json"), "{ not valid json ");

  const warnings = [];
  const runs = await listSavedRunsFromDir(progressDir, {
    warn: (message) => warnings.push(message)
  });

  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, "valid");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Skipping corrupted progress file: broken\.json/);
});

test("parseJsonText throws SyntaxError on malformed JSON body", () => {
  assert.throws(
    () => parseJsonText("{broken"),
    SyntaxError
  );
});

test("normalizePathname strips trailing slash for API paths", () => {
  assert.equal(normalizePathname("/api/import-json/"), "/api/import-json");
  assert.equal(normalizePathname("/"), "/");
});
