export const statuses = [
  "Passed",
  "Untested",
  "Failed",
  "In test",
  "Retest",
  "Blocked",
  "Conditionally Passed",
  "Skipped"
];

export const panelDefaults = {
  tree: 320,
  list: 760,
  detail: 640
};

export const panelMinimums = {
  tree: 220,
  list: 500,
  detail: 420
};

export const caseListColumnDefaults = {
  id: 86,
  title: 520,
  status: 150
};

export const caseListColumnMinimums = {
  id: 70,
  title: 220,
  status: 120
};

const statusColors = {
  Passed: { className: "status-passed", color: "#16803c", label: "Passed" },
  Untested: { className: "status-untested", color: "#7b8794", label: "Untested" },
  Failed: { className: "status-failed", color: "#c7362f", label: "Failed" },
  "In test": { className: "status-in-test", color: "#1f70c1", label: "In test" },
  Retest: { className: "status-retest", color: "#c58a00", label: "Retest" },
  Blocked: { className: "status-blocked", color: "#111827", label: "Blocked" },
  "Conditionally Passed": {
    className: "status-conditionally-passed",
    color: "#0f8f79",
    label: "Conditionally Passed"
  },
  Skipped: { className: "status-skipped", color: "#8a5a15", label: "Skipped" }
};

export function getStatusColor(status) {
  return statusColors[status] || { className: "status-unknown", color: "#667085", label: status || "Unknown" };
}

export function calculateRunStats(cases) {
  const counts = emptyStatusCounts();
  for (const testCase of cases) {
    const status = testCase.currentStatus || "Untested";
    counts[status] = (counts[status] || 0) + 1;
  }

  const total = cases.length;
  const completed = Math.max(0, total - (counts.Untested || 0));
  return {
    total,
    completed,
    completedPercent: total ? Math.round((completed / total) * 100) : 0,
    passedPercent: total ? Math.round(((counts.Passed || 0) / total) * 100) : 0,
    counts
  };
}

export function sanitizePanelWidths(widths = {}) {
  return {
    tree: clampPanelWidth(widths.tree, "tree"),
    list: clampPanelWidth(widths.list, "list"),
    detail: clampPanelWidth(widths.detail, "detail")
  };
}

export function resizePanelWidths(widths, handle, deltaX) {
  const next = sanitizePanelWidths(widths);
  if (handle === "tree-list") {
    const boundedDelta = Math.max(
      panelMinimums.tree - next.tree,
      Math.min(deltaX, next.list - panelMinimums.list)
    );
    next.tree += boundedDelta;
    next.list -= boundedDelta;
  }
  if (handle === "list-detail") {
    const boundedDelta = Math.max(
      panelMinimums.list - next.list,
      Math.min(deltaX, next.detail - panelMinimums.detail)
    );
    next.list += boundedDelta;
    next.detail -= boundedDelta;
  }
  return sanitizePanelWidths(next);
}

export function sanitizeCaseListColumns(widths = {}) {
  return {
    id: clampCaseListColumn(widths.id, "id"),
    title: clampCaseListColumn(widths.title, "title"),
    status: clampCaseListColumn(widths.status, "status")
  };
}

export function resizeCaseListColumns(widths, column, deltaX) {
  const next = sanitizeCaseListColumns(widths);
  if (!Object.hasOwn(caseListColumnMinimums, column)) {
    return next;
  }
  next[column] = clampCaseListColumn(next[column] + deltaX, column);
  return sanitizeCaseListColumns(next);
}

export function applyStatusToCase(cases, localId, status, updatedAt = new Date().toISOString()) {
  return applyStatusToCases(cases, [localId], status, updatedAt);
}

export function applyStatusToCases(cases, localIds, status, updatedAt = new Date().toISOString()) {
  const selectedIds = new Set(localIds);
  let changed = 0;
  for (const testCase of cases) {
    if (!selectedIds.has(testCase.localId)) {
      continue;
    }
    testCase.currentStatus = status;
    testCase.updatedAt = updatedAt;
    changed += 1;
  }
  return { changed };
}

export function getNextCaseId(currentCaseId, visibleCaseIds) {
  if (visibleCaseIds.length === 0) {
    return null;
  }
  const index = visibleCaseIds.indexOf(currentCaseId);
  if (index < 0) {
    return visibleCaseIds[0];
  }
  return visibleCaseIds[index + 1] || null;
}

