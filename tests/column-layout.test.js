import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

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
  assert.ok(
    cssSelectorHasDeclaration(".case-column-resizer:focus-visible", /outline:\s*2px solid var\(--accent\)/),
    "Expected case column resizers to have a visible keyboard focus outline"
  );
});

test("step table keeps utility columns compact while preserving readable text wrapping", () => {
  assert.match(cssRule(".steps-table"), /table-layout:\s*fixed/);
  assert.match(cssRule(".steps-table"), /min-width:\s*680px/);
  assert.match(cssRule(".steps-col-step"), /width:\s*34%/);
  assert.match(cssRule(".steps-col-status"), /width:\s*170px/);
  assert.match(cssRule(".steps-table td.step-status-cell"), /padding-right:\s*16px/);
  assert.match(cssRule(".steps-table td"), /word-break:\s*normal/);
  assert.match(cssRule(".steps-table td"), /overflow-wrap:\s*break-word/);
  assert.match(cssRule(".step-status-editor select"), /min-width:\s*140px/);
});

test("step table renders extra step metadata inline instead of a dedicated More column", () => {
  assert.doesNotMatch(appSource, /steps-col-more/);
  assert.doesNotMatch(appSource, /textElement\("th", "More"\)/);
  assert.doesNotMatch(styles, /\.steps-col-more\b/);
  assert.match(appSource, /step-extra-inline/);
});

test("step table hides placeholder step extras while preserving meaningful metadata", () => {
  assert.match(appSource, /function isMeaningfulStepExtra/);
  assert.ok(
    appSource.includes('replace(/[\\s\\d.,;:()[\\]{}_-]+/g, "")'),
    "Expected step extra filtering to remove numeric and punctuation placeholders"
  );
  assert.match(appSource, /\.filter\(\(\[, value\]\) => isMeaningfulStepExtra\(value\)\)/);
});

function cssRule(selector) {
  const escapedSelector = escapeRegExp(selector);
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `Expected CSS rule for ${selector}`);
  return match[1];
}

function cssSelectorHasDeclaration(selector, declarationPattern) {
  const escapedSelector = escapeRegExp(selector);
  const rulePattern = new RegExp(`([^{}]*${escapedSelector}[^{}]*)\\{([\\s\\S]*?)\\}`, "gm");
  for (const match of styles.matchAll(rulePattern)) {
    if (declarationPattern.test(match[2])) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
