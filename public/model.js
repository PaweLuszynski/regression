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

export const keyboardResizeStep = 24;
export const keyboardResizeStepLarge = 72;

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

const preferredStatusOrder = [
  "Failed",
  "Blocked",
  "In test",
  "Retest",
  "Untested",
  "Conditionally Passed",
  "Passed",
  "Skipped"
];

export function getStatusColor(status) {
  return statusColors[status] || { className: "status-unknown", color: "#667085", label: status || "Unknown" };
}

export function normalizeStatusValue(value, availableStatuses = statuses) {
  const text = cleanStatusText(value);
  if (!text) {
    return "";
  }
  const normalized = normalizeStatus(text, availableStatuses);
  if (normalized) {
    return normalized;
  }
  return isUsableStatusCandidate(text, availableStatuses) ? text : "";
}

export function normalizeStatusList(values, fallbackStatuses = statuses) {
  const deduped = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = normalizeStatusValue(value, [...deduped, ...fallbackStatuses]);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  if (deduped.length > 0) {
    return deduped;
  }
  return [...fallbackStatuses];
}

export function normalizeStepRows(stepRows, availableStatuses = statuses) {
  return (Array.isArray(stepRows) ? stepRows : []).map((row) => {
    const importedStatus = normalizeStatusValue(row?.status, availableStatuses);
    const localCurrentStatusRaw = row?.localCurrentStatus;
    const localCurrentStatus = normalizeStatusValue(localCurrentStatusRaw, availableStatuses);
    const hasLocalOverride = localCurrentStatusRaw != null && String(localCurrentStatusRaw) !== "";
    const currentStatus = normalizeStatusValue(
      row?.currentStatus ?? (hasLocalOverride ? localCurrentStatus : importedStatus),
      availableStatuses
    );
    return {
      step: String(row?.step || ""),
      expectedResult: String(row?.expectedResult || ""),
      status: importedStatus,
      localCurrentStatus,
      currentStatus,
      additionalInfo: String(row?.additionalInfo || ""),
      references: String(row?.references || "")
    };
  }).filter((row) => row.step || row.expectedResult || row.status || row.currentStatus || row.localCurrentStatus || row.additionalInfo || row.references);
}

export function getEffectiveStepStatus(row) {
  return String(row?.currentStatus || row?.localCurrentStatus || row?.status || "");
}

export function collectCaseStatuses(cases) {
  const collected = [];
  for (const testCase of Array.isArray(cases) ? cases : []) {
    collected.push(testCase?.originalStatus, testCase?.currentStatus, testCase?.rawRow?.Status);
    for (const row of Array.isArray(testCase?.steps) ? testCase.steps : []) {
      collected.push(row?.status, row?.currentStatus);
    }
  }
  return normalizeStatusList(collected, []);
}

export function getRunStatuses(run) {
  const explicit = normalizeStatusList(run?.availableStatuses, []);
  if (explicit.length > 0) {
    return explicit;
  }
  const derived = collectCaseStatuses(run?.cases);
  return derived.length > 0 ? derived : [...statuses];
}

export function normalizeRun(run) {
  if (!run || typeof run !== "object") {
    return run;
  }
  const initialStatuses = normalizeStatusList([
    ...(Array.isArray(run.availableStatuses) ? run.availableStatuses : []),
    ...collectCaseStatuses(run.cases)
  ]);
  const initialCases = (Array.isArray(run.cases) ? run.cases : []).map((testCase) => normalizeRunCase(testCase, initialStatuses));
  const availableStatuses = normalizeStatusList([
    ...initialStatuses,
    ...collectCaseStatuses(initialCases)
  ]);
  const cases = initialCases.map((testCase) => normalizeRunCase(testCase, availableStatuses));
  return {
    ...run,
    availableStatuses,
    cases
  };
}

