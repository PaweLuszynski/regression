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
      cases: Array.isArray(run.cases) ? run.cases.length : 0,
      updatedAt: latestCaseUpdate(run)
    });
  }

  return runs.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
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
