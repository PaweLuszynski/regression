import { classifyXlsxImportResponse } from "./import-flow.js";
import { buildCsvExport } from "./run-export.js";
import {
  appendNoteToCases,
  applyStepStatusToCase,
  applyStatusToCase,
  applyStatusToCases,
  buildTreeFromCases,
  caseListColumnDefaults,
  calculateRunStats,
  getNextCaseId,
  getNextSavedRunIdAfterDeletion,
  getStatusColor,
  getVisibleCaseOrder,
  getRunStatuses,
  groupCasesBySection,
  normalizeRun,
  panelDefaults,
  resizeCaseListColumns,
  resizePanelWidths,
  sanitizeCaseListColumns,
  sanitizePanelWidths,
  parseSteps,
  latestRunTimestamp,
  resolveUnsavedRunRecovery,
  sortSavedRuns,
  statuses
} from "./model.js";

const layoutStorageKey = "testrailLocalViewer.panelWidths.v1";
const caseListColumnsStorageKey = "testrailLocalViewer.caseListColumns.v1";
const savedRunsCollapsedStorageKey = "testrailLocalViewer.savedRunsCollapsed.v1";
const savedRunsSortStorageKey = "testrailLocalViewer.savedRunsSort.v1";
const unsavedRunPrefix = "testrailLocalViewer.unsavedRun.v1.";
const defaultRunMetaText = "Import a TestRail XLSX run export to continue locally.";
const importAcceptByType = {
  xlsx: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: ".json,application/json",
  csv: ".csv,text/csv"
};
const state = {
  run: null,
  selectedLocalId: null,
  selectedCaseIds: new Set(),
  expandedFolders: new Set(),
  panelWidths: loadPanelWidths(),
  caseListColumns: loadCaseListColumns(),
  activeResize: null,
  activeColumnResize: null,
  pendingImportType: "",
  pendingImportPrompt: null,
  pendingRecoveredRun: null,
  savedRuns: [],
  savedRunsCollapsed: loadSavedRunsCollapsed(),
  savedRunsSort: loadSavedRunsSort(),
  filters: {
    search: "",
    currentStatus: "",
    originalStatus: "",
    priority: "",
    section: "",
    assignedTo: ""
  }
};

const elements = {
  importFileInput: document.querySelector("#importFileInput"),
  importXlsxButton: document.querySelector("#importXlsxButton"),
  importJsonButton: document.querySelector("#importJsonButton"),
  importCsvButton: document.querySelector("#importCsvButton"),
  exportMenuSummary: document.querySelector("#exportMenuSummary"),
  menuControls: [...document.querySelectorAll(".menu-control")],
  runMeta: document.querySelector("#runMeta"),
  saveState: document.querySelector("#saveState"),
  saveStateActions: document.querySelector("#saveStateActions"),
  recoverUnsavedButton: document.querySelector("#recoverUnsavedButton"),
  discardUnsavedButton: document.querySelector("#discardUnsavedButton"),
  message: document.querySelector("#message"),
  importPrompt: document.querySelector("#importPrompt"),
  savedRunsSummary: document.querySelector("#savedRunsSummary"),
  savedRuns: document.querySelector("#savedRuns"),
  savedRunsPanel: document.querySelector("#savedRunsPanel"),
  savedRunsSortSelect: document.querySelector("#savedRunsSortSelect"),
  toggleSavedRunsButton: document.querySelector("#toggleSavedRunsButton"),
  refreshRunsButton: document.querySelector("#refreshRunsButton"),
  workspace: document.querySelector("#workspace"),
  summary: document.querySelector("#summary"),
  contentGrid: document.querySelector("#contentGrid"),
  treeRoot: document.querySelector("#treeRoot"),
  searchInput: document.querySelector("#searchInput"),
  currentStatusFilter: document.querySelector("#currentStatusFilter"),
  originalStatusFilter: document.querySelector("#originalStatusFilter"),
  priorityFilter: document.querySelector("#priorityFilter"),
  sectionFilter: document.querySelector("#sectionFilter"),
  assignedToFilter: document.querySelector("#assignedToFilter"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  bulkBar: document.querySelector("#bulkBar"),
  selectedCount: document.querySelector("#selectedCount"),
  bulkStatusSelect: document.querySelector("#bulkStatusSelect"),
  bulkApplyButton: document.querySelector("#bulkApplyButton"),
  bulkNoteInput: document.querySelector("#bulkNoteInput"),
  bulkAppendNoteButton: document.querySelector("#bulkAppendNoteButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  selectAllVisibleCheckbox: document.querySelector("#selectAllVisibleCheckbox"),
  tableWrap: document.querySelector(".table-wrap"),
  caseList: document.querySelector("#caseList"),
  detailPane: document.querySelector("#detailPane"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  resetLayoutButton: document.querySelector("#resetLayoutButton")
};

elements.importFileInput.addEventListener("change", importFromFile);
elements.importXlsxButton.addEventListener("click", () => startImport("xlsx"));
elements.importJsonButton.addEventListener("click", () => startImport("json"));
elements.importCsvButton.addEventListener("click", () => startImport("csv"));
elements.refreshRunsButton.addEventListener("click", loadSavedRuns);
elements.savedRunsSortSelect.addEventListener("change", updateSavedRunsSort);
elements.toggleSavedRunsButton.addEventListener("click", toggleSavedRunsCollapsed);
elements.clearFiltersButton.addEventListener("click", clearFilters);
elements.exportJsonButton.addEventListener("click", exportJson);
elements.exportCsvButton.addEventListener("click", exportCsv);
elements.resetLayoutButton.addEventListener("click", resetLayout);
elements.bulkApplyButton.addEventListener("click", applyBulkStatus);
elements.bulkAppendNoteButton.addEventListener("click", appendBulkNote);
elements.clearSelectionButton.addEventListener("click", clearSelection);
elements.selectAllVisibleCheckbox.addEventListener("change", toggleAllVisibleSelection);
elements.recoverUnsavedButton.addEventListener("click", recoverUnsavedChanges);
elements.discardUnsavedButton.addEventListener("click", discardUnsavedChanges);
window.addEventListener("mousemove", resizePanels);
window.addEventListener("mouseup", stopResizingPanels);
window.addEventListener("mousemove", resizeCaseListColumn);
window.addEventListener("mouseup", stopResizingCaseListColumn);

for (const handle of document.querySelectorAll("[data-resize-handle]")) {
  handle.addEventListener("mousedown", startResizingPanels);
}

for (const handle of document.querySelectorAll("[data-case-column]")) {
  handle.addEventListener("mousedown", startResizingCaseListColumn);
}

applyPanelWidths();
applyCaseListColumns();
fillSelect(elements.bulkStatusSelect, "Choose status", statuses);
elements.savedRunsSortSelect.value = state.savedRunsSort;
applySavedRunsSectionState();
renderImportPrompt();

for (const [key, element] of [
  ["search", elements.searchInput],
  ["currentStatus", elements.currentStatusFilter],
  ["originalStatus", elements.originalStatusFilter],
  ["priority", elements.priorityFilter],
  ["section", elements.sectionFilter],
  ["assignedTo", elements.assignedToFilter]
]) {
  element.addEventListener("input", () => {
    state.filters[key] = element.value;
    render();
  });
}

loadSavedRuns();

function availableStatuses() {
  return state.run ? getRunStatuses(state.run) : statuses;
}

function statusActionsForRun() {
  const labels = new Map([
    ["Passed", "Pass"],
    ["Failed", "Fail"],
    ["Blocked", "Block"],
    ["Retest", "Retest"],
    ["In test", "In Test"],
    ["Untested", "Untested"],
    ["Conditionally Passed", "Conditionally Pass"]
  ]);
  return availableStatuses().map((status) => [labels.get(status) || status, status]);
}

function startImport(type) {
  clearImportPrompt();
  state.pendingImportType = type;
  elements.importFileInput.accept = importAcceptByType[type] || "";
  elements.importFileInput.click();
  closeMenus();
}

async function importFromFile(event) {
  const file = elements.importFileInput.files?.[0];
  if (!file) {
    return;
  }
  const type = state.pendingImportType;
  state.pendingImportType = "";

  try {
    if (type === "xlsx") {
      await importXlsxRun(file);
      return;
    }
    if (type === "json") {
      await importJsonRun(file);
      return;
    }
    if (type === "csv") {
      await importCsvRun(file);
      return;
    }
    showMessage("Choose an import type first.", "warning");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    elements.importFileInput.value = "";
    elements.importFileInput.accept = "";
  }
}

async function importXlsxRun(file, options = {}) {
  showMessage("Importing selected XLSX...", "info");
  const response = await fetch("/api/import", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
      ...(options.sheetName ? { "x-import-sheet-name": encodeURIComponent(options.sheetName) } : {}),
      ...(options.existingAction ? { "x-import-existing-action": encodeURIComponent(options.existingAction) } : {})
    },
    body: await file.arrayBuffer()
  });
  const payload = await response.json();
  const importResult = classifyXlsxImportResponse(response.status, payload, options);
  if (importResult.kind === "prompt") {
    setImportPrompt({
      ...importResult.prompt,
      file,
      options
    });
    showMessage(importResult.prompt.message || "Choose how to continue with this import.", "warning");
    return;
  }
  if (importResult.kind === "error") {
    clearImportPrompt();
    throw new Error(importResult.error);
  }
  clearImportPrompt();
  const successPayload = importResult.payload;
  if (successPayload.existingProgressReplaced && successPayload.run?.id) {
    clearUnsavedRun(successPayload.run.id);
  }
  const recoveryAction = setRun(successPayload.run, { skipRecovery: Boolean(successPayload.existingProgressReplaced) });
  if (recoveryAction === "none") {
    showMessage(successPayload.message, successPayload.existingProgressFound ? "warning" : "success");
  }
  await loadSavedRuns();
}

async function importJsonRun(file) {
  clearImportPrompt();
  if (state.run && !confirm("Restore JSON progress and replace the currently loaded run?")) {
    return;
  }
  showMessage("Restoring JSON progress...", "info");
  const response = await fetch("/api/import-json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await file.text()
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "JSON restore failed.");
  }
  const recoveryAction = setRun(payload.run);
  if (recoveryAction === "none") {
    showMessage(payload.message, "success");
  }
  await loadSavedRuns();
}

