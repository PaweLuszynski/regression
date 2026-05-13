import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectWorkbookFromBuffer, parseTestRailRunFromBuffer } from "./parser.js";
import { parseRunProgressCsv } from "./run-csv.js";
import { parseRunProgressJson } from "./run-json.js";
import {
  deleteSavedRunFromDir,
  isSafeRunId,
  listSavedRunsFromDir,
  normalizePathname,
  parseJsonText,
  readSavedRunFromDir,
  writeRunAtomically
} from "./server-runs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultPublicDir = path.join(rootDir, "public");
const defaultProgressDir = process.env.PROGRESS_DIR || path.join(rootDir, "data", "progress");
const defaultHost = "127.0.0.1";
const defaultPort = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export function createServer(options = {}) {
  const context = {
    publicDir: options.publicDir || defaultPublicDir,
    progressDir: options.progressDir || defaultProgressDir,
    host: options.host || defaultHost,
    port: Number(options.port || defaultPort)
  };

  return http.createServer(async (request, response) => {
    try {
      await route(request, response, context);
    } catch (error) {
      sendJson(response, 500, { error: error.message || "Unexpected server error." });
    }
  });
}

export function startServer(options = {}) {
  const server = createServer(options);
  const host = options.host || defaultHost;
  const port = Number(options.port || defaultPort);
  const progressDir = options.progressDir || defaultProgressDir;
  server.listen(port, host, () => {
    console.log(`TestRail local run viewer: http://${host}:${port}`);
    console.log(`Progress directory: ${progressDir}`);
  });
  return server;
}

