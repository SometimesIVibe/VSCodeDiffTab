// Renders the aligned Row[] model (src/webview/align.js) into #result-area
// as a CSS grid "table": one flat set of grid children (num/text/gutter/
// num/text per row) sharing ONE set of grid-template-columns and ONE
// scroll container (.result-area, styled in media/main.css) — rows can
// never scroll out of alignment because there is only one scrollbar and
// only one grid, not two independently-scrolling panes.
//
// `.mjs` (not `.js`, unlike the sibling align.js) is deliberate: this file
// exports pure, DOM-free helpers (`cellClasses`, `formatStats`) that a
// plain `node` script needs to import directly for verification, without
// esbuild in between. Node always treats `.mjs` as an ES module regardless
// of the nearest package.json's "type" field (which is unset ⇒
// "commonjs" here), so `import` from a throwaway Node script works
// unmodified. esbuild bundles `.mjs` into the webview IIFE exactly like
// `.js` — this split costs nothing at build time.

import { splitForMarkers } from "./whitespace.js";

/**
 * @typedef {import("./align.js").Row} Row
 * @typedef {import("./charDiff.js").Seg} Seg
 */

/**
 * Pure row → per-side cell styling decision. Zero DOM dependencies, so it
 * is the unit under test in the scratchpad verification script (four row
 * types: context, del, add, change).
 *
 * - `pad: true` — the side is null on this row (nothing to render); gets
 *   the dimmed/hatched pad background.
 * - `pad: false, highlight: true` — a removed line (left, from "del" or
 *   "change" rows) or an added line (right, from "add" or "change" rows);
 *   gets the removed/inserted background.
 * - `pad: false, highlight: false` — plain context line.
 *
 * @param {Row} row
 * @returns {{ left: { pad: boolean, highlight: boolean }, right: { pad: boolean, highlight: boolean } }}
 */
export function cellClasses(row) {
  return {
    left:
      row.left === null
        ? { pad: true, highlight: false }
        : { pad: false, highlight: row.type === "del" || row.type === "change" },
    right:
      row.right === null
        ? { pad: true, highlight: false }
        : { pad: false, highlight: row.type === "add" || row.type === "change" },
  };
}

/**
 * Formats the stats line shown above the table: "+A −R in N rows".
 * Uses a proper minus sign (U+2212), not a hyphen.
 *
 * @param {{ added: number, removed: number }} stats
 * @param {number} rowCount
 * @returns {string}
 */
export function formatStats(stats, rowCount) {
  return `+${stats.added} −${stats.removed} in ${rowCount} row${rowCount === 1 ? "" : "s"}`;
}

// Rows above this count render in requestAnimationFrame-batched chunks
// instead of one blocking loop, so the UI thread stays responsive on huge
// diffs.
const LARGE_ROW_THRESHOLD = 20000;
const CHUNK_SIZE = 2000;

/**
 * Replaces `container`'s content with the stats line + result table for
 * `rows`. All user text goes in via `textContent`/property assignment —
 * never innerHTML.
 *
 * @param {HTMLElement} container
 * @param {Row[]} rows
 * @param {{ added: number, removed: number }} stats
 */
export function renderDiff(container, rows, stats) {
  container.textContent = "";

  const wrapper = document.createElement("div");
  wrapper.className = "result-wrapper";

  const statsEl = document.createElement("div");
  statsEl.className = "result-stats";
  statsEl.textContent = formatStats(stats, rows.length);
  wrapper.appendChild(statsEl);

  const table = document.createElement("div");
  table.className = "result-table";
  wrapper.appendChild(table);

  container.appendChild(wrapper);

  if (rows.length === 0) {
    return;
  }

  if (rows.length > LARGE_ROW_THRESHOLD) {
    renderChunk(table, rows, 0);
  } else {
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      appendRow(fragment, row);
    }
    table.appendChild(fragment);
  }
}

/** Appends rows [start, start + CHUNK_SIZE) then yields via rAF for the rest. */
function renderChunk(table, rows, start) {
  const end = Math.min(start + CHUNK_SIZE, rows.length);
  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    appendRow(fragment, rows[i]);
  }
  table.appendChild(fragment);
  if (end < rows.length) {
    requestAnimationFrame(() => renderChunk(table, rows, end));
  }
}