export function calculateRunStats(cases, availableStatuses = collectCaseStatuses(cases)) {
  const counts = emptyStatusCounts(availableStatuses);
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

export function latestRunTimestamp(run) {
  if (!run || typeof run !== "object") {
    return null;
  }
  const values = [];
  values.push(parseTimestamp(run.savedAt));
  values.push(parseTimestamp(run.importedAt));
  if (Array.isArray(run.cases)) {
    for (const testCase of run.cases) {
      values.push(parseTimestamp(testCase?.updatedAt));
    }
  }
  const valid = values.filter((value) => value !== null);
  return valid.length ? Math.max(...valid) : null;
}

export function getRunSafetyTimestamps(run, exportHistory = {}) {
  const runId = run?.id;
  const savedAt = run?.savedAt || latestKnownIsoTimestamp(run);
  const exportRecord = runId && exportHistory && typeof exportHistory === "object"
    ? exportHistory[runId]
    : null;
  return {
    savedAt,
    exportedAt: typeof exportRecord === "string" ? exportRecord : stringValue(exportRecord?.exportedAt),
    exportType: typeof exportRecord === "object" && exportRecord ? stringValue(exportRecord.type) : ""
  };
}

export function sortSavedRuns(runs, sortKey = "newest") {
  const items = Array.isArray(runs) ? [...runs] : [];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  items.sort((left, right) => {
    if (sortKey === "oldest") {
      return compareRunTimestamp(left, right) || compareRunText(left.runName || left.id, right.runName || right.id, collator);
    }
    if (sortKey === "run-name") {
      return compareRunText(left.runName || left.id, right.runName || right.id, collator)
        || compareRunText(left.runId || left.id, right.runId || right.id, collator);
    }
    if (sortKey === "run-id") {
      return compareRunText(left.runId || left.id, right.runId || right.id, collator)
        || compareRunText(left.runName || left.id, right.runName || right.id, collator);
    }
    return compareRunTimestamp(right, left) || compareRunText(left.runName || left.id, right.runName || right.id, collator);
  });

  return items;
}

function latestKnownIsoTimestamp(run) {
  const timestamp = latestRunTimestamp(run);
  return timestamp ? new Date(timestamp).toISOString() : "";
}

function stringValue(value) {
  return value == null ? "" : String(value);
}

export function getNextSavedRunIdAfterDeletion(runs, deletedRunId, activeRunId, sortKey = "newest") {
  if (!deletedRunId || activeRunId !== deletedRunId) {
    return activeRunId || null;
  }
  const remainingRuns = sortSavedRuns(
    (Array.isArray(runs) ? runs : []).filter((run) => run?.id !== deletedRunId),
    sortKey
  );
  return remainingRuns[0]?.id || null;
}

export function resolveUnsavedRunRecovery(serverRun, cachedEnvelope) {
  const cachedRun = cachedEnvelope?.run;
  if (!cachedRun || typeof cachedRun !== "object" || !Array.isArray(cachedRun.cases)) {
    return { action: "none", reason: "missing-cache" };
  }
  if (!serverRun || cachedRun.id !== serverRun.id) {
    return { action: "none", reason: "id-mismatch" };
  }

  const cacheTimestamp = parseTimestamp(cachedEnvelope.cachedAt) ?? latestRunTimestamp(cachedRun);
  const serverTimestamp = latestRunTimestamp(serverRun);

  if (cacheTimestamp !== null && serverTimestamp !== null) {
    if (cacheTimestamp > serverTimestamp) {
      return { action: "apply", reason: "cache-newer", run: cachedRun };
    }
    return { action: "discard", reason: "server-newer-or-equal" };
  }

  return {
    action: "pending",
    reason: "timestamp-unknown",
    run: cachedRun
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

export function getKeyboardResizeDelta(key, { shiftKey = false } = {}) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
    return 0;
  }
  const amount = shiftKey ? keyboardResizeStepLarge : keyboardResizeStep;
  return key === "ArrowLeft" || key === "ArrowUp" ? -amount : amount;
}

export function isCheckboxActivationKey(key, code = "") {
  return key === " " || key === "Space" || key === "Spacebar" || code === "Space";
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

export function applyStepStatusToCase(cases, localId, stepIndex, status, updatedAt = new Date().toISOString()) {
  const testCase = (Array.isArray(cases) ? cases : []).find((item) => item.localId === localId);
  if (!testCase || !Array.isArray(testCase.steps) || !testCase.steps[stepIndex]) {
    return { changed: 0 };
  }
  testCase.steps[stepIndex].currentStatus = status;
  testCase.steps[stepIndex].localCurrentStatus = status;
  testCase.updatedAt = updatedAt;
  return { changed: 1 };
}

export function getStepNavigationState(currentIndex, stepCount) {
  const count = Math.max(0, Number(stepCount) || 0);
  if (count === 0) {
    return {
      currentIndex: 0,
      label: "No steps",
      hasPrevious: false,
      hasNext: false
    };
  }
  const index = Math.max(0, Math.min(Number(currentIndex) || 0, count - 1));
  return {
    currentIndex: index,
    label: `Step ${index + 1} of ${count}`,
    hasPrevious: index > 0,
    hasNext: index < count - 1
  };
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

export function getAdjacentVisibleCaseId(currentCaseId, visibleCaseIds, direction = 1) {
  const ids = Array.isArray(visibleCaseIds) ? visibleCaseIds.filter(Boolean) : [];
  if (ids.length === 0) {
    return null;
  }
  const step = direction < 0 ? -1 : 1;
  const index = ids.indexOf(currentCaseId);
  if (index < 0) {
    return step < 0 ? ids[ids.length - 1] : ids[0];
  }
  const nextIndex = Math.max(0, Math.min(ids.length - 1, index + step));
  return ids[nextIndex] || null;
}

export function getVisibleNavigationState(currentCaseId, visibleCaseIds) {
  const ids = Array.isArray(visibleCaseIds) ? visibleCaseIds.filter(Boolean) : [];
  if (ids.length === 0) {
    return {
      previousId: null,
      nextId: null,
      hasPrevious: false,
      hasNext: false
    };
  }
  const index = ids.indexOf(currentCaseId);
  const resolvedIndex = index < 0 ? -1 : index;
  const previousId = resolvedIndex > 0 ? ids[resolvedIndex - 1] : null;
  const nextId = resolvedIndex < 0 ? ids[0] : ids[resolvedIndex + 1] || null;
  return {
    previousId,
    nextId,
    hasPrevious: Boolean(previousId),
    hasNext: Boolean(nextId)
  };
}

export function isCaseVisibleByLocalId(cases, localId) {
  return Array.isArray(cases) && cases.some((testCase) => testCase?.localId === localId);
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

export function buildTreeFromCases(cases, availableStatuses = collectCaseStatuses(cases)) {
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

  updateFolderCounts(root, availableStatuses);
  return root;
}

export function parseSteps(rawRow, options = {}) {
  const availableStatuses = normalizeStatusList(options.availableStatuses || options.statuses || statuses);
  const stepText = htmlToReadableText(rawRow["Steps (Step)"]);
  const expectedText = htmlToReadableText(rawRow["Steps (Expected Result)"]);
  const statusText = htmlToReadableText(rawRow["Steps (Status)"]);
  const additionalText = htmlToReadableText(rawRow["Steps (Additional Info)"]);
  const referencesText = htmlToReadableText(rawRow["Steps (References)"]);

  if (stepText || expectedText || statusText) {
    return alignStepRows(
      splitNumberedItems(stepText),
      splitNumberedItems(expectedText),
      splitStatusItems(statusText, availableStatuses),
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

function splitStatusItems(value, availableStatuses = statuses) {
  const text = htmlToReadableText(value);
  if (!text) {
    return [];
  }

  const numbered = splitNumberedItems(text);
  if (numbered.length > 1 || numbered[0] !== text) {
    return numbered
      .map((item) => normalizeStatusValue(item, availableStatuses))
      .filter(Boolean);
  }

  const statusPattern = availableStatuses
    .slice()
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  if (!statusPattern) {
    return text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  }
  const matches = [...text.matchAll(new RegExp(statusPattern, "gi"))]
    .map((match) => normalizeStatus(match[0], availableStatuses))
    .filter(Boolean);
  if (matches.length > 0) {
    if (matches.length > 2 && new Set(matches.map((status) => status.toLowerCase())).size === 1) {
      return [];
    }
    return matches;
  }
  return text.split(/\n+/)
    .map((part) => normalizeStatusValue(part, availableStatuses))
    .filter(Boolean);
}

function normalizeStatus(value, availableStatuses = statuses) {
  const cleanValue = cleanStatusText(value);
  return availableStatuses.find((status) => status.toLowerCase() === cleanValue.toLowerCase()) || "";
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

function parseTimestamp(value) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareRunTimestamp(left, right) {
  return savedRunTimestamp(left) - savedRunTimestamp(right);
}

function savedRunTimestamp(run) {
  return latestRunTimestamp(run) ?? 0;
}

function compareRunText(left, right, collator) {
  return collator.compare(String(left || ""), String(right || ""));
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

function updateFolderCounts(node, availableStatuses) {
  node.counts = emptyStatusCounts(availableStatuses);
  for (const child of node.children) {
    if (child.type === "folder") {
      updateFolderCounts(child, availableStatuses);
      addCounts(node.counts, child.counts);
    } else {
      node.counts[child.status] = (node.counts[child.status] || 0) + 1;
    }
  }
  node.aggregateStatus = pickAggregateStatus(node.counts, availableStatuses);
}

function pickAggregateStatus(counts, availableStatuses = statuses) {
  const preferred = normalizeStatusList([
    ...preferredStatusOrder,
    ...(Array.isArray(availableStatuses) ? availableStatuses : [])
  ], []);
  for (const status of preferred) {
    if (counts[status]) {
      return status;
    }
  }
  return preferred[0] || "Untested";
}

function addCounts(target, source) {
  for (const [status, count] of Object.entries(source)) {
    target[status] = (target[status] || 0) + count;
  }
}

function emptyStatusCounts(availableStatuses = statuses) {
  return Object.fromEntries(normalizeStatusList(availableStatuses).map((status) => [status, 0]));
}

function normalizeRunCase(testCase, availableStatuses) {
  const originalStatus = normalizeStatusValue(testCase?.originalStatus ?? testCase?.rawRow?.Status, availableStatuses);
  const currentStatus = normalizeStatusValue(testCase?.currentStatus || originalStatus || "Untested", availableStatuses) || "Untested";
  const parsedSteps = Array.isArray(testCase?.steps) && testCase.steps.length > 0
    ? testCase.steps
    : parseSteps(testCase?.rawRow || {}, { availableStatuses });
  return {
    ...testCase,
    originalStatus,
    currentStatus,
    steps: normalizeStepRows(parsedSteps, availableStatuses)
  };
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

function cleanStatusText(value) {
  return htmlToReadableText(value).replaceAll(/\s+/g, " ").trim();
}

function isUsableStatusCandidate(value, availableStatuses = statuses) {
  const text = cleanStatusText(value);
  if (!text) {
    return false;
  }
  if (text.length > 48) {
    return false;
  }
  if (/[<>:]/.test(text)) {
    return false;
  }
  if (/step description|expected result|additional info|references?/i.test(text)) {
    return false;
  }
  if (text.split(" ").length > 6) {
    return false;
  }

  const lower = text.toLowerCase();
  const repeatedWords = lower.split(" ");
  if (repeatedWords.length > 1 && new Set(repeatedWords).size === 1) {
    return false;
  }

  const normalizedStatuses = normalizeStatusList(availableStatuses, []);
  for (const status of normalizedStatuses) {
    const normalizedStatus = cleanStatusText(status);
    if (!normalizedStatus) {
      continue;
    }
    const pattern = new RegExp(`^(?:${escapeRegExp(normalizedStatus)}\\s+){1,}${escapeRegExp(normalizedStatus)}$`, "i");
    if (pattern.test(text)) {
      return false;
    }
  }

  return true;
}
