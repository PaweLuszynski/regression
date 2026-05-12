import path from "node:path";
import process from "node:process";
import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { pathToFileURL } from "node:url";

const STATUS_ORDER = ["backlog", "in-progress", "review", "done"];
const STATUS_TO_COLUMN = {
  backlog: "Backlog",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done"
};

function getWorkflowPaths(repoRoot) {
  const projectsDir = path.join(repoRoot, "projects");
  return {
    projectsDir,
    issuesDir: path.join(projectsDir, "issues"),
    boardsDir: path.join(projectsDir, "boards"),
    templatesDir: path.join(projectsDir, "templates"),
    boardFile: path.join(projectsDir, "boards", "project-kanban.md")
  };
}

async function ensureWorkflowLayout(repoRoot) {
  const paths = getWorkflowPaths(repoRoot);
  await mkdir(paths.issuesDir, { recursive: true });
  await mkdir(paths.boardsDir, { recursive: true });
  await mkdir(paths.templatesDir, { recursive: true });
  return paths;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "task";
}

function escapeYamlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeStatus(status) {
  if (!STATUS_ORDER.includes(status)) {
    throw new Error(`Unsupported status: ${status}`);
  }
  return status;
}

function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) {
    throw new Error("Task note is missing YAML frontmatter");
  }

  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    throw new Error("Task note frontmatter is not closed");
  }

  const frontmatterText = content.slice(4, endIndex);
  const data = {};
  let activeListKey = null;

  for (const line of frontmatterText.split("\n")) {
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && activeListKey) {
      data[activeListKey].push(stripYamlValue(listMatch[1]));
      continue;
    }

    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!fieldMatch) {
      activeListKey = null;
      continue;
    }

    const [, key, rawValue] = fieldMatch;
    const trimmedValue = rawValue.trim();

    if (trimmedValue === "") {
      data[key] = [];
      activeListKey = key;
      continue;
    }

    data[key] = stripYamlValue(trimmedValue);
    activeListKey = null;
  }

  return {
    data,
    body: content.slice(endIndex + "\n---\n".length)
  };
}

