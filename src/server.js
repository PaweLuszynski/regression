import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseTestRailRunFromBuffer } from "./parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const progressDir = path.join(rootDir, "data", "progress");
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

  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }

  if (request.method === "GET" && url.pathname === "/api/runs") {
    return sendJson(response, 200, { runs: await listSavedRuns() });
  }

  if (request.method === "POST" && url.pathname === "/api/import") {
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

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && request.method === "GET") {
    const run = await readSavedRun(runMatch[1]);
    if (!run) {
      return sendJson(response, 404, { error: "Saved run was not found." });
    }
    return sendJson(response, 200, { run });
  }

  if (runMatch && request.method === "PUT") {
    const body = await readJsonBody(request);
    const run = body.run;
    if (!run || run.id !== runMatch[1] || !Array.isArray(run.cases)) {
      return sendJson(response, 400, { error: "Invalid run payload." });
    }
    await saveRun(run);
    return sendJson(response, 200, { run, message: "Progress saved." });
  }

  const exportMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/export$/);
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
    return serveStatic(url.pathname, response);
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

async function listSavedRuns() {
  await fs.mkdir(progressDir, { recursive: true });
  const files = await fs.readdir(progressDir);
  const runs = [];
  for (const fileName of files.filter((file) => file.endsWith(".json"))) {
    const run = await readSavedRun(path.basename(fileName, ".json"));
    if (run) {
      runs.push({
        id: run.id,
        runName: run.runName,
        runId: run.runId,
        sourceFileName: run.sourceFileName,
        sheetName: run.sheetName,
        importedAt: run.importedAt,
        cases: run.cases.length,
        updatedAt: latestCaseUpdate(run)
      });
    }
  }
  return runs.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function readSavedRun(id) {
  const filePath = progressPath(id);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function saveRun(run) {
  await fs.mkdir(progressDir, { recursive: true });
  const cleanRun = {
    ...run,
    savedAt: new Date().toISOString()
  };
  await fs.writeFile(progressPath(run.id), `${JSON.stringify(cleanRun, null, 2)}\n`, "utf8");
}

function progressPath(id) {
  const safeId = String(id || "run").replaceAll(/[^\w.-]+/g, "_");
  return path.join(progressDir, `${safeId}.json`);
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
  return JSON.parse(body.toString("utf8") || "{}");
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

function latestCaseUpdate(run) {
  return run.cases
    .map((testCase) => testCase.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || run.importedAt;
}
