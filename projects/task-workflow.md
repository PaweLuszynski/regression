# Local Task Workflow

This repo uses a metadata-first Obsidian task workflow.

## Layout

- Issue notes live permanently in `projects/issues/`
- The Kanban board lives in `projects/boards/project-kanban.md`
- The reusable note template lives in `projects/templates/issue-template.md`

## Source Of Truth

Each task note stores its workflow state in YAML frontmatter:

- `status: backlog`
- `status: in-progress`
- `status: done`

The Kanban board is a generated projection of that metadata. Tasks do not move between folders when status changes.

## Obsidian Kanban Compatibility

The board uses the conservative markdown structure supported by the Obsidian Kanban plugin:

- frontmatter with `kanban-plugin: board`
- `##` headings for lanes
- markdown task list cards under each lane
- a trailing `%% kanban:settings` block with `{"kanban-plugin":"board"}`

Cards are note links to permanent issue notes, for example:

```md
- [ ] [[projects/issues/TASK-0001-some-task|TASK-0001 Some task]]
```

This keeps links stable and makes board rebuilds deterministic.

## Agent Commands

Create a task:

```bash
node scripts/task-workflow.js create --title "Add smoke test"
```

Move a task to in progress:

```bash
node scripts/task-workflow.js status TASK-0001 in-progress
```

Move a task to done:

```bash
node scripts/task-workflow.js status TASK-0001 done
```

Rebuild the board from note metadata:

```bash
node scripts/task-workflow.js rebuild
```

## Manual Editing

- It is safe to edit task note content manually.
- If you manually change a task note's frontmatter `status`, run `node scripts/task-workflow.js rebuild`.
- Do not move issue files between folders to represent status.
- Keep issue note filenames stable after creation unless you intentionally update links elsewhere.
