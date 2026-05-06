import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { test } from "node:test";

import {
  listSavedRunsFromDir,
  normalizePathname,
  parseJsonText,
  progressPath,
  readSavedRunFromDir,
  writeRunAtomically
} from "../src/server-runs.js";

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

test("writeRunAtomically writes final run file without leaving temporary files", async () => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-progress-"));
  const run = {
    id: "R1",
    runName: "Atomic run",
    runId: "R1",
    sourceFileName: "run.xlsx",
    sheetName: "Worksheet",
    importedAt: "2026-05-06T12:00:00.000Z",
    cases: [{ localId: "T1", originalStatus: "Untested", currentStatus: "Passed" }]
  };

  await writeRunAtomically(progressDir, run.id, run);
  const restored = await readSavedRunFromDir(progressDir, run.id);
  const files = await readdir(progressDir);

  assert.equal(restored.id, "R1");
  assert.equal(restored.cases[0].currentStatus, "Passed");
  assert.deepEqual(
    files.filter((name) => name.endsWith(".tmp")),
    []
  );
  assert.ok(files.includes(path.basename(progressPath(progressDir, run.id))));
});

test("readSavedRunFromDir returns null and warns for corrupted saved run", async () => {
  const progressDir = await mkdtemp(path.join(os.tmpdir(), "regression-progress-"));
  const filePath = progressPath(progressDir, "R-broken");
  await writeFile(filePath, "{ broken json", "utf8");

  const warnings = [];
  const run = await readSavedRunFromDir(progressDir, "R-broken", {
    warn: (message) => warnings.push(message)
  });

  assert.equal(run, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Skipping corrupted saved run: R-broken\.json/);
});
