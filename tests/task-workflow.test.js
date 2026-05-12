import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";

import {
  createTask,
  rebuildBoard,
  updateTaskStatus
} from "../scripts/task-workflow.js";

test("createTask creates a note in the permanent issues folder and rebuilds the board", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "regression-task-workflow-"));

  const result = await createTask(repoRoot, "Ship task workflow", {
    now: "2026-05-05T12:00:00.000Z"
  });

  assert.equal(result.task.id, "TASK-0001");
  assert.equal(result.task.status, "backlog");
  assert.match(result.task.filePath, /projects\/issues\/TASK-0001-ship-task-workflow\.md$/);

  const note = await readFile(result.task.filePath, "utf8");
  assert.match(note, /id: TASK-0001/);
  assert.match(note, /title: "Ship task workflow"/);
  assert.match(note, /status: backlog/);

  const board = await readFile(path.join(repoRoot, "projects/boards/project-kanban.md"), "utf8");
  assert.match(board, /^---\nkanban-plugin: board\n---/);
  assert.match(board, /## Backlog\n\n- \[ \] \[\[projects\/issues\/TASK-0001-ship-task-workflow\|TASK-0001 Ship task workflow\]\]/);
  assert.match(board, /%% kanban:settings\n\{"kanban-plugin":"board"\}\n%%/);
});

test("rebuildBoard groups linked cards by status using the plugin-compatible board structure", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "regression-task-workflow-"));
  const issuesDir = path.join(repoRoot, "projects/issues");

  await createTask(repoRoot, "Backlog item", {
    now: "2026-05-05T12:00:00.000Z"
  });
  await createTask(repoRoot, "Done item", {
    now: "2026-05-05T12:05:00.000Z"
  });

  await updateTaskStatus(repoRoot, "TASK-0002", "done", {
    now: "2026-05-05T12:10:00.000Z"
  });

  await writeFile(
    path.join(issuesDir, "TASK-0003-in-progress-item.md"),
    `---
id: TASK-0003
title: "In Progress item"
status: in-progress
priority: medium
type: task
created: 2026-05-05T12:15:00.000Z
updated: 2026-05-05T12:15:00.000Z
tags:
  - project
---

# In Progress item

## Summary

## Acceptance Criteria

- [ ]

## Notes

## Links
`,
    "utf8"
  );

  await writeFile(
    path.join(issuesDir, "TASK-0004-review-item.md"),
    `---
id: TASK-0004
title: "Review item"
status: review
priority: medium
type: task
created: 2026-05-05T12:20:00.000Z
updated: 2026-05-05T12:20:00.000Z
tags:
  - project
---

# Review item

## Summary

Ready for manual verification.

## Acceptance Criteria

- [ ]

## Notes

## Links
`,
    "utf8"
  );

  const board = await rebuildBoard(repoRoot);

  assert.equal(
    board,
    `---
kanban-plugin: board
---

## Backlog

- [ ] [[projects/issues/TASK-0001-backlog-item|TASK-0001 Backlog item]]

## In Progress

- [ ] [[projects/issues/TASK-0003-in-progress-item|TASK-0003 In Progress item]]

## Review

- [ ] [[projects/issues/TASK-0004-review-item|TASK-0004 Review item]]

## Done

- [x] [[projects/issues/TASK-0002-done-item|TASK-0002 Done item]]

%% kanban:settings
{"kanban-plugin":"board"}
%%
`
  );
});

test("updateTaskStatus keeps the note in place, updates frontmatter, and rebuilds the board", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "regression-task-workflow-"));

  const created = await createTask(repoRoot, "Finish docs", {
    now: "2026-05-05T12:00:00.000Z"
  });

  await updateTaskStatus(repoRoot, created.task.id, "review", {
    now: "2026-05-05T13:30:00.000Z"
  });

  const note = await readFile(created.task.filePath, "utf8");
  assert.match(note, /status: review/);
  assert.match(note, /updated: 2026-05-05T13:30:00.000Z/);
  assert.match(note, /# Finish docs/);
  assert.match(note, /## Acceptance Criteria/);

  const board = await readFile(path.join(repoRoot, "projects/boards/project-kanban.md"), "utf8");
  assert.match(board, /## Review\n\n- \[ \] \[\[projects\/issues\/TASK-0001-finish-docs\|TASK-0001 Finish docs\]\]/);
  assert.doesNotMatch(board, /## Backlog\n\n- \[ \] \[\[projects\/issues\/TASK-0001-finish-docs\|TASK-0001 Finish docs\]\]/);
});

test("updateTaskStatus preserves existing issue body content", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "regression-task-workflow-"));
  const created = await createTask(repoRoot, "Preserve body", {
    now: "2026-05-05T12:00:00.000Z"
  });

  await writeFile(
    created.task.filePath,
    `---
id: TASK-0001
title: "Preserve body"
status: backlog
priority: should
type: task
created: 2026-05-05T12:00:00.000Z
updated: 2026-05-05T12:00:00.000Z
tags:
  - project
---

# Preserve body

## Summary

Keep this note body.

## Acceptance Criteria

- [x] Body survives status changes.

## Notes

Do not replace this section.

## Links
`,
    "utf8"
  );

  await updateTaskStatus(repoRoot, created.task.id, "in-progress", {
    now: "2026-05-05T13:00:00.000Z"
  });

  const note = await readFile(created.task.filePath, "utf8");
  assert.match(note, /status: in-progress/);
  assert.match(note, /Keep this note body\./);
  assert.match(note, /Do not replace this section\./);
});

test("updateTaskStatus rejects unsupported statuses", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "regression-task-workflow-"));
  const created = await createTask(repoRoot, "Reject invalid status", {
    now: "2026-05-05T12:00:00.000Z"
  });

  await assert.rejects(
    () => updateTaskStatus(repoRoot, created.task.id, "qa-ready"),
    /Unsupported status: qa-ready/
  );
});
