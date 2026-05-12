import path from "node:path";
import zlib from "node:zlib";

import { htmlToReadableText, parseSteps } from "../public/model.js";

const XML_CONTENT_TYPES = new Set([0, 8]);

export const PRIMARY_STATUSES = [
  "Untested",
  "Passed",
  "In test",
  "Conditionally Passed",
  "Failed"
];

export const LOCAL_STATUSES = [
  ...PRIMARY_STATUSES,
  "Blocked",
  "Retest",
  "Skipped"
];

export function inspectWorkbookFromBuffer(buffer) {
  return inspectWorkbookFromBufferFromWorkbook(loadWorkbook(buffer));
}

export async function parseTestRailRunFromBuffer(buffer, options = {}) {
  const sourceFileName = options.sourceFileName || "import.xlsx";
  const workbook = loadWorkbook(buffer);
  const selectedSheet = chooseImportSheet(workbook, options.sheetName);
  const rows = readWorksheetRowsForSheet(workbook, selectedSheet);
  if (rows.length === 0 || rows[0].every((value) => value.trim() === "")) {
    throw new Error("No headers were detected in the selected worksheet.");
  }
  if (rows.length < 2 || rows.slice(1).every((row) => row.every((value) => value.trim() === ""))) {
    throw new Error("No test rows were detected in the selected worksheet.");
  }

  const columns = normalizeHeaders(rows[0]);
  const cases = rows.slice(1)
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map((row, index) => mapCaseRow(row, columns, index));

  const runName = firstNonEmpty(cases.map((testCase) => testCase.rawRow.Run));
  const runId = firstNonEmpty(cases.map((testCase) => testCase.rawRow["Run ID"]));
  const importedAt = new Date().toISOString();
  const id = createRunStorageKey(runId, sourceFileName);

  return {
    id,
    sourceFileName,
    sheetName: selectedSheet.name,
    runName,
    runId,
    importedAt,
    columns,
    cases
  };
}

function loadWorkbook(buffer) {
  let files;
  try {
    files = readZipEntries(Buffer.from(buffer));
  } catch (error) {
    throw new Error(`Invalid XLSX file: ${error.message}`);
  }

  const workbookXml = getTextFile(files, "xl/workbook.xml");
  if (!workbookXml) {
    throw new Error("Invalid XLSX file: workbook.xml was not found.");
  }

  const workbookRels = parseRelationships(getTextFile(files, "xl/_rels/workbook.xml.rels") || "");
  const sheets = parseWorkbookSheets(workbookXml);
  if (sheets.length === 0) {
    throw new Error("Invalid XLSX file: no worksheets were found.");
  }

  return {
    files,
    workbookRels,
    sheets,
    sharedStrings: parseSharedStrings(getTextFile(files, "xl/sharedStrings.xml") || "")
  };
}

function chooseImportSheet(workbook, requestedSheetName) {
  if (requestedSheetName) {
    const exactMatch = workbook.sheets.find((sheet) => sheet.name === requestedSheetName);
    if (!exactMatch) {
      const names = workbook.sheets.map((sheet) => sheet.name).filter(Boolean).join(", ");
      throw new Error(`Selected worksheet '${requestedSheetName}' was not found. Available worksheets: ${names || "none"}.`);
    }
    return exactMatch;
  }

  const inspection = inspectWorkbookFromBufferFromWorkbook(workbook);
  if (inspection.usableSheets.length > 1) {
    const error = new Error("Multiple usable worksheets were found. Choose one worksheet to import.");
    error.code = "WORKSHEET_SELECTION_REQUIRED";
    error.availableSheets = inspection.usableSheets.map((sheet) => sheet.name);
    throw error;
  }
  if (inspection.usableSheets.length === 1) {
    return workbook.sheets.find((sheet) => sheet.name === inspection.usableSheets[0].name) || workbook.sheets[0];
  }
  return workbook.sheets.find((sheet) => sheet.name === "Worksheet") || workbook.sheets[0];
}

function inspectWorkbookFromBufferFromWorkbook(workbook) {
  const sheets = workbook.sheets.map((sheet) => {
    const rows = readWorksheetRowsForSheet(workbook, sheet);
    const hasHeaders = rows.length > 0 && rows[0].some((value) => value.trim() !== "");
    const hasData = rows.length >= 2 && rows.slice(1).some((row) => row.some((value) => value.trim() !== ""));
    return {
      name: sheet.name,
      sheetId: sheet.sheetId,
      hasHeaders,
      hasData,
      isUsable: hasHeaders && hasData
    };
  });

  return {
    sheets,
    usableSheets: sheets.filter((sheet) => sheet.isUsable)
  };
}

