# Repository Rules

## Project purpose

This project is a local-only TestRail XLSX run viewer/editor.

The app should let the user:

- import a TestRail XLSX run export
- view test cases grouped by section/folder
- continue execution locally
- update local statuses and notes
- persist progress locally
- export updated results

This is not a TestRail API client.

## Safety and scope rules

- Do not add TestRail API integration unless explicitly requested.
- Do not add login/auth unless explicitly requested.
- Do not add cloud sync unless explicitly requested.
- Do not add external paid services or API-key-based features.
- Do not upload imported XLSX files or local progress anywhere.
- Keep all imported run data and progress local.
- Do not hardcode private file paths, real workbook names, user names, or machine-specific paths in product code or docs.
- Do not mention local reference XLSX file names/paths in source comments, UI, README, or docs.
- Do not remove raw imported data from the model/export unless explicitly requested.
- Preserve original imported status separately from local/current status.
- Local edits must not overwrite imported fields such as original status, imported comments, defects, tested by, or tested on.

## Implementation rules

- Keep changes small and focused.
- Do not overengineer.
- Prefer simple local persistence:
  - browser app: localStorage or IndexedDB
  - Node/local app: JSON file
- Avoid heavy dependencies unless clearly justified.
- Do not refactor unrelated code during feature work.
- Before editing, inspect the existing structure and reuse existing helpers/components where possible.

## Code review rules

- Prevent overengineering and "AI slop" by strictly sticking to requested features. Keep the codebase clean, simple, and direct.
- Every change must be done on a new branch.
- After a change is confirmed to work properly, it should be merged into `main`.

## XLSX parsing rules

- Treat XLSX exports as variable and imperfect.
- Do not assume all TestRail exports have the exact same columns.
- Handle duplicate headers safely.
- Preserve unknown columns in `rawRow`.
- Keep original row data available for export/debugging.
- Support missing optional columns gracefully.
- Show clear validation errors for empty/bad workbooks.
- Render imported HTML-like cell content as safe readable text, not executable HTML.

## Test case status rules

Use local/current status for execution UI. These statuses must follow the contents of the file exported from TestRail because every project can have different statuses, and agents must adjust the project accordingly.

Original imported `Status` must stay unchanged.

Changing current status must update:

- details view
- grouped test list
- work tree colors/counts
- progress report
- local persistence
- exported JSON

## UI/UX rules

- Optimize the app for fast manual test execution.
- Keep the middle test case list minimal:
  - checkbox
  - ID
  - Title
  - Current Status
- Use section/folder data to group test cases.
- Do not show unnecessary metadata columns in the main list.
- Full metadata belongs in the detail panel.
- Long text should wrap by words.
- Avoid character-by-character wrapping.
- IDs, statuses, dates, and badges should remain readable.
- Resizable panels/columns should persist locally.
- Checkbox selection must not scroll the list to the top.
- Checkbox selection should not trigger row-open behavior.
- `Pass & Next` should follow the current visible filtered/grouped order.

## Data/export rules

Exported JSON should include:

- run metadata
- original columns
- all test cases
- raw imported row
- original status
- current/local status
- local notes
- local defects/evidence
- updatedAt

Do not silently discard imported data.

## Testing rules

When changing parser logic, add/update tests for:

- duplicate headers
- key TestRail fields
- status initialization
- bad/empty workbook handling
- step parsing

When changing execution logic, add/update tests for:

- current status updates
- original status preservation
- bulk updates
- next visible test case order

When changing UI helpers, add/update tests where practical for:

- grouping by section
- visible order
- status stats
- status color mapping

Before reporting completion, run available:

- tests
- build
- lint, if configured

## Reporting rules

After each task, report:

- what changed
- how to test it
- what commands were run
- whether tests/build/lint passed
- confirmation that no private workbook path/name was hardcoded
