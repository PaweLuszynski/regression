export function summarizeImportedRun(run) {
  return {
    id: run?.id || "",
    runName: run?.runName || "",
    runId: run?.runId || "",
    sheetName: run?.sheetName || "",
    caseCount: Array.isArray(run?.cases) ? run.cases.length : 0
  };
}

export function classifyXlsxImportResponse(responseStatus, payload, options = {}) {
  const normalizedOptions = options || {};

  if (responseStatus === 409 && payload?.worksheetSelectionRequired) {
    return {
      kind: "prompt",
      prompt: {
        type: "worksheet-selection",
        availableSheets: payload.availableSheets || [],
        selectedSheet: payload.availableSheets?.[0] || "",
        message: payload.message || "Choose one worksheet to import."
      }
    };
  }

  if (responseStatus === 409 && payload?.decisionRequired && payload?.reason === "existing-progress") {
    return {
      kind: "prompt",
      prompt: {
        type: "existing-progress",
        importedRunSummary: payload.importedRunSummary || summarizeImportedRun(payload.run),
        message: payload.message || "Saved local progress already exists for this run.",
        confirmReplace: false
      }
    };
  }

  if (responseStatus >= 200 && responseStatus < 300 && payload?.existingProgressFound && !normalizedOptions.existingAction) {
    return {
      kind: "prompt",
      prompt: {
        type: "existing-progress",
        importedRunSummary: payload.importedRunSummary || summarizeImportedRun(payload.run),
        message: "Saved local progress already exists for this run. Choose Resume to keep it or Replace to overwrite it with this import.",
        confirmReplace: false
      },
      fallbackDetected: true
    };
  }

  if (responseStatus < 200 || responseStatus >= 300) {
    return {
      kind: "error",
      error: payload?.error || "Import failed."
    };
  }

  return {
    kind: "success",
    payload
  };
}

export function classifyProgressImportResponse(responseStatus, payload, importType = "progress") {
  const normalizedType = String(importType || "progress").toLowerCase();

  if (responseStatus === 409 && payload?.decisionRequired && payload?.reason === "replace-progress") {
    return {
      kind: "prompt",
      prompt: {
        type: "progress-replace",
        importType: normalizedType,
        importedRunSummary: payload.importedRunSummary || summarizeImportedRun(payload.run),
        message: payload.message || "Saved local progress already exists for this run. Confirm before replacing it.",
        confirmReplace: false
      }
    };
  }

  if (responseStatus < 200 || responseStatus >= 300) {
    return {
      kind: "error",
      error: payload?.error || `${normalizedType.toUpperCase()} restore failed.`
    };
  }

  return {
    kind: "success",
    payload
  };
}

export function shouldSkipRecoveryForProgressImport(payload) {
  return Boolean(payload?.run?.id && ["csv", "json"].includes(String(payload.importType || "").toLowerCase()));
}
