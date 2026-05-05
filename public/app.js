import {
  appendNoteToCases,
  applyStatusToCase,
  applyStatusToCases,
  buildTreeFromCases,
  caseListColumnDefaults,
  calculateRunStats,
  getNextCaseId,
  getStatusColor,
  getVisibleCaseOrder,
  groupCasesBySection,
  panelDefaults,
  resizeCaseListColumns,
  resizePanelWidths,
  sanitizeCaseListColumns,
  sanitizePanelWidths,
  parseSteps,
  statuses
} from "./model.js";

const layoutStorageKey = "testrailLocalViewer.panelWidths.v1";
const caseListColumnsStorageKey = "testrailLocalViewer.caseListColumns.v1";
const statusActions = [
  ["Pass", "Passed"],
  ["Fail", "Failed"],
  ["Block", "Blocked"],
  ["Retest", "Retest"],
  ["In Test", "In test"],
  ["Untested", "Untested"],
  ["Conditionally Pass", "Conditionally Passed"]
];

const state = {
  run: null,
  selectedLocalId: null,
  selectedCaseIds: new Set(),
  expandedFolders: new Set(),
  panelWidths: loadPanelWidths(),
  caseListColumns: loadCaseListColumns(),
  activeResize: null,
  activeColumnResize: null,
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
  fileInput: document.querySelector("#fileInput"),
  runMeta: document.querySelector("#runMeta"),
  message: document.querySelector("#message"),
  savedRuns: document.querySelector("#savedRuns"),
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

elements.fileInput.addEventListener("change", importSelectedFile);
elements.refreshRunsButton.addEventListener("click", loadSavedRuns);
elements.clearFiltersButton.addEventListener("click", clearFilters);
elements.exportJsonButton.addEventListener("click", exportJson);
elements.exportCsvButton.addEventListener("click", exportCsv);
elements.resetLayoutButton.addEventListener("click", resetLayout);
elements.bulkApplyButton.addEventListener("click", applyBulkStatus);
elements.bulkAppendNoteButton.addEventListener("click", appendBulkNote);
elements.clearSelectionButton.addEventListener("click", clearSelection);
elements.selectAllVisibleCheckbox.addEventListener("change", toggleAllVisibleSelection);
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

async function importSelectedFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    showMessage("Importing selected XLSX...", "info");
    const response = await fetch("/api/import", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name)
      },
      body: await file.arrayBuffer()
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Import failed.");
    }
    setRun(payload.run);
    showMessage(payload.message, payload.existingProgressFound ? "warning" : "success");
    await loadSavedRuns();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    event.target.value = "";
  }
}

async function loadSavedRuns() {
  try {
    const response = await fetch("/api/runs");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Could not load saved runs.");
    }
    renderSavedRuns(payload.runs);
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function renderSavedRuns(runs) {
  elements.savedRuns.replaceChildren();
  if (runs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No saved local runs yet.";
    elements.savedRuns.append(empty);
    return;
  }

  for (const run of runs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-run";
    button.addEventListener("click", () => openSavedRun(run.id));
    button.append(
      textElement("strong", run.runName || run.id),
      textElement("span", `${run.runId || "No run ID"} · ${run.cases} tests`),
      textElement("span", `Updated ${formatDateTime(run.updatedAt)}`)
    );
    elements.savedRuns.append(button);
  }
}

async function openSavedRun(id) {
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Could not open saved run.");
    }
    setRun(payload.run);
    showMessage("Saved local progress loaded.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function setRun(run) {
  state.run = run;
  state.selectedLocalId = run.cases[0]?.localId || null;
  state.selectedCaseIds = new Set();
  state.expandedFolders = collectFolderIds(buildTreeFromCases(run.cases));
  resetFilterOptions();
  render({ preserveScroll: true });
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
  fillSelect(elements.currentStatusFilter, "Current Status", statuses);
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

  if (options.preserveScroll) {
    withCaseListScrollPreserved(doRender);
  } else {
    doRender();
  }
}


function renderSummary(cases) {
  elements.summary.replaceChildren();
  const stats = calculateRunStats(cases);
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

  const items = [["Total", stats.total], ...statuses.map((status) => [status, stats.counts[status] || 0])];
  for (const [label, count] of items) {
    const card = document.createElement("div");
    card.className = label === "Total" ? "summary-card" : `summary-card ${getStatusColor(label).className}`;
    card.append(textElement("span", label), textElement("strong", count));
    elements.summary.append(card);
  }
}

function renderTree(cases) {
  const tree = buildTreeFromCases(cases);
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
    : parseSteps(testCase.rawRow || {});
  const wrapper = document.createElement("section");
  wrapper.className = "detail-block steps-block";
  wrapper.append(textElement("h3", "Steps"));

  if (rows.length === 0) {
    const pre = document.createElement("pre");
    pre.textContent = testCase.stepsStep || testCase.stepsCombined || "-";
    wrapper.append(pre);
    return wrapper;
  }

  const hasStepStatus = rows.some((row) => row.status);
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
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.append(multilineCell(row.step), multilineCell(row.expectedResult));
    if (hasStepStatus) {
      const statusCell = document.createElement("td");
      statusCell.append(row.status ? statusBadge(row.status) : textElement("span", ""));
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
  for (const status of statuses) {
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

  for (const [label, status] of statusActions) {
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
  const response = await fetch(`/api/runs/${encodeURIComponent(state.run.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run: state.run })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Could not save progress.");
  }
  state.run = payload.run;
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

function withCaseListScrollPreserved(callback) {
  const scrollTop = elements.tableWrap.scrollTop;
  const scrollLeft = elements.tableWrap.scrollLeft;
  callback();
  elements.tableWrap.scrollTop = scrollTop;
  elements.tableWrap.scrollLeft = scrollLeft;
}

function exportJson() {
  if (!state.run) {
    return;
  }
  window.location.href = `/api/runs/${encodeURIComponent(state.run.id)}/export`;
}

function exportCsv() {
  if (!state.run) {
    return;
  }
  const fields = [
    "testId",
    "caseId",
    "title",
    "section",
    "priority",
    "originalStatus",
    "currentStatus",
    "assignedTo",
    "testedBy",
    "testedOn",
    "localNotes",
    "localDefects",
    "localEvidence",
    "updatedAt"
  ];
  const rows = [fields.join(",")];
  for (const testCase of state.run.cases) {
    rows.push(fields.map((field) => csvEscape(testCase[field] || "")).join(","));
  }
  const blob = new Blob([`${rows.join("\n")}\n`], { type: "text/csv" });
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

function csvEscape(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
