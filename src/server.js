import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseTestRailRunFromBuffer } from "./parser.js";
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
const publicDir = path.join(rootDir, "public");
const progressDir = process.env.PROGRESS_DIR || path.join(rootDir, "data", "progress");
const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(port, host, () => {
  console.log(`TestRail local run viewer: http://${host}:${port}`);
  console.log(`Progress directory: ${progressDir}`);
});

async function route(request, response) {
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
    const buffer = await readRequestBody(request);
    const importedRun = await parseTestRailRunFromBuffer(buffer, { sourceFileName });
    const existingRun = await readSavedRun(importedRun.id);
    if (existingRun) {
      return sendJson(response, 200, {
        run: existingRun,
        existingProgressFound: true,
        message: "Existing local progress was found and loaded. The import did not overwrite it."
      });
    }

    await saveRun(importedRun);
    return sendJson(response, 201, {
      run: importedRun,
      existingProgressFound: false,
      message: "Imported run saved locally."
    });
  }

  if (request.method === "POST" && pathname === "/api/import-json") {
    let restoredRun;
    try {
      restoredRun = parseRunProgressJson((await readRequestBody(request)).toString("utf8"));
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Invalid JSON progress file." });
    }

    await saveRun(restoredRun);
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

    await saveRun(restoredRun);
    return sendJson(response, 201, {
      run: restoredRun,
      message: "CSV progress restored and saved locally."
    });
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && request.method === "GET") {
    const run = await readSavedRun(runMatch[1]);
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
    await saveRun(run);
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
    const run = await readSavedRun(exportMatch[1]);
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
    return serveStatic(pathname, response);
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

async function serveStatic(pathname, response) {
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

async function readSavedRun(id) {
  return readSavedRunFromDir(progressDir, id);
}

async function saveRun(run) {
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

function sendJson(response, statusCode, payload) {
  const text = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "x-content-type-options": "nosniff"
  });
  response.end(text);
}