async function route(request, response, context) {
  const { host, port, progressDir, publicDir } = context;
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  const pathname = normalizePathname(url.pathname);

  if (request.method === "GET" && pathname === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }

  if (request.method === "GET" && pathname === "/api/runs") {
    return sendJson(response, 200, { runs: await listSavedRunsFromDir(progressDir) });
  }

  if (request.method === "POST" && pathname === "/api/import") {
    const sourceFileName = decodeURIComponent(request.headers["x-file-name"] || "import.xlsx");
    const requestedSheetName = decodeImportHeader(request.headers["x-import-sheet-name"]);
    const existingAction = decodeImportHeader(request.headers["x-import-existing-action"]).toLowerCase();
    if (existingAction && !["resume", "replace"].includes(existingAction)) {
      return sendJson(response, 400, { error: "Invalid import action. Use resume or replace." });
    }

    const buffer = await readRequestBody(request);
    const workbookInfo = inspectWorkbookFromBuffer(buffer);
    if (!requestedSheetName && workbookInfo.usableSheets.length > 1) {
      return sendJson(response, 409, {
        worksheetSelectionRequired: true,
        reason: "select-worksheet",
        availableSheets: workbookInfo.usableSheets.map((sheet) => sheet.name),
        message: "Multiple usable worksheets were found. Choose one worksheet to import."
      });
    }

    let importedRun;
    try {
      importedRun = await parseTestRailRunFromBuffer(buffer, {
        sourceFileName,
        sheetName: requestedSheetName || workbookInfo.usableSheets[0]?.name
      });
    } catch (error) {
      if (error?.code === "WORKSHEET_SELECTION_REQUIRED") {
        return sendJson(response, 409, {
          worksheetSelectionRequired: true,
          reason: "select-worksheet",
          availableSheets: error.availableSheets || [],
          message: error.message || "Choose one worksheet to import."
        });
      }
      return sendJson(response, 400, { error: error.message || "Import failed." });
    }

    const existingRun = await readSavedRun(progressDir, importedRun.id);
    if (existingRun && !existingAction) {
      return sendJson(response, 409, {
        decisionRequired: true,
        existingProgressFound: true,
        reason: "existing-progress",
        importedRunSummary: summarizeRun(importedRun),
        message: "Saved local progress already exists for this run. Choose Resume to keep it or Replace to overwrite it with this import."
      });
    }

    if (existingRun && existingAction === "resume") {
      return sendJson(response, 200, {
        run: existingRun,
        existingProgressFound: true,
        message: "Existing local progress was kept and loaded."
      });
    }

    await saveRun(progressDir, importedRun);
    return sendJson(response, existingRun ? 200 : 201, {
      run: importedRun,
      existingProgressFound: false,
      existingProgressReplaced: Boolean(existingRun),
      message: existingRun
        ? "Imported run replaced the previous saved local progress."
        : "Imported run saved locally."
    });
  }

  if (request.method === "POST" && pathname === "/api/import-json") {
    let restoredRun;
    try {
      restoredRun = parseRunProgressJson((await readRequestBody(request)).toString("utf8"));
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Invalid JSON progress file." });
    }

    await saveRun(progressDir, restoredRun);
    return sendJson(response, 201, {
      run: restoredRun,
      message: "JSON progress restored and saved locally."
    });
  }

  if (request.method === "POST" && pathname === "/api/import-csv") {
    let restoredRun;
    try {
      restoredRun = parseRunProgressCsv((await readRequestBody(request)).toString("utf8"), {
        sourceFileName: decodeURIComponent(request.headers["x-file-name"] || "restored.csv")
      });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Invalid CSV progress file." });
    }

    await saveRun(progressDir, restoredRun);
    return sendJson(response, 201, {
      run: restoredRun,
      message: "CSV progress restored and saved locally."
    });
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && request.method === "GET") {
    const run = await readSavedRun(progressDir, runMatch[1]);
    if (!run) {
      return sendJson(response, 404, { error: "Saved run was not found." });
    }
    return sendJson(response, 200, { run });
  }

  if (runMatch && request.method === "PUT") {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return sendJson(response, 400, { error: "Invalid JSON body." });
      }
      throw error;
    }
    const run = body.run;
    if (!run || run.id !== runMatch[1] || !Array.isArray(run.cases)) {
      return sendJson(response, 400, { error: "Invalid run payload." });
    }
    await saveRun(progressDir, run);
    return sendJson(response, 200, { run, message: "Progress saved." });
  }

  if (runMatch && request.method === "DELETE") {
    const runId = runMatch[1];
    if (!isSafeRunId(runId)) {
      return sendJson(response, 400, { error: "Invalid saved run ID." });
    }
    const result = await deleteSavedRunFromDir(progressDir, runId);
    if (!result.deleted) {
      return sendJson(response, 404, { error: "Saved run was not found." });
    }
    return sendJson(response, 200, { message: "Saved run deleted." });
  }

  const exportMatch = pathname.match(/^\/api\/runs\/([^/]+)\/export$/);
  if (exportMatch && request.method === "GET") {
    const run = await readSavedRun(progressDir, exportMatch[1]);
    if (!run) {
      return sendJson(response, 404, { error: "Saved run was not found." });
    }
    const payload = JSON.stringify(run, null, 2);
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${run.id}.json"`,
      "content-length": Buffer.byteLength(payload)
    });
    return response.end(payload);
  }

  if (request.method === "GET") {
    return serveStatic(pathname, response, publicDir);
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

async function serveStatic(pathname, response, publicDir) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.resolve(publicDir, `.${requestedPath}`);
  if (!resolvedPath.startsWith(publicDir)) {
    return sendJson(response, 403, { error: "Forbidden." });
  }

  try {
    const content = await fs.readFile(resolvedPath);
    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(resolvedPath)] || "application/octet-stream",
      "content-length": content.length
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return sendJson(response, 404, { error: "Not found." });
    }
    throw error;
  }
}

async function readSavedRun(progressDir, id) {
  return readSavedRunFromDir(progressDir, id);
}

async function saveRun(progressDir, run) {
  const cleanRun = {
    ...run,
    savedAt: new Date().toISOString()
  };
  await writeRunAtomically(progressDir, run.id, cleanRun);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const body = await readRequestBody(request);
  return parseJsonText(body.toString("utf8"));
}

function summarizeRun(run) {
  return {
    id: run.id,
    runName: run.runName,
    runId: run.runId,
    sheetName: run.sheetName,
    caseCount: Array.isArray(run.cases) ? run.cases.length : 0
  };
}

function decodeImportHeader(value) {
  return decodeURIComponent(String(value || "")).trim();
}

function sendJson(response, statusCode, payload) {
  const text = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "x-content-type-options": "nosniff"
  });
  response.end(text);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  startServer();
}