async function importCsvRun(file) {
  clearImportPrompt();
  if (state.run && !confirm("Restore CSV progress and replace the currently loaded run?")) {
    return;
  }
  showMessage("Restoring CSV progress...", "info");
  const response = await fetch("/api/import-csv", {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      "x-file-name": encodeURIComponent(file.name)
    },
    body: await file.text()
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "CSV restore failed.");
  }
  const recoveryAction = setRun(payload.run);
  if (recoveryAction === "none") {
    showMessage(payload.message, "success");
  }
  await loadSavedRuns();
}

function setImportPrompt(prompt) {
  state.pendingImportPrompt = prompt;
  renderImportPrompt();
}

function clearImportPrompt() {
  if (!state.pendingImportPrompt) {
    return;
  }
  state.pendingImportPrompt = null;
  renderImportPrompt();
}

function renderImportPrompt() {
  const prompt = state.pendingImportPrompt;
  elements.importPrompt.replaceChildren();
  elements.importPrompt.hidden = !prompt;
  if (!prompt) {
    return;
  }

  const header = document.createElement("div");
  header.className = "import-prompt-header";
  const copy = document.createElement("div");
  copy.className = "import-prompt-copy";
  copy.append(
    textElement("h2", prompt.type === "worksheet-selection" ? "Choose worksheet to import" : "Saved local progress already exists"),
    textElement("p", prompt.message || "")
  );
  header.append(copy);
  elements.importPrompt.append(header);

  if (prompt.type === "worksheet-selection") {
    elements.importPrompt.append(renderWorksheetSelectionPrompt(prompt));
    return;
  }

  elements.importPrompt.append(renderExistingProgressPrompt(prompt));
}

function renderWorksheetSelectionPrompt(prompt) {
  const wrapper = document.createElement("div");
  wrapper.className = "import-prompt-copy";
  const field = document.createElement("label");
  field.className = "import-prompt-field";
  field.append(textElement("span", "Worksheet"));
  const select = document.createElement("select");
  for (const sheetName of prompt.availableSheets || []) {
    const option = document.createElement("option");
    option.value = sheetName;
    option.textContent = sheetName;
    option.selected = sheetName === (prompt.selectedSheet || prompt.availableSheets?.[0] || "");
    select.append(option);
  }
  select.addEventListener("change", () => {
    if (!state.pendingImportPrompt || state.pendingImportPrompt.type !== "worksheet-selection") {
      return;
    }
    state.pendingImportPrompt.selectedSheet = select.value;
  });
  field.append(select);
  wrapper.append(field);

  const actions = document.createElement("div");
  actions.className = "import-prompt-actions";
  const continueButton = document.createElement("button");
  continueButton.type = "button";
  continueButton.className = "button-primary";
  continueButton.textContent = "Import selected worksheet";
  continueButton.addEventListener("click", continueImportWithSelectedWorksheet);
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", cancelPendingImportPrompt);
  actions.append(continueButton, cancelButton);
  wrapper.append(actions);
  return wrapper;
}