/** Appends one row's five grid cells (num/text/gutter/num/text) to `parent`. */
function appendRow(parent, row) {
  const classes = cellClasses(row);
  parent.appendChild(createNumCell("left", row.left, classes.left));
  parent.appendChild(createTextCell("left", row.left, classes.left, row.leftSegs));
  parent.appendChild(createGutterCell());
  parent.appendChild(createNumCell("right", row.right, classes.right));
  parent.appendChild(createTextCell("right", row.right, classes.right, row.rightSegs));
}

/** @param {"left"|"right"} side @param {{no:number,text:string}|null} cell @param {{pad:boolean,highlight:boolean}} sideClasses */
function createNumCell(side, cell, sideClasses) {
  const el = document.createElement("div");
  el.className = buildClassName("num", side, sideClasses);
  el.textContent = cell === null ? "" : String(cell.no);
  return el;
}

/**
 * @param {"left"|"right"} side
 * @param {{no:number,text:string}|null} cell
 * @param {{pad:boolean,highlight:boolean}} sideClasses
 * @param {Seg[]|undefined} segs this side's character-level diff segments
 *   (only present on "change" rows — see align.js's Row typedef); absent
 *   for context/del/add rows, which render as a single unchanged segment.
 */
function createTextCell(side, cell, sideClasses, segs) {
  const el = document.createElement("div");
  el.className = buildClassName("text", side, sideClasses);
  const text = cell === null ? "" : cell.text;
  appendCellContent(el, text, segs);
  if (text !== "") {
    // Long-line strategy: cells clip with an ellipsis (media/main.css) so
    // one row always stays one visual line and the grid alignment never
    // has to account for wrapped multi-line cells. `title` is the escape
    // hatch to read a truncated line in full — set via property
    // assignment, not innerHTML, so it stays safe for arbitrary user text.
    el.title = text;
  }
  return el;
}

/**
 * Fills a text cell with segment- and whitespace-marker-aware content.
 * `segs` (when present, i.e. a "change" row) is the ordered list of
 * unchanged/changed runs from charDiff.js; a `changed: true` segment is
 * wrapped in a `.char-diff` span so it gets the darker text-background on
 * top of the row's lighter line-background (media/main.css) — VS Code's
 * own line-vs-inline diff look. Absent `segs` (context/del/add rows) falls
 * back to treating the whole cell text as one unchanged segment.
 *
 * Every segment is further split by `splitForMarkers` (whitespace.js) so
 * notable/ambiguous whitespace and control characters render as visible
 * `.ws-marker` spans instead of disappearing into ordinary text — this
 * applies inside AND outside `.char-diff` segments, since an unchanged run
 * can still contain, e.g., a tab.
 *
 * @param {HTMLElement} el
 * @param {string} text
 * @param {Seg[]|undefined} segs
 */
function appendCellContent(el, text, segs) {
  const segments = segs && segs.length > 0 ? segs : [{ text, changed: false }];
  for (const seg of segments) {
    const parts = splitForMarkers(seg.text);
    if (seg.changed) {
      const span = document.createElement("span");
      span.className = "char-diff";
      appendMarkerParts(span, parts);
      el.appendChild(span);
    } else {
      appendMarkerParts(el, parts);
    }
  }
}

/**
 * Appends `splitForMarkers` output (plain text runs + notable-char
 * markers) to `parent`. All text reaches the DOM via `createTextNode`/
 * `textContent` — never innerHTML — so arbitrary user text (including the
 * marker's own glyph, which is always one of our own fixed strings, not
 * user data) stays safe.
 *
 * @param {HTMLElement} parent
 * @param {ReturnType<import("./whitespace.js").splitForMarkers>} parts
 */
function appendMarkerParts(parent, parts) {
  for (const part of parts) {
    if ("marker" in part) {
      const span = document.createElement("span");
      span.className = "ws-marker";
      span.textContent = part.marker.glyph;
      span.title = `${part.marker.name} (U+${part.marker.cp
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")})`;
      parent.appendChild(span);
    } else {
      parent.appendChild(document.createTextNode(part.text));
    }
  }
}

function createGutterCell() {
  const el = document.createElement("div");
  el.className = "cell gutter";
  el.setAttribute("aria-hidden", "true");
  return el;
}

/** @param {"num"|"text"} kind @param {"left"|"right"} side @param {{pad:boolean,highlight:boolean}} sideClasses */
function buildClassName(kind, side, sideClasses) {
  const classes = ["cell", kind, side];
  if (sideClasses.pad) {
    classes.push("pad");
  } else if (sideClasses.highlight) {
    classes.push("highlight");
  }
  return classes.join(" ");
}
