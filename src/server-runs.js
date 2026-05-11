import fs from "node:fs/promises";
import path from "node:path";

export async function listSavedRunsFromDir(progressDir, logger = console) {
  await fs.mkdir(progressDir, { recursive: true });
  const files = await fs.readdir(progressDir);
  const runs = [];

  for (const fileName of files.filter((file) => file.endsWith(".json"))) {
    const filePath = path.join(progressDir, fileName);
    let run;
    try {
      run = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.warn(`Skipping corrupted progress file: ${fileName}`);
        continue;
      }
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    runs.push({
      id: run.id,
      runName: run.runName,
      runId: run.runId,
      sourceFileName: run.sourceFileName,
      sheetName: run.sheetName,
      importedAt: run.importedAt,
      savedAt: run.savedAt,
      cases: Array.isArray(run.cases) ? run.cases.length : 0,
      updatedAt: latestCaseUpdate(run)
    });
  }

  return runs.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function readSavedRunFromDir(progressDir, id, logger = console) {
  const filePath = progressPath(progressDir, id);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      logger.warn(`Skipping corrupted saved run: ${path.basename(filePath)}`);
      return null;
    }
    throw error;
  }
}

export async function writeRunAtomically(progressDir, id, run) {
  await fs.mkdir(progressDir, { recursive: true });
  const targetPath = progressPath(progressDir, id);
  const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const payload = `${JSON.stringify(run, null, 2)}\n`;

  try {
    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
}

export async function deleteSavedRunFromDir(progressDir, id) {
  const targetPath = progressPath(progressDir, id);
  try {
    await fs.unlink(targetPath);
    return { deleted: true };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { deleted: false };
    }
    throw error;
  }
}

export function progressPath(progressDir, id) {
  const safeId = String(id || "run").replaceAll(/[^\w.-]+/g, "_");
  return path.join(progressDir, `${safeId}.json`);
}

export function isSafeRunId(id) {
  return /^[A-Za-z0-9_.-]+$/.test(String(id || ""));
}

export function normalizePathname(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }
  return pathname.replace(/\/+$/, "");
}

export function parseJsonText(value) {
  return JSON.parse(String(value || "{}"));
}

export function latestCaseUpdate(run) {
  return (Array.isArray(run.cases) ? run.cases : [])
    .map((testCase) => testCase.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || run.importedAt;
}