export function groupCasesBySection(cases) {
  const groups = [];
  const groupMap = new Map();
  for (const testCase of cases) {
    const label = caseSectionLabel(testCase);
    let group = groupMap.get(label);
    if (!group) {
      group = { id: slugify(label), label, cases: [] };
      groupMap.set(label, group);
      groups.push(group);
    }
    group.cases.push(testCase);
  }
  return groups;
}

export function getVisibleCaseOrder(groupedCases) {
  return groupedCases.flatMap((group) => group.cases.map((testCase) => testCase.localId));
}

export function appendNoteToCases(cases, localIds, note, updatedAt = new Date().toISOString()) {
  const selectedIds = new Set(localIds);
  const trimmedNote = String(note || "").trim();
  if (!trimmedNote) {
    return { changed: 0 };
  }
  const noteBlock = `[${updatedAt}]\n${trimmedNote}`;
  let changed = 0;
  for (const testCase of cases) {
    if (!selectedIds.has(testCase.localId)) {
      continue;
    }
    testCase.localNotes = testCase.localNotes ? `${testCase.localNotes}\n\n${noteBlock}` : noteBlock;
    testCase.updatedAt = updatedAt;
    changed += 1;
  }
  return { changed };
}

export function buildTreeFromCases(cases) {
  const root = createFolderNode("root", "All Tests");
  const folderMap = new Map([["root", root]]);

  for (const testCase of cases) {
    const path = sectionPath(testCase);
    let parent = root;
    let folderKey = "root";

    for (const segment of path) {
      folderKey = `${folderKey}/${segment}`;
      let folder = folderMap.get(folderKey);
      if (!folder) {
        folder = createFolderNode(folderKey, segment);
        folderMap.set(folderKey, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }

    parent.children.push({
      id: `test-${testCase.localId}`,
      name: testCase.title || testCase.testId || testCase.caseId || "Untitled test",
      type: "test",
      children: [],
      localId: testCase.localId,
      testId: testCase.testId,
      caseId: testCase.caseId,
      status: testCase.currentStatus || "Untested"
    });
  }

  updateFolderCounts(root);
  return root;
}

export function parseSteps(rawRow) {
  const stepText = htmlToReadableText(rawRow["Steps (Step)"]);
  const expectedText = htmlToReadableText(rawRow["Steps (Expected Result)"]);
  const statusText = htmlToReadableText(rawRow["Steps (Status)"]);
  const additionalText = htmlToReadableText(rawRow["Steps (Additional Info)"]);
  const referencesText = htmlToReadableText(rawRow["Steps (References)"]);

  if (stepText || expectedText || statusText) {
    return alignStepRows(
      splitNumberedItems(stepText),
      splitNumberedItems(expectedText),
      splitStatusItems(statusText),
      splitNumberedItems(additionalText),
      splitNumberedItems(referencesText)
    );
  }

  const richSteps = htmlToReadableText(findRichStepsValue(rawRow));
  if (!richSteps) {
    return [];
  }

  const expectedMatch = richSteps.match(/Expected Result:\s*([\s\S]*)/i);
  const step = expectedMatch ? richSteps.slice(0, expectedMatch.index).trim() : richSteps;
  return [{
    step,
    expectedResult: expectedMatch ? expectedMatch[1].trim() : "",
    status: "",
    additionalInfo: "",
    references: ""
  }];
}

export function htmlToReadableText(value) {
  if (value == null) {
    return "";
  }
  const text = String(value);
  if (!text.includes("<") && !text.includes("&")) {
    return text.trim();
  }

  return decodeXmlEntities(text)
    .replaceAll(/\r\n/g, "\n")
    .replaceAll(/<\s*br\s*\/?\s*>/gi, "\n")
    .replaceAll(/<\s*\/p\s*>/gi, "\n")
    .replaceAll(/<\s*p(?:\s[^>]*)?>/gi, "")
    .replaceAll(/<\s*li(?:\s[^>]*)?>/gi, "- ")
    .replaceAll(/<\s*\/li\s*>/gi, "\n")
    .replaceAll(/<\s*\/?(?:ul|ol)(?:\s[^>]*)?>/gi, "\n")
    .replaceAll(/<\s*\/?(?:pre|code)(?:\s[^>]*)?>/gi, "")
    .replaceAll(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function alignStepRows(steps, expectedResults, stepStatuses, additionalInfo, references) {
  const rowCount = Math.max(
    steps.length,
    expectedResults.length,
    stepStatuses.length,
    additionalInfo.length,
    references.length
  );
  return Array.from({ length: rowCount }, (_, index) => ({
    step: steps[index] || "",
    expectedResult: expectedResults[index] || "",
    status: stepStatuses[index] || "",
    additionalInfo: additionalInfo[index] || "",
    references: references[index] || ""
  })).filter((row) => row.step || row.expectedResult || row.status || row.additionalInfo || row.references);
}

function splitNumberedItems(value) {
  const text = htmlToReadableText(value);
  if (!text) {
    return [];
  }

  const matches = [...text.matchAll(/(?:^|\n)\s*\d+[.)]\s+([\s\S]*?)(?=(?:\n\s*\d+[.)]\s+)|$)/g)];
  if (matches.length > 0) {
    return matches.map((match) => match[1].trim()).filter(Boolean);
  }

  return text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

function splitStatusItems(value) {
  const text = htmlToReadableText(value);
  if (!text) {
    return [];
  }

  const numbered = splitNumberedItems(text);
  if (numbered.length > 1 || numbered[0] !== text) {
    return numbered;
  }

  const statusPattern = statuses
    .slice()
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  return [...text.matchAll(new RegExp(statusPattern, "gi"))]
    .map((match) => normalizeStatus(match[0]))
    .filter(Boolean);
}

function normalizeStatus(value) {
  return statuses.find((status) => status.toLowerCase() === String(value).toLowerCase()) || "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findRichStepsValue(rawRow) {
  const values = Object.entries(rawRow)
    .filter(([key]) => key === "Steps" || /^Steps__\d+$/.test(key))
    .map(([, value]) => value)
    .filter((value) => htmlToReadableText(value));
  return values.find((value) => /Step Description|Expected Result/i.test(value)) || values.at(-1) || "";
}

function sectionPath(testCase) {
  const hierarchy = String(testCase.sectionHierarchy || "").trim();
  if (hierarchy) {
    return hierarchy.split(">").map((part) => part.trim()).filter(Boolean);
  }
  const section = String(testCase.section || "").trim();
  return [section || "Unsectioned"];
}

function caseSectionLabel(testCase) {
  const hierarchy = String(testCase.sectionHierarchy || "").trim();
  if (hierarchy) {
    const parts = hierarchy.split(">").map((part) => part.trim()).filter(Boolean);
    return parts.slice(1).join(" / ") || parts[0] || "Ungrouped";
  }
  return String(testCase.section || "").trim() || "Ungrouped";
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-z0-9_.-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createFolderNode(id, name) {
  return {
    id,
    name,
    type: "folder",
    children: [],
    counts: emptyStatusCounts(),
    aggregateStatus: "Untested"
  };
}

function updateFolderCounts(node) {
  node.counts = emptyStatusCounts();
  for (const child of node.children) {
    if (child.type === "folder") {
      updateFolderCounts(child);
      addCounts(node.counts, child.counts);
    } else {
      node.counts[child.status] = (node.counts[child.status] || 0) + 1;
    }
  }
  node.aggregateStatus = pickAggregateStatus(node.counts);
}

function pickAggregateStatus(counts) {
  if (counts.Failed) return "Failed";
  if (counts.Blocked) return "Blocked";
  if (counts["In test"]) return "In test";
  if (counts.Retest) return "Retest";
  if (counts.Untested) return "Untested";
  if (counts["Conditionally Passed"]) return "Conditionally Passed";
  if (counts.Passed) return "Passed";
  return "Untested";
}

function addCounts(target, source) {
  for (const [status, count] of Object.entries(source)) {
    target[status] = (target[status] || 0) + count;
  }
}

function emptyStatusCounts() {
  return Object.fromEntries(statuses.map((status) => [status, 0]));
}

function clampPanelWidth(value, panel) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return panelDefaults[panel];
  }
  return Math.max(panelMinimums[panel], Math.round(parsed));
}

function clampCaseListColumn(value, column) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return caseListColumnDefaults[column];
  }
  return Math.max(caseListColumnMinimums[column], Math.round(parsed));
}

function decodeXmlEntities(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
