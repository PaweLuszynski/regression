import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("case list header and rows use the same persisted column variables", () => {
  const headerRule = cssRule(".case-list-header");
  const rowRule = cssRule(".case-list-row");
  const expectedColumns = [
    "var(--case-checkbox-col)",
    "var(--case-id-col)",
    "minmax(var(--case-title-col), 1fr)",
    "var(--case-status-col)"
  ];

  for (const column of expectedColumns) {
    assert.match(headerRule, new RegExp(escapeRegExp(column)));
    assert.match(rowRule, new RegExp(escapeRegExp(column)));
  }
});

test("case list readable columns do not wrap character-by-character", () => {
  assert.match(cssRule(".case-list-id"), /white-space:\s*nowrap/);
  assert.match(cssRule(".status-badge"), /white-space:\s*nowrap/);
  assert.match(cssRule(".case-list-title"), /white-space:\s*normal/);
  assert.match(cssRule(".case-list-title"), /word-break:\s*normal/);
  assert.match(cssRule(".case-list-title"), /overflow-wrap:\s*break-word/);
});

test("case list column resizers remain keyboard focusable and visible", () => {
  assert.match(cssRule(".case-column-resizer"), /cursor:\s*col-resize/);
  assert.match(cssRule(".resize-handle:focus-visible,\n.case-column-resizer:focus-visible"), /outline:\s*2px solid var\(--accent\)/);
});

function cssRule(selector) {
  const escapedSelector = escapeRegExp(selector);
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `Expected CSS rule for ${selector}`);
  return match[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