export function createRunStorageKey(runId, sourceFileName) {
  const baseName = path.basename(sourceFileName || "import", path.extname(sourceFileName || ""));
  return `${runId || "run"}_${baseName}`
    .replaceAll(/\s+/g, "_")
    .replaceAll(/[^\w.-]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapCaseRow(row, columns, index) {
  const rawRow = {};
  for (const column of columns) {
    rawRow[column.key] = row[column.index] || "";
  }

  const originalStatus = clean(rawRow.Status);
  const explicitStep = cleanDisplay(rawRow["Steps (Step)"]);
  const explicitExpected = cleanDisplay(rawRow["Steps (Expected Result)"]);
  const fallbackSteps = cleanDisplay(findRichStepsValue(rawRow, columns));
  const stepsStep = explicitStep || fallbackSteps;
  const stepsExpectedResult = explicitExpected;
  const now = new Date().toISOString();
  const testId = clean(rawRow.ID);

  return {
    localId: testId || `row-${index + 2}`,
    testId,
    caseId: clean(rawRow["Case ID"]),
    title: cleanDisplay(rawRow.Title),
    assignedTo: clean(rawRow["Assigned To"]),
    priority: clean(rawRow.Priority),
    section: cleanDisplay(rawRow.Section),
    sectionHierarchy: cleanDisplay(rawRow["Section Hierarchy"]),
    type: clean(rawRow.Type),
    template: clean(rawRow.Template),
    originalStatus,
    currentStatus: originalStatus || "Untested",
    importedComment: cleanDisplay(rawRow.Comment),
    localNotes: "",
    importedDefects: clean(rawRow.Defects),
    localDefects: "",
    references: clean(rawRow.References),
    localEvidence: "",
    preconditions: cleanDisplay(rawRow.Preconditions),
    expectedResult: cleanDisplay(rawRow["Expected Result"]),
    stepsCombined: explicitStep || explicitExpected
      ? [explicitStep, explicitExpected].filter(Boolean).join("\n\nExpected Result:\n")
      : fallbackSteps,
    stepsStep,
    stepsExpectedResult,
    stepsStatus: clean(rawRow["Steps (Status)"]),
    steps: parseSteps(rawRow),
    testedBy: clean(rawRow["Tested By"]),
    testedOn: clean(rawRow["Tested On"]),
    testCaseLabels: clean(rawRow["Test Case Labels"]),
    updatedAt: now,
    rawRow
  };
}

function findRichStepsValue(rawRow, columns) {
  const stepColumns = columns
    .filter((column) => column.name === "Steps")
    .map((column) => rawRow[column.key])
    .filter((value) => clean(value));
  return stepColumns.find((value) => /Step Description|Expected Result/i.test(value)) || stepColumns.at(-1) || "";
}

function normalizeHeaders(headerRow) {
  const seen = new Map();
  return headerRow.map((name, index) => {
    const trimmedName = clean(name) || `Column ${index + 1}`;
    const count = (seen.get(trimmedName) || 0) + 1;
    seen.set(trimmedName, count);
    return {
      index,
      name: trimmedName,
      key: count === 1 ? trimmedName : `${trimmedName}__${count}`
    };
  });
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error("end of central directory was not found.");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  let cursor = centralOffset;
  const files = new Map();

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("central directory is malformed.");
    }

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    if (!XML_CONTENT_TYPES.has(method)) {
      throw new Error(`unsupported ZIP compression method ${method} for ${fileName}.`);
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    if (content.length !== uncompressedSize) {
      throw new Error(`unexpected uncompressed size for ${fileName}.`);
    }
    files.set(normalizeZipPath(fileName), content);

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

function parseWorkbookSheets(xml) {
  return [...xml.matchAll(/<sheet\b([^>]*)\/?>/g)].map((match) => {
    const attrs = parseAttributes(match[1]);
    return {
      name: attrs.name || "",
      sheetId: attrs.sheetId || "",
      relationshipId: attrs["r:id"] || attrs.id || ""
    };
  });
}

function parseRelationships(xml) {
  const relationships = new Map();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = parseAttributes(match[1]);
    if (attrs.Id && attrs.Target) {
      relationships.set(attrs.Id, attrs.Target);
    }
  }
  return relationships;
}

function readWorksheetRowsForSheet(workbook, sheet) {
  const sheetTarget = workbook.workbookRels.get(sheet.relationshipId) || `worksheets/sheet${sheet.sheetId}.xml`;
  const sheetPath = normalizeZipPath(path.posix.join("xl", sheetTarget));
  const worksheetXml = getTextFile(workbook.files, sheetPath);
  if (!worksheetXml) {
    throw new Error(`Invalid XLSX file: worksheet '${sheet.name}' was not found.`);
  }
  return parseWorksheetRows(worksheetXml, workbook.sharedStrings);
}

function parseSharedStrings(xml) {
  if (!xml) {
    return [];
  }
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    return [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXmlEntities(textMatch[1]))
      .join("");
  });
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const values = [];
    let fallbackColumn = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttributes(cellMatch[1]);
      const columnIndex = attrs.r ? columnRefToIndex(attrs.r) : fallbackColumn;
      values[columnIndex] = parseCellValue(cellMatch[2], attrs.t, sharedStrings);
      fallbackColumn = columnIndex + 1;
    }
    rows.push(values.map((value) => value || ""));
  }
  return rows;
}

function parseCellValue(cellXml, type, sharedStrings) {
  if (type === "inlineStr") {
    const inlineText = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((match) => decodeXmlEntities(match[1]))
      .join("");
    return inlineText;
  }

  const valueMatch = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  if (!valueMatch) {
    return "";
  }

  const rawValue = decodeXmlEntities(valueMatch[1]);
  if (type === "s") {
    return sharedStrings[Number(rawValue)] || "";
  }
  return rawValue;
}

function parseAttributes(rawAttributes) {
  const attributes = {};
  for (const match of rawAttributes.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }
  return attributes;
}

function columnRefToIndex(cellRef) {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0] || "";
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

function getTextFile(files, filePath) {
  const content = files.get(normalizeZipPath(filePath));
  return content ? content.toString("utf8") : "";
}

function normalizeZipPath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\/+/, "");
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function cleanDisplay(value) {
  return htmlToReadableText(value);
}

function firstNonEmpty(values) {
  return values.map(clean).find(Boolean) || "";
}

function decodeXmlEntities(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
