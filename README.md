# TestRail Local Run Viewer

A local-only viewer/editor for TestRail XLSX test run exports. It is intended for continuing a TestRail run locally without TestRail API access, authentication, external services, paid APIs, or API keys.

## Run the App

```bash
npm start
```

Open `http://127.0.0.1:4173`.

To use a different port:

```bash
PORT=4180 npm start
```

## Import Data

Use the `Import` menu in the top bar:

1. `Import XLSX run`
2. `Import JSON progress`
3. `Import CSV progress`

For XLSX, the app parses the `Worksheet` sheet and displays the imported run.

The parser reads the first row as headers, preserves duplicate headers as normalized keys such as `Steps` and `Steps__2`, and keeps the full original imported row in `rawRow`.

## Restore JSON Progress

Use `Import -> Import JSON progress` to load a JSON progress file previously exported by this app.

If another run is already open, the app asks for confirmation before replacing the current view. Restored JSON progress is saved into the same local progress directory as XLSX imports, then behaves like any other local run: status updates, notes, bulk actions, `Pass & Next`, and JSON export continue to work.

The restore flow validates the JSON shape, preserves unknown fields, keeps `rawRow`, and keeps imported fields such as `originalStatus` separate from local fields such as `currentStatus`.

## Restore CSV Progress

Use `Import -> Import CSV progress` to load a CSV file previously exported by this app.

CSV restore supports lightweight progress recovery: test IDs, case IDs, titles, sections, section hierarchy, original/current statuses, local notes, local defects, local evidence, and update timestamps when those columns exist.

CSV does not include full rich run details. Missing fields such as full raw worksheet content, step structures, preconditions, expected results, and other non-exported metadata are intentionally left empty during CSV restore.

CSV validation includes:

- empty CSV detection
- missing required columns detection (`ID`/`Test ID`, `Title`, and `Current Status`/`Status`)
- malformed quoted CSV detection

## Local Progress

Progress is saved as JSON files under:

```text
data/progress/
```

The stable run key is based on run ID and source file name, for example:

```text
RUNID_source_file_name
```

If a saved progress file already exists for the same run key, importing the same XLSX loads the existing local progress instead of overwriting it.

## Export Results

Use the `Export` menu in the top bar:

- `Export JSON progress`
- `Export CSV progress`

JSON export includes run metadata, original columns, all test cases, original status, current local status, local notes, local defects, local evidence, timestamps, and `rawRow`.

CSV export includes enough fields for lightweight restore: run metadata columns plus `ID`, `Case ID`, `Title`, `Section`, `Section Hierarchy`, `Original Status`, `Current Status`, `Local Notes`, `Local Defects`, `Local Evidence`, and `Updated At`.

## Using the Dashboard

- Use the left `Work Tree` to expand sections and select test cases.
- The middle execution list groups visible test cases by section and shows only selection, ID, title, and current status.
- The donut report and status counters use local `currentStatus` values.
- Status colors update in the tree, table, and detail pane when `currentStatus` changes.
- The detail pane shows structured step rows with `Step` and `Expected Result` side by side when the export provides step columns.
- Drag the separators between `Work Tree`, the test case list, and the details pane to resize the panels.
- Drag the ID, Title, and Status separators in the middle list header to resize those columns.
- Use `Reset layout` to restore default panel and middle-list column widths without changing imported run data or execution progress.
- Use the sticky result buttons at the bottom of the detail pane to quickly set the selected test case status after reviewing steps.
- Use `Pass & Next` to mark the current visible case as passed and move to the next visible case.
- Use row checkboxes and the header checkbox to select cases for bulk status updates.
- Bulk status updates affect local `currentStatus` only and keep the original imported status intact.
- Bulk note append adds timestamped text to `localNotes` without replacing imported comments.

Panel width preferences are saved in browser `localStorage` under:

```text
testrailLocalViewer.panelWidths.v1
```

Middle-list column width preferences are saved in browser `localStorage` under:

```text
testrailLocalViewer.caseListColumns.v1
```

## Test Execution Fields

The imported `Status`, `Comment`, `Defects`, `Tested By`, and `Tested On` values are preserved. Local edits are stored separately:

- `currentStatus`
- `localNotes`
- `localDefects`
- `localEvidence`

Supported current statuses are:

- Untested
- Passed
- In test
- Conditionally Passed
- Failed
- Blocked
- Retest
- Skipped

## Known Limitations

- This is local-only and does not sync back to TestRail.
- There is no TestRail API integration and no login.
- Per-step execution is displayed when present, but per-step status editing is not implemented.
- HTML-like XLSX cell content is converted to readable plain text for display. The original raw cell content remains in `rawRow`.
- The XLSX parser is intentionally small and targets standard `.xlsx` run exports, including shared strings, inline strings, and duplicate headers.

## Development

```bash
npm test
npm run lint
```