function renderExistingProgressPrompt(prompt) {
  const wrapper = document.createElement("div");
  wrapper.className = "import-prompt-copy";
  const summary = prompt.importedRunSummary || {};
  const summaryList = document.createElement("dl");
  summaryList.className = "import-prompt-summary";
  for (const [label, value] of [
    ["Run", summary.runName || summary.id || "Imported run"],
    ["Run ID", summary.runId || "Unknown"],
    ["Worksheet", summary.sheetName || "Unknown"],
    ["Cases", summary.caseCount || 0]
  ]) {
    summaryList.append(textElement("dt", label), textElement("dd", String(value)));
  }
  wrapper.append(summaryList);
  wrapper.append(textElement("p", "Resume keeps your saved local statuses, notes, defects, evidence, and step progress. Replace discards saved local progress for this run and uses the newly imported workbook state."));

  if (prompt.confirmReplace) {
    wrapper.append(textElement("div", "Confirm replace: this will overwrite the saved local run snapshot for this run only. Source XLSX files are not deleted.", "import-prompt-confirm"));
  }

  const actions = document.createElement("div");
  actions.className = "import-prompt-actions";
  const resumeButton = document.createElement("button");
  resumeButton.type = "button";
  resumeButton.className = "button-primary";
  resumeButton.textContent = "Resume saved progress";
  resumeButton.addEventListener("click", () => continueImportWithExistingProgress("resume"));

  actions.append(resumeButton);

  if (prompt.confirmReplace) {
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "button-danger";
    confirmButton.textContent = "Confirm replace";
    confirmButton.addEventListener("click", () => continueImportWithExistingProgress("replace"));
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.textContent = "Back";
    backButton.addEventListener("click", cancelReplaceConfirmation);
    actions.append(confirmButton, backButton);
  } else {
    const replaceButton = document.createElement("button");
    replaceButton.type = "button";
    replaceButton.className = "button-danger";
    replaceButton.textContent = "Replace with imported workbook";
    replaceButton.addEventListener("click", requestReplaceConfirmation);
    actions.append(replaceButton);
  }

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", cancelPendingImportPrompt);
  actions.append(cancelButton);
  wrapper.append(actions);
  return wrapper;
}

async function continueImportWithSelectedWorksheet() {
  const prompt = state.pendingImportPrompt;
  if (!prompt || prompt.type !== "worksheet-selection") {
    return;
  }
  const sheetName = prompt.selectedSheet || prompt.availableSheets?.[0] || "";
  if (!sheetName) {
    showMessage("Choose a worksheet before continuing.", "warning");
    return;
  }
  await importXlsxRun(prompt.file, { ...prompt.options, sheetName });
}

function requestReplaceConfirmation() {
  if (!state.pendingImportPrompt || state.pendingImportPrompt.type !== "existing-progress") {
    return;
  }
  state.pendingImportPrompt.confirmReplace = true;
  renderImportPrompt();
  showMessage("Confirm before replacing saved local progress.", "warning");
}

function cancelReplaceConfirmation() {
  if (!state.pendingImportPrompt || state.pendingImportPrompt.type !== "existing-progress") {
    return;
  }
  state.pendingImportPrompt.confirmReplace = false;
  renderImportPrompt();
}

async function continueImportWithExistingProgress(action) {
  const prompt = state.pendingImportPrompt;
  if (!prompt || prompt.type !== "existing-progress") {
    return;
  }
  await importXlsxRun(prompt.file, { ...prompt.options, existingAction: action });
}

function cancelPendingImportPrompt() {
  clearImportPrompt();
  showMessage("Import cancelled.", "warning");
}