function stripYamlValue(value) {
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function renderTaskFrontmatter(task) {
  const tags = Array.isArray(task.tags) && task.tags.length > 0 ? task.tags : ["project"];
  return `---
id: ${task.id}
title: "${escapeYamlString(task.title)}"
status: ${task.status}
priority: ${task.priority}
type: ${task.type}
created: ${task.created}
updated: ${task.updated}
tags:
${tags.map((tag) => `  - ${tag}`).join("\n")}
`;
}

function renderTaskNote(task, body = defaultTaskBody(task.title)) {
  return `${renderTaskFrontmatter(task)}---\n\n${body}`;
}

function defaultTaskBody(title) {
  return `# ${title}

## Summary

## Acceptance Criteria

- [ ]

## Notes

## Links
`;
}

function taskNumberFromId(id) {
  const match = String(id).match(/^TASK-(\d{4})$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

async function readTaskNotes(repoRoot) {
  const { issuesDir } = await ensureWorkflowLayout(repoRoot);
  const entries = await readdir(issuesDir, { withFileTypes: true });
  const tasks = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(issuesDir, entry.name);
    const content = await readFile(filePath, "utf8");
    const { data } = parseFrontmatter(content);
    const id = data.id;
    if (!id) {
      continue;
    }
    tasks.push({
      id,
      title: data.title || id,
      status: normalizeStatus(data.status || "backlog"),
      priority: data.priority || "medium",
      type: data.type || "task",
      created: data.created || "",
      updated: data.updated || "",
      tags: Array.isArray(data.tags) ? data.tags : [],
      filePath
    });
  }

  tasks.sort((left, right) => taskNumberFromId(left.id) - taskNumberFromId(right.id));
  return tasks;
}

function renderBoard(tasks) {
  const grouped = {
    backlog: [],
    "in-progress": [],
    review: [],
    done: []
  };

  for (const task of tasks) {
    grouped[task.status].push(task);
  }

  const sections = STATUS_ORDER.map((status) => {
    const cards = grouped[status]
      .map((task) => {
        const noteName = path.basename(task.filePath, ".md");
        const checkbox = status === "done" ? "x" : " ";
        return `- [${checkbox}] [[projects/issues/${noteName}|${task.id} ${task.title}]]`;
      })
      .join("\n");
    return `## ${STATUS_TO_COLUMN[status]}\n\n${cards}`;
  });

  return `---
kanban-plugin: board
---

${sections.join("\n\n")}

%% kanban:settings
{"kanban-plugin":"board"}
%%
`;
}

async function nextTaskId(repoRoot) {
  const tasks = await readTaskNotes(repoRoot);
  const maxNumber = tasks.reduce((currentMax, task) => {
    return Math.max(currentMax, taskNumberFromId(task.id));
  }, 0);
  return `TASK-${String(maxNumber + 1).padStart(4, "0")}`;
}

export async function rebuildBoard(repoRoot = process.cwd()) {
  const { boardFile } = await ensureWorkflowLayout(repoRoot);
  const tasks = await readTaskNotes(repoRoot);
  const board = renderBoard(tasks);
  await writeFile(boardFile, board, "utf8");
  return board;
}

export async function createTask(repoRoot = process.cwd(), title, options = {}) {
  if (!title || !String(title).trim()) {
    throw new Error("Task title is required");
  }

  const now = options.now || new Date().toISOString();
  const { issuesDir } = await ensureWorkflowLayout(repoRoot);
  const id = await nextTaskId(repoRoot);
  const slug = slugify(title);
  const filePath = path.join(issuesDir, `${id}-${slug}.md`);
  const task = {
    id,
    title: String(title).trim(),
    status: "backlog",
    priority: "medium",
    type: "task",
    created: now,
    updated: now,
    tags: ["project"],
    filePath
  };

  await writeFile(filePath, renderTaskNote(task), "utf8");
  await rebuildBoard(repoRoot);
  return { task };
}

async function findTaskByIdentifier(repoRoot, identifier) {
  const tasks = await readTaskNotes(repoRoot);
  const normalized = String(identifier).replace(/\.md$/i, "");
  const task = tasks.find((candidate) => {
    return (
      candidate.id === normalized ||
      path.basename(candidate.filePath, ".md") === normalized
    );
  });

  if (!task) {
    throw new Error(`Task not found: ${identifier}`);
  }

  return task;
}

export async function updateTaskStatus(repoRoot = process.cwd(), identifier, status, options = {}) {
  const nextStatus = normalizeStatus(status);
  const now = options.now || new Date().toISOString();
  const task = await findTaskByIdentifier(repoRoot, identifier);
  const content = await readFile(task.filePath, "utf8");
  const { data, body } = parseFrontmatter(content);

  const updatedTask = {
    ...task,
    title: data.title || task.title,
    priority: data.priority || task.priority,
    type: data.type || task.type,
    created: data.created || task.created,
    updated: now,
    status: nextStatus,
    tags: Array.isArray(data.tags) ? data.tags : task.tags
  };

  await writeFile(task.filePath, renderTaskNote(updatedTask, body), "utf8");
  await rebuildBoard(repoRoot);
  return { task: updatedTask };
}

function parseCommandLine(argv) {
  const [command, ...rest] = argv;
  return { command, rest };
}

function readTitleArgument(args) {
  const titleFlagIndex = args.indexOf("--title");
  if (titleFlagIndex === -1 || titleFlagIndex === args.length - 1) {
    throw new Error("Usage: create --title \"Task title\"");
  }
  return args[titleFlagIndex + 1];
}

async function runCli() {
  const { command, rest } = parseCommandLine(process.argv.slice(2));
  const repoRoot = process.cwd();

  if (command === "create") {
    const title = readTitleArgument(rest);
    const result = await createTask(repoRoot, title);
    process.stdout.write(`${result.task.id} ${result.task.filePath}\n`);
    return;
  }

  if (command === "status") {
    if (rest.length < 2) {
      throw new Error("Usage: status TASK-0001 backlog|in-progress|review|done");
    }
    const [identifier, status] = rest;
    const result = await updateTaskStatus(repoRoot, identifier, status);
    process.stdout.write(`${result.task.id} ${result.task.status}\n`);
    return;
  }

  if (command === "rebuild") {
    const board = await rebuildBoard(repoRoot);
    process.stdout.write(`Rebuilt ${getWorkflowPaths(repoRoot).boardFile}\n`);
    process.stdout.write(`${board.length} bytes\n`);
    return;
  }

  throw new Error("Usage: node scripts/task-workflow.js <create|status|rebuild>");
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