async function loadSavedRuns() {
  try {
    const response = await fetch("/api/runs");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Could not load saved runs.");
    }
    state.savedRuns = Array.isArray(payload.runs) ? payload.runs : [];
    renderSavedRuns();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function renderSavedRuns() {
  const runs = sortSavedRuns(state.savedRuns, state.savedRunsSort);
  applySavedRunsSectionState(runs);
  elements.savedRuns.replaceChildren();
  if (state.savedRunsCollapsed) {
    return;
  }
  if (runs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No saved local runs yet.";
    elements.savedRuns.append(empty);
    return;
  }

  for (const run of runs) {
    const item = document.createElement("article");
    item.className = "saved-run-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-run";
    button.addEventListener("click", () => openSavedRun(run.id));
    button.append(
      titleElement(run),
      textElement("span", `${run.runId || "No run ID"} · ${run.cases} tests`),
      textElement("span", `Updated ${formatDateTime(run.updatedAt)}`)
    );
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "saved-run-delete";
    deleteButton.textContent = "Delete";
    deleteButton.title = `Delete saved run ${run.runName || run.id}`;
    deleteButton.setAttribute("aria-label", `Delete saved run ${run.runName || run.id}`);
    deleteButton.addEventListener("click", async () => {
      await deleteSavedRun(run.id);
    });
    item.append(button, deleteButton);
    elements.savedRuns.append(item);
  }
}

function titleElement(run) {
  const wrapper = document.createElement("span");
  wrapper.className = "saved-run-title";
  wrapper.append(textElement("strong", run.runName || run.id));
  if (state.run?.id === run.id) {
    wrapper.append(textElement("span", "Active", "status-badge status-in-test"));
  }
  return wrapper;
}

function applySavedRunsSectionState(runs = state.savedRuns) {
  const count = Array.isArray(runs) ? runs.length : 0;
  const countLabel = `${count} saved local ${count === 1 ? "run" : "runs"}`;
  elements.savedRunsSummary.textContent = state.savedRunsCollapsed ? `${countLabel} hidden.` : `${countLabel}.`;
  elements.savedRunsPanel.hidden = state.savedRunsCollapsed;
  elements.toggleSavedRunsButton.textContent = state.savedRunsCollapsed ? "Expand" : "Collapse";
  elements.toggleSavedRunsButton.setAttribute("aria-expanded", state.savedRunsCollapsed ? "false" : "true");
  elements.savedRunsSortSelect.disabled = count === 0;
}

function updateSavedRunsSort() {
  state.savedRunsSort = normalizeSavedRunsSort(elements.savedRunsSortSelect.value);
  localStorage.setItem(savedRunsSortStorageKey, state.savedRunsSort);
  renderSavedRuns();
}

function toggleSavedRunsCollapsed() {
  state.savedRunsCollapsed = !state.savedRunsCollapsed;
  localStorage.setItem(savedRunsCollapsedStorageKey, String(state.savedRunsCollapsed));
  renderSavedRuns();
}

async function openSavedRun(id) {
  try {
    const run = await fetchRunById(id);
    const recoveryAction = setRun(run);
    if (recoveryAction === "none") {
      showMessage("Saved local progress loaded.", "success");
    }
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function deleteSavedRun(runId) {
  const runSummary = state.savedRuns.find((run) => run.id === runId);
  const runLabel = runSummary?.runName || runId;
  if (!confirm(`Delete saved run "${runLabel}"? This removes only local saved progress.`)) {
    return;
  }

  const deletingActiveRun = state.run?.id === runId;
  const nextRunId = getNextSavedRunIdAfterDeletion(state.savedRuns, runId, state.run?.id, state.savedRunsSort);

  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Could not delete saved run.");
    }

    clearUnsavedRun(runId);
    await loadSavedRuns();

    if (deletingActiveRun) {
      if (nextRunId) {
        const nextRun = await fetchRunById(nextRunId);
        setRun(nextRun);
        showMessage("Saved run deleted. Switched to the next saved run.", "success");
        return;
      }
      clearActiveRun();
      showMessage("Saved run deleted. No saved runs remain open.", "success");
      return;
    }

    showMessage("Saved run deleted.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function setRun(run, options = {}) {
  clearImportPrompt();
  const { run: nextRun, recoveryAction } = applyUnsavedRecovery(run, options);
  state.run = normalizeRun(nextRun);
  state.selectedLocalId = state.run.cases[0]?.localId || null;
  state.selectedCaseIds = new Set();
  state.expandedFolders = collectFolderIds(buildTreeFromCases(state.run.cases, availableStatuses()));
  resetFilterOptions();
  render({ preserveScroll: true });
  renderSavedRuns();

  if (recoveryAction === "discarded-stale") {
    setSaveState("success", `Saved locally ${formatDateTime(state.run.savedAt || latestKnownUpdate(state.run))}`);
    showMessage("Discarded stale unsaved browser cache because saved run was newer.", "warning");
    return recoveryAction;
  }

  if (recoveryAction === "recovered") {
    setSaveState("warning", "Recovered unsaved local changes from this browser. Save is pending.");
    showMessage("Recovered unsaved local changes from browser cache.", "warning");
    return recoveryAction;
  }

  if (recoveryAction === "pending-unsure") {
    setSaveState("warning", "Unsaved browser changes found, but freshness could not be verified.");
    showMessage("Unsaved browser changes found. Recover or discard them.", "warning");
    return recoveryAction;
  }

  setSaveState("success", `Saved locally ${formatDateTime(state.run.savedAt || latestKnownUpdate(state.run))}`);
  return "none";
}

function clearActiveRun() {
  clearImportPrompt();
  state.run = null;
  state.selectedLocalId = null;
  state.selectedCaseIds = new Set();
  state.expandedFolders = new Set();
  state.pendingRecoveredRun = null;
  resetFilterOptions();
  elements.runMeta.textContent = defaultRunMetaText;
  elements.saveState.hidden = true;
  setSaveStateActions();
  render({ preserveScroll: true });
  renderSavedRuns();
}

function resetFilterOptions() {
  elements.searchInput.value = "";
  state.filters = {
    search: "",
    currentStatus: "",
    originalStatus: "",
    priority: "",
    section: "",
    assignedTo: ""
  };
  fillSelect(elements.bulkStatusSelect, "Choose status", availableStatuses());
  fillSelect(elements.currentStatusFilter, "Current Status", availableStatuses());
  fillSelect(elements.originalStatusFilter, "Original Status", uniqueValues("originalStatus"));
  fillSelect(elements.priorityFilter, "Priority", uniqueValues("priority"));
  fillSelect(elements.sectionFilter, "Section", uniqueValues("section"));
  fillSelect(elements.assignedToFilter, "Assigned To", uniqueValues("assignedTo"));
}

function render(options = {}) {
  const run = state.run;
  const hasRun = Boolean(run);
  elements.workspace.hidden = !hasRun;
  elements.exportJsonButton.disabled = !hasRun;
  elements.exportCsvButton.disabled = !hasRun;
  elements.exportMenuSummary.setAttribute("aria-disabled", hasRun ? "false" : "true");
  if (!hasRun) {
    return;
  }

  const doRender = () => {
    elements.runMeta.textContent = `${run.runName || "Imported run"} · ${run.runId || "No run ID"} · ${run.sheetName} · ${run.cases.length} tests`;
    renderSummary(run.cases);
    const visibleCases = filteredCases();
    pruneSelection();
    const groupedCases = groupCasesBySection(visibleCases);
    renderBulkControls(visibleCases);
    renderTree(visibleCases);
    renderCaseList(groupedCases);
    renderDetail(run.cases.find((testCase) => testCase.localId === state.selectedLocalId) || visibleCases[0]);

    if (options.scrollIntoView) {
      const selectedRow = elements.caseList.querySelector(".case-list-row.selected");
      if (selectedRow) {
        selectedRow.scrollIntoView({ block: "nearest" });
      }
    }
  };

  const renderWithCaseScroll = options.preserveScroll ? withCaseListScrollPreserved : runImmediately;
  const renderWithDetailScroll = options.preserveDetailScroll ? withDetailPaneScrollPreserved : runImmediately;
  renderWithCaseScroll(() => renderWithDetailScroll(doRender));
}


function renderSummary(cases) {
  elements.summary.replaceChildren();
  const runStatuses = availableStatuses();
  const stats = calculateRunStats(cases, runStatuses);
  const progress = document.createElement("div");
  progress.className = "progress-panel";

  const donut = document.createElement("div");
  donut.className = "progress-donut";
  donut.style.setProperty("--progress", `${stats.completedPercent}%`);
  const donutCenter = document.createElement("div");
  donutCenter.className = "progress-center";
  donutCenter.append(textElement("strong", `${stats.completedPercent}%`), textElement("span", "completed"));
  donut.append(donutCenter);

  const progressText = document.createElement("div");
  progressText.className = "progress-copy";
  progressText.append(
    textElement("span", "Execution Progress", "eyebrow"),
    textElement("h2", `${stats.completed} of ${stats.total} tests touched`),
    textElement("p", `${stats.passedPercent}% passed. Completed includes every status except Untested.`)
  );
  progress.append(donut, progressText);
  elements.summary.append(progress);

  const items = [["Total", stats.total], ...runStatuses.map((status) => [status, stats.counts[status] || 0])];
  for (const [label, count] of items) {
    const card = document.createElement("div");
    card.className = label === "Total" ? "summary-card" : `summary-card ${getStatusColor(label).className}`;
    card.append(textElement("span", label), textElement("strong", count));
    elements.summary.append(card);
  }
}

function renderTree(cases) {
  const tree = buildTreeFromCases(cases, availableStatuses());
  elements.treeRoot.replaceChildren();
  const list = document.createElement("ul");
  list.className = "tree-list";
  for (const child of tree.children) {
    list.append(renderTreeNode(child));
  }
  elements.treeRoot.append(list);
}

function renderTreeNode(node) {
  const item = document.createElement("li");
  item.className = `tree-node tree-${node.type}`;
  if (node.type === "folder") {
    const isOpen = state.expandedFolders.has(node.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-folder-button";
    button.title = node.name;
    button.addEventListener("click", () => {
      if (state.expandedFolders.has(node.id)) {
        state.expandedFolders.delete(node.id);
      } else {
        state.expandedFolders.add(node.id);
      }
      render({ preserveScroll: true });
    });
    button.append(
      textElement("span", isOpen ? "▾" : "▸", "tree-caret"),
      statusDot(node.aggregateStatus),
      textElement("span", node.name, "tree-label"),
      textElement("span", totalFromCounts(node.counts), "tree-count")
    );
    item.append(button);
    if (isOpen && node.children.length > 0) {
      const children = document.createElement("ul");
      children.className = "tree-list";
      for (const child of node.children) {
        children.append(renderTreeNode(child));
      }
      item.append(children);
    }
    return item;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = `tree-test-button ${getStatusColor(node.status).className}`;
  button.title = [node.testId, node.caseId, node.name].filter(Boolean).join(" · ");
  if (node.localId === state.selectedLocalId) {
    button.classList.add("selected");
  }
  button.addEventListener("click", () => {
    state.selectedLocalId = node.localId;
    render({ preserveScroll: true });
  });
  button.append(
    statusDot(node.status),
    textElement("span", node.testId || node.caseId || "", "tree-test-id"),
    textElement("span", node.name, "tree-label")
  );
  item.append(button);
  return item;
}

function renderCaseList(groups) {
  elements.caseList.replaceChildren();
  if (groups.length === 0) {
    elements.caseList.append(textElement("p", "No test cases match the current filters.", "empty-list"));
    return;
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "case-group";
    const heading = document.createElement("div");
    heading.className = "case-group-heading";
    heading.append(textElement("span", group.label), textElement("strong", `${group.cases.length}`));
    section.append(heading);

    for (const testCase of group.cases) {
      section.append(caseListRow(testCase));
    }
    elements.caseList.append(section);
  }
}

function caseListRow(testCase) {
  const row = document.createElement("div");
  row.className = "case-list-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  if (state.selectedCaseIds.has(testCase.localId)) {
    row.classList.add("checked");
  }
  if (testCase.localId === state.selectedLocalId) {
    row.classList.add("selected");
  }
  row.addEventListener("click", () => {
    state.selectedLocalId = testCase.localId;
    render({ preserveScroll: true });
  });
  row.addEventListener("keydown", (event) => {
    if (event.target !== row) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    state.selectedLocalId = testCase.localId;
    render({ preserveScroll: true });
  });

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedCaseIds.has(testCase.localId);
  checkbox.setAttribute("aria-label", `Select ${testCase.testId || testCase.caseId || "test case"}`);
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  checkbox.addEventListener("change", (event) => {
    event.stopPropagation();
    toggleCaseSelection(testCase.localId, checkbox.checked);
  });

  row.append(
    checkbox,
    textElement("span", testCase.testId || "", "case-list-id"),
    textElement("span", testCase.title || "Untitled test", "case-list-title"),
    statusBadge(testCase.currentStatus)
  );
  return row;
}

function renderDetail(testCase) {
  elements.detailPane.replaceChildren();
  if (!testCase) {
    elements.detailPane.append(textElement("p", "No test cases match the current filters.", "empty-detail"));
    return;
  }
  state.selectedLocalId = testCase.localId;

  const header = document.createElement("div");
  header.className = "detail-header";
  header.append(textElement("span", `${testCase.testId || "No ID"} · ${testCase.caseId || "No Case ID"}`, "eyebrow"));
  header.append(textElement("h2", testCase.title || "Untitled test"));
  header.append(statusBadge(testCase.currentStatus));
  elements.detailPane.append(header);

  const statusLabel = labelWithControl("Current Status", createStatusSelect(testCase));
  elements.detailPane.append(statusLabel);

  const meta = document.createElement("dl");
  meta.className = "meta-grid";
  for (const [label, value] of [
    ["Section", testCase.section],
    ["Section Hierarchy", testCase.sectionHierarchy],
    ["Priority", testCase.priority],
    ["Type", testCase.type],
    ["Template", testCase.template],
    ["Assigned To", testCase.assignedTo],
    ["Original Status", testCase.originalStatus],
    ["Tested By", testCase.testedBy],
    ["Tested On", testCase.testedOn]
  ]) {
    meta.append(textElement("dt", label), textElement("dd", value || "-"));
  }
  elements.detailPane.append(meta);

  elements.detailPane.append(
    detailBlock("Imported Comment", testCase.importedComment),
    editorBlock("Local Notes", "localNotes", testCase),
    detailBlock("Imported Defects", testCase.importedDefects),
    editorBlock("Local Defects", "localDefects", testCase),
    detailBlock("References", testCase.references),
    editorBlock("Local Evidence", "localEvidence", testCase),
    detailBlock("Preconditions", testCase.preconditions),
    stepsTable(testCase)
  );

  const raw = document.createElement("details");
  raw.className = "raw-fields";
  const summary = document.createElement("summary");
  summary.textContent = "Raw imported fields";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(testCase.rawRow, null, 2);
  raw.append(summary, pre);
  elements.detailPane.append(raw);
  elements.detailPane.append(resultActions(testCase));
}

function renderBulkControls(visibleCases) {
  const selectedVisibleCount = visibleCases.filter((testCase) => state.selectedCaseIds.has(testCase.localId)).length;
  const selectedCount = state.selectedCaseIds.size;
  elements.bulkBar.hidden = selectedCount === 0;
  elements.selectedCount.textContent = `${selectedCount} selected`;
  elements.selectAllVisibleCheckbox.checked = visibleCases.length > 0 && selectedVisibleCount === visibleCases.length;
  elements.selectAllVisibleCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleCases.length;
}

function stepsTable(testCase) {
  const rows = Array.isArray(testCase.steps) && testCase.steps.length > 0
    ? testCase.steps
    : parseSteps(testCase.rawRow || {}, { availableStatuses: availableStatuses() });
  const wrapper = document.createElement("section");
  wrapper.className = "detail-block steps-block";
  wrapper.append(textElement("h3", "Steps"));

  if (rows.length === 0) {
    const pre = document.createElement("pre");
    pre.textContent = testCase.stepsStep || testCase.stepsCombined || "-";
    wrapper.append(pre);
    return wrapper;
  }

  const hasStepStatus = rows.length > 0;
  const hasExtras = rows.some((row) => row.additionalInfo || row.references);
  const scroll = document.createElement("div");
  scroll.className = "steps-scroll";
  const table = document.createElement("table");
  table.className = "steps-table";
  const columnGroup = document.createElement("colgroup");
  columnGroup.append(colElement("steps-col-step"), colElement("steps-col-expected"));
  if (hasStepStatus) {
    columnGroup.append(colElement("steps-col-status"));
  }
  if (hasExtras) {
    columnGroup.append(colElement("steps-col-more"));
  }
  table.append(columnGroup);
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(textElement("th", "Step"), textElement("th", "Expected Result"));
  if (hasStepStatus) {
    headerRow.append(textElement("th", "Step Status"));
  }
  if (hasExtras) {
    headerRow.append(textElement("th", "More"));
  }
  head.append(headerRow);
  table.append(head);

  const body = document.createElement("tbody");
  for (const [index, row] of rows.entries()) {
    const tr = document.createElement("tr");
    tr.append(multilineCell(row.step), multilineCell(row.expectedResult));
    if (hasStepStatus) {
      const statusCell = document.createElement("td");
      statusCell.append(createStepStatusEditor(testCase, index, row));
      tr.append(statusCell);
    }
    if (hasExtras) {
      const extraCell = document.createElement("td");
      if (row.additionalInfo || row.references) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Details";
        const pre = document.createElement("pre");
        pre.textContent = [
          row.additionalInfo ? `Additional Info:\n${row.additionalInfo}` : "",
          row.references ? `References:\n${row.references}` : ""
        ].filter(Boolean).join("\n\n");
        details.append(summary, pre);
        extraCell.append(details);
      }
      tr.append(extraCell);
    }
    body.append(tr);
  }
  table.append(body);
  scroll.append(table);
  wrapper.append(scroll);
  return wrapper;
}

function createStatusSelect(testCase) {
  const select = document.createElement("select");
  for (const status of availableStatuses()) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = status === testCase.currentStatus;
    select.append(option);
  }
  select.addEventListener("change", () => {
    updateCaseStatus(testCase.localId, select.value);
  });
  return select;
}

function createStepStatusEditor(testCase, stepIndex, row) {
  const wrapper = document.createElement("div");
  wrapper.className = "step-status-editor";

  const select = document.createElement("select");
  select.className = "step-status-select";
  select.dataset.stepLocalId = testCase.localId;
  select.dataset.stepIndex = String(stepIndex);
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Choose status";
  select.append(empty);
  for (const status of availableStatuses()) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    select.append(option);
  }
  select.value = row.currentStatus || row.status || "";
  select.title = `Step ${stepIndex + 1} status`;
  select.setAttribute("aria-label", `Step ${stepIndex + 1} status`);
  select.addEventListener("change", () => {
    updateCaseStepStatus(testCase.localId, stepIndex, select.value);
  });
  wrapper.append(select);

  if (row.status && row.currentStatus !== row.status) {
    wrapper.append(textElement("span", `Imported: ${row.status}`, "step-status-original"));
  }

  return wrapper;
}

function resultActions(testCase) {
  const wrapper = document.createElement("section");
  wrapper.className = "result-actions";
  wrapper.setAttribute("aria-label", "Execution actions");
  const passNext = document.createElement("button");
  passNext.type = "button";
  passNext.className = "primary-action";
  passNext.textContent = "Pass & Next";
  passNext.addEventListener("click", () => updateCaseStatus(testCase.localId, "Passed", { advance: true }));
  wrapper.append(passNext);

  for (const [label, status] of statusActionsForRun()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `result-button ${getStatusColor(status).className}`;
    button.textContent = label;
    button.addEventListener("click", () => updateCaseStatus(testCase.localId, status));
    wrapper.append(button);
  }
  return wrapper;
}

function editorBlock(title, field, testCase) {
  const wrapper = document.createElement("label");
  wrapper.className = "editor-block";
  wrapper.append(textElement("span", title));
  const textarea = document.createElement("textarea");
  textarea.value = testCase[field] || "";
  textarea.rows = 4;
  textarea.addEventListener("change", () => {
    updateCase(testCase.localId, { [field]: textarea.value });
  });
  wrapper.append(textarea);
  return wrapper;
}

function detailBlock(title, value) {
  const section = document.createElement("section");
  section.className = "detail-block";
  section.append(textElement("h3", title));
  const pre = document.createElement("pre");
  pre.textContent = value || "-";
  section.append(pre);
  return section;
}

function colElement(className) {
  const col = document.createElement("col");
  col.className = className;
  return col;
}

function statusBadge(status) {
  const badge = document.createElement("span");
  const statusColor = getStatusColor(status);
  badge.className = `status-badge ${statusColor.className}`;
  badge.textContent = status || "Unknown";
  return badge;
}

function statusDot(status) {
  const dot = document.createElement("span");
  dot.className = `status-dot ${getStatusColor(status).className}`;
  dot.title = status || "Unknown";
  return dot;
}

function multilineCell(value) {
  const cell = document.createElement("td");
  const pre = document.createElement("pre");
  pre.textContent = value || "";
  cell.append(pre);
  return cell;
}

async function updateCase(localId, patch) {
  const testCase = state.run.cases.find((item) => item.localId === localId);
  if (!testCase) {
    return;
  }
  Object.assign(testCase, patch, { updatedAt: new Date().toISOString() });
  render({ preserveScroll: true });
  try {
    await saveProgress();
    showMessage("Progress saved locally.", "success");
    await loadSavedRuns();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function updateCaseStepStatus(localId, stepIndex, status) {
  const result = applyStepStatusToCase(state.run.cases, localId, stepIndex, status, new Date().toISOString());
  if (result.changed === 0) {
    showMessage("Selected step was not found.", "error");
    return;
  }
  render({ preserveScroll: true, preserveDetailScroll: true });
  try {
    await saveProgress();
    showMessage(`Updated step status to ${status || "blank"}.`, "success");
    await loadSavedRuns();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function updateCaseStatus(localId, status, options = {}) {
  const visibleIds = getVisibleCaseOrder(groupCasesBySection(filteredCases()));
  const nextId = options.advance ? getNextCaseId(localId, visibleIds) : null;
  const result = applyStatusToCase(state.run.cases, localId, status, new Date().toISOString());
  if (result.changed === 0) {
    showMessage("Selected test case was not found.", "error");
    return;
  }
  if (options.advance && nextId) {
    state.selectedLocalId = nextId;
  }
  render({ preserveScroll: true, scrollIntoView: options.advance });
  try {
    await saveProgress();
    showMessage(
      options.advance && !nextId
        ? `Updated test case to ${status}. No next visible test case.`
        : `Updated test case to ${status}.`,
      options.advance && !nextId ? "warning" : "success"
    );
    await loadSavedRuns();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function applyBulkStatus() {
  const status = elements.bulkStatusSelect.value;
  const selectedIds = [...state.selectedCaseIds];
  if (!status || selectedIds.length === 0) {
    return;
  }
  if (selectedIds.length > 10 && !confirm(`Update ${selectedIds.length} test cases to ${status}?`)) {
    return;
  }
  const result = applyStatusToCases(state.run.cases, selectedIds, status, new Date().toISOString());
  state.selectedCaseIds.clear();
  render({ preserveScroll: true });
  try {
    await saveProgress();
    showMessage(`Updated ${result.changed} test cases to ${status}.`, "success");
    await loadSavedRuns();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function appendBulkNote() {
  const note = elements.bulkNoteInput.value;
  const selectedIds = [...state.selectedCaseIds];
  if (!note.trim() || selectedIds.length === 0) {
    return;
  }
  if (selectedIds.length > 10 && !confirm(`Append note to ${selectedIds.length} test cases?`)) {
    return;
  }
  const result = appendNoteToCases(state.run.cases, selectedIds, note, new Date().toISOString());
  elements.bulkNoteInput.value = "";
  state.selectedCaseIds.clear();
  render({ preserveScroll: true });
  try {
    await saveProgress();
    showMessage(`Appended note to ${result.changed} test cases.`, "success");
    await loadSavedRuns();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function saveProgress() {
  cacheUnsavedRun(state.run);
  setSaveState("info", "Saving locally...");
  const response = await fetch(`/api/runs/${encodeURIComponent(state.run.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run: state.run })
  });
  const payload = await response.json();
  if (!response.ok) {
    setSaveState("error", "Save failed. Changes are cached in this browser.");
    throw new Error(payload.error || "Could not save progress.");
  }
  state.run = normalizeRun(payload.run);
  clearUnsavedRun(state.run.id);
  setSaveState("success", `Saved locally ${formatDateTime(state.run.savedAt || latestKnownUpdate(state.run))}`);
}

function filteredCases() {
  const search = state.filters.search.trim().toLowerCase();
  return state.run.cases.filter((testCase) => {
    if (state.filters.currentStatus && testCase.currentStatus !== state.filters.currentStatus) return false;
    if (state.filters.originalStatus && testCase.originalStatus !== state.filters.originalStatus) return false;
    if (state.filters.priority && testCase.priority !== state.filters.priority) return false;
    if (state.filters.section && testCase.section !== state.filters.section) return false;
    if (state.filters.assignedTo && testCase.assignedTo !== state.filters.assignedTo) return false;
    if (!search) return true;
    return [
      testCase.testId,
      testCase.caseId,
      testCase.title,
      testCase.section,
      testCase.references,
      testCase.importedDefects,
      testCase.localDefects
    ].some((value) => String(value || "").toLowerCase().includes(search));
  });
}

function clearFilters() {
  elements.searchInput.value = "";
  for (const element of [
    elements.currentStatusFilter,
    elements.originalStatusFilter,
    elements.priorityFilter,
    elements.sectionFilter,
    elements.assignedToFilter
  ]) {
    element.value = "";
  }
  state.filters = {
    search: "",
    currentStatus: "",
    originalStatus: "",
    priority: "",
    section: "",
    assignedTo: ""
  };
  render({ preserveScroll: true });
}

function toggleCaseSelection(localId, selected) {
  withCaseListScrollPreserved(() => {
    if (selected) {
      state.selectedCaseIds.add(localId);
    } else {
      state.selectedCaseIds.delete(localId);
    }
    render({ preserveScroll: true });
  });
}

function toggleAllVisibleSelection() {
  withCaseListScrollPreserved(() => {
    const visibleCases = filteredCases();
    if (elements.selectAllVisibleCheckbox.checked) {
      for (const testCase of visibleCases) {
        state.selectedCaseIds.add(testCase.localId);
      }
    } else {
      for (const testCase of visibleCases) {
        state.selectedCaseIds.delete(testCase.localId);
      }
    }
    render({ preserveScroll: true });
  });
}

function clearSelection() {
  withCaseListScrollPreserved(() => {
    state.selectedCaseIds.clear();
    render({ preserveScroll: true });
  });
}

function pruneSelection() {
  if (!state.run) {
    return;
  }
  const validIds = new Set(state.run.cases.map((testCase) => testCase.localId));
  for (const localId of state.selectedCaseIds) {
    if (!validIds.has(localId)) {
      state.selectedCaseIds.delete(localId);
    }
  }
}

function startResizingPanels(event) {
  const handle = event.currentTarget.dataset.resizeHandle;
  if (!handle) {
    return;
  }
  state.activeResize = {
    handle,
    startX: event.clientX,
    startWidths: { ...state.panelWidths }
  };
  document.body.classList.add("resizing-panels");
  event.preventDefault();
}

function resizePanels(event) {
  if (!state.activeResize) {
    return;
  }
  const deltaX = event.clientX - state.activeResize.startX;
  state.panelWidths = resizePanelWidths(
    state.activeResize.startWidths,
    state.activeResize.handle,
    deltaX
  );
  applyPanelWidths();
}

function stopResizingPanels() {
  if (!state.activeResize) {
    return;
  }
  state.activeResize = null;
  document.body.classList.remove("resizing-panels");
  savePanelWidths();
}

function startResizingCaseListColumn(event) {
  const column = event.currentTarget.dataset.caseColumn;
  if (!column) {
    return;
  }
  state.activeColumnResize = {
    column,
    startX: event.clientX,
    startColumns: { ...state.caseListColumns }
  };
  document.body.classList.add("resizing-columns");
  event.preventDefault();
  event.stopPropagation();
}

function resizeCaseListColumn(event) {
  if (!state.activeColumnResize) {
    return;
  }
  const deltaX = event.clientX - state.activeColumnResize.startX;
  state.caseListColumns = resizeCaseListColumns(
    state.activeColumnResize.startColumns,
    state.activeColumnResize.column,
    deltaX
  );
  applyCaseListColumns();
}

function stopResizingCaseListColumn() {
  if (!state.activeColumnResize) {
    return;
  }
  state.activeColumnResize = null;
  document.body.classList.remove("resizing-columns");
  saveCaseListColumns();
}

function applyPanelWidths() {
  state.panelWidths = sanitizePanelWidths(state.panelWidths);
  elements.contentGrid.style.setProperty("--tree-width", `${state.panelWidths.tree}px`);
  elements.contentGrid.style.setProperty("--list-width", `${state.panelWidths.list}px`);
  elements.contentGrid.style.setProperty("--detail-width", `${state.panelWidths.detail}px`);
}

function applyCaseListColumns() {
  state.caseListColumns = sanitizeCaseListColumns(state.caseListColumns);
  elements.tableWrap.style.setProperty("--case-id-col", `${state.caseListColumns.id}px`);
  elements.tableWrap.style.setProperty("--case-title-col", `${state.caseListColumns.title}px`);
  elements.tableWrap.style.setProperty("--case-status-col", `${state.caseListColumns.status}px`);
}

function resetLayout() {
  state.panelWidths = sanitizePanelWidths(panelDefaults);
  state.caseListColumns = sanitizeCaseListColumns(caseListColumnDefaults);
  localStorage.removeItem(layoutStorageKey);
  localStorage.removeItem(caseListColumnsStorageKey);
  applyPanelWidths();
  applyCaseListColumns();
  showMessage("Layout widths reset.", "success");
}

function loadPanelWidths() {
  try {
    return sanitizePanelWidths(JSON.parse(localStorage.getItem(layoutStorageKey) || "{}"));
  } catch {
    return sanitizePanelWidths();
  }
}

function savePanelWidths() {
  localStorage.setItem(layoutStorageKey, JSON.stringify(state.panelWidths));
}

function loadCaseListColumns() {
  try {
    return sanitizeCaseListColumns(JSON.parse(localStorage.getItem(caseListColumnsStorageKey) || "{}"));
  } catch {
    return sanitizeCaseListColumns();
  }
}

function saveCaseListColumns() {
  localStorage.setItem(caseListColumnsStorageKey, JSON.stringify(state.caseListColumns));
}

function loadSavedRunsCollapsed() {
  return localStorage.getItem(savedRunsCollapsedStorageKey) === "true";
}

function loadSavedRunsSort() {
  return normalizeSavedRunsSort(localStorage.getItem(savedRunsSortStorageKey) || "newest");
}

function normalizeSavedRunsSort(value) {
  return ["newest", "oldest", "run-name", "run-id"].includes(value) ? value : "newest";
}

function withCaseListScrollPreserved(callback) {
  const scrollTop = elements.tableWrap.scrollTop;
  const scrollLeft = elements.tableWrap.scrollLeft;
  callback();
  elements.tableWrap.scrollTop = scrollTop;
  elements.tableWrap.scrollLeft = scrollLeft;
}

function withDetailPaneScrollPreserved(callback) {
  const scrollTop = elements.detailPane.scrollTop;
  const scrollLeft = elements.detailPane.scrollLeft;
  callback();
  elements.detailPane.scrollTop = scrollTop;
  elements.detailPane.scrollLeft = scrollLeft;
}

function runImmediately(callback) {
  callback();
}

function exportJson() {
  if (!state.run) {
    return;
  }
  closeMenus();
  window.location.href = `/api/runs/${encodeURIComponent(state.run.id)}/export`;
}

function exportCsv() {
  if (!state.run) {
    return;
  }
  closeMenus();
  const blob = new Blob([buildCsvExport(state.run)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${state.run.id}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fillSelect(select, label, values) {
  select.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = label;
  select.append(empty);
  for (const value of values.filter(Boolean)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function collectFolderIds(tree) {
  const ids = new Set();
  visitTree(tree, (node) => {
    if (node.type === "folder") {
      ids.add(node.id);
    }
  });
  return ids;
}

function visitTree(node, callback) {
  callback(node);
  for (const child of node.children || []) {
    visitTree(child, callback);
  }
}

function totalFromCounts(counts) {
  return Object.values(counts || {}).reduce((sum, count) => sum + count, 0);
}

function uniqueValues(field) {
  return [...new Set((state.run?.cases || []).map((testCase) => testCase[field]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function labelWithControl(title, control) {
  const label = document.createElement("label");
  label.className = "control-label";
  label.append(textElement("span", title), control);
  return label;
}

function textElement(tagName, text, className = "") {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) {
    element.className = className;
  }
  return element;
}

function showMessage(text, type) {
  elements.message.hidden = false;
  elements.message.textContent = text;
  elements.message.className = `message ${type}`;
}

function setSaveState(type, text) {
  if (!elements.saveState) {
    return;
  }
  elements.saveState.hidden = false;
  elements.saveState.textContent = text;
  elements.saveState.className = `save-state ${type}`;
}

function setSaveStateActions({ showRecover = false, showDiscard = false } = {}) {
  if (!elements.saveStateActions) {
    return;
  }
  elements.saveStateActions.hidden = !showRecover && !showDiscard;
  elements.recoverUnsavedButton.hidden = !showRecover;
  elements.discardUnsavedButton.hidden = !showDiscard;
}

function unsavedRunStorageKey(runId) {
  return `${unsavedRunPrefix}${String(runId || "run")}`;
}

function cacheUnsavedRun(run) {
  if (!run?.id) {
    return;
  }
  try {
    localStorage.setItem(
      unsavedRunStorageKey(run.id),
      JSON.stringify({
        run,
        cachedAt: new Date().toISOString()
      })
    );
  } catch (error) {
    console.warn("Could not cache unsaved progress locally.", error);
  }
}

function clearUnsavedRun(runId) {
  if (!runId) {
    return;
  }
  localStorage.removeItem(unsavedRunStorageKey(runId));
}

function applyUnsavedRecovery(run, options = {}) {
  setSaveStateActions();
  state.pendingRecoveredRun = null;
  if (options.skipRecovery) {
    return { run, recoveryAction: "none" };
  }
  if (!run?.id) {
    return { run, recoveryAction: "none" };
  }
  try {
    const cached = localStorage.getItem(unsavedRunStorageKey(run.id));
    if (!cached) {
      return { run, recoveryAction: "none" };
    }
    const parsed = JSON.parse(cached);
    const decision = resolveUnsavedRunRecovery(run, parsed);
    if (decision.action === "apply") {
      setSaveStateActions({ showDiscard: true });
      return { run: decision.run, recoveryAction: "recovered" };
    }
    if (decision.action === "discard") {
      clearUnsavedRun(run.id);
      return { run, recoveryAction: "discarded-stale" };
    }
    if (decision.action === "pending") {
      state.pendingRecoveredRun = decision.run;
      setSaveStateActions({ showRecover: true, showDiscard: true });
      return { run, recoveryAction: "pending-unsure" };
    }
    return { run, recoveryAction: "none" };
  } catch (error) {
    console.warn("Could not restore unsaved progress cache.", error);
    return { run, recoveryAction: "none" };
  }
}

function latestKnownUpdate(run) {
  const timestamp = latestRunTimestamp(run);
  return timestamp ? new Date(timestamp).toISOString() : "";
}

async function fetchRunById(id) {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Could not open saved run.");
  }
  return payload.run;
}

function recoverUnsavedChanges() {
  if (!state.pendingRecoveredRun) {
    return;
  }
  setRun(state.pendingRecoveredRun, { skipRecovery: true });
  cacheUnsavedRun(state.run);
  setSaveState("warning", "Recovered unsaved browser changes.");
  setSaveStateActions({ showDiscard: true });
  showMessage("Recovered unsaved browser changes.", "warning");
  state.pendingRecoveredRun = null;
}

async function discardUnsavedChanges() {
  if (!state.run?.id) {
    return;
  }
  const runId = state.run.id;
  clearUnsavedRun(runId);
  state.pendingRecoveredRun = null;
  setSaveStateActions();
  try {
    const freshRun = await fetchRunById(runId);
    setRun(freshRun, { skipRecovery: true });
    setSaveState("success", `Saved locally ${formatDateTime(freshRun.savedAt || latestKnownUpdate(freshRun))}`);
    showMessage("Discarded unsaved browser changes.", "success");
  } catch (error) {
    setSaveState("error", "Could not reload saved run after discarding cache.");
    showMessage(error.message, "error");
  }
}

function hasLocalNotes(testCase) {
  return Boolean(testCase.localNotes || testCase.localDefects || testCase.localEvidence);
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function closeMenus() {
  for (const menu of elements.menuControls) {
    menu.open = false;
  }
}
