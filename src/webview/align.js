// Pure diff-alignment model. Zero vscode/webview/DOM dependencies — plain
// data in, plain data out — so it can be imported by the webview bundle
// (Step 3) and by node-based unit tests (Step 7) unchanged.
import { diffLines } from "diff";
import { charDiff } from "./charDiff.js";

/**
 * @typedef {{ no: number, text: string }} Cell
 * A single side's line: its 1-based line number and text content.
 *
 * @typedef {{ left: Cell | null, right: Cell | null, type: RowType, leftSegs?: import("./charDiff.js").Seg[], rightSegs?: import("./charDiff.js").Seg[] }} Row
 * `leftSegs`/`rightSegs` (Step 8) are the character-level diff of
 * `left.text` vs `right.text`, attached only on "change" rows (the only
 * row type where both sides have real, potentially-differing text to
 * compare char-by-char). Context/del/add rows never get segments — a
 * context row's two sides are byte-identical by construction, and a
 * del/add row has nothing on the other side to diff against.
 *
 * @typedef {"context" | "del" | "add" | "change"} RowType
 * Row-type encoding:
 *   - "context": unchanged line, present unchanged on both sides. Both
 *     `left` and `right` are non-null and hold the same text.
 *   - "del": a removed line with no corresponding added line to zip
 *     against (removed block longer than the following added block, or a
 *     removed-only part). `left` is non-null, `right` is null (pad).
 *   - "add": an added line with no corresponding removed line to zip
 *     against (added block longer than the preceding removed block, or an
 *     added-only part). `right` is non-null, `left` is null (pad).
 *   - "change": a removed line zipped row-by-row against an added line
 *     from a directly-following added block (the classic "one line
 *     changed" case — del left, add right, both non-null). A run of removed
 *     lines followed by a run of added lines zips pairwise up to the
 *     shorter run's length; the longer run's remainder becomes "del" or
 *     "add" rows (see above) padded with null on the other side.
 *
 * A `null` cell is a pad — nothing to show for that side on that row.
 */

/**
 * Splits a diff-part's text into lines without producing a phantom empty
 * trailing line. jsdiff parts end with "\n" for every part except
 * possibly the very last part of the input; splitting `"a\nb\n"` naively
 * on "\n" yields `["a", "b", ""]`. Stripping one trailing newline first
 * (if present) fixes that: `"a\nb"` → `["a", "b"]`. A part with no
 * trailing newline (the final part of an input lacking one) is left
 * untouched. An empty string part (possible for a fully-empty side) yields
 * no lines at all — `[]`, not `[""]`.
 *
 * Only `"\n"` is treated as the line separator here — a trailing `"\r"` is
 * deliberately NOT stripped (Step 8). `diffLines` splits its input on
 * `"\n"` too, so a CRLF ("\r\n") line keeps its `"\r"` as the very last
 * character of the resulting line text. That in turn makes a CRLF-vs-LF
 * difference ("a\r\n" vs "a\n") a real one-character difference once it
 * reaches charDiff.js (a trailing `\r` on one side, none on the other),
 * which the whitespace classifier then renders as a highlighted CR marker
 * — line-ending differences fall out of the existing char-diff machinery
 * for free, with no EOL special-casing needed.
 *
 * Known limitation: this only helps when the input is split into multiple
 * lines by `\n` in the first place. A lone-CR (classic Mac, pre-OS X)
 * line ending has no `\n` at all, so `diffLines` (which splits on `\n`)
 * sees the whole file as a single line; its embedded `\r` characters still
 * render as CR markers via the char-diff/whitespace path, just not as
 * separate rows the way a CRLF or LF file would be.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitPartLines(text) {
  if (text === "") {
    return [];
  }
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n");
}

/**
 * Computes the aligned side-by-side row model for two texts, using
 * jsdiff's `diffLines` (Myers/LCS line diff — the same algorithm family
 * `git diff` uses).
 *
 * @param {string} oldText
 * @param {string} newText
 * @returns {{ rows: Row[], stats: { added: number, removed: number } }}
 */
export function alignDiff(oldText, newText) {
  const parts = diffLines(oldText, newText);

  const rows = [];
  let leftNo = 1;
  let rightNo = 1;
  let added = 0;
  let removed = 0;

  let i = 0;
  while (i < parts.length) {
    const part = parts[i];

    if (!part.added && !part.removed) {
      // Unchanged part: paired context rows, both numbers advance.
      for (const text of splitPartLines(part.value)) {
        rows.push({
          left: { no: leftNo++, text },
          right: { no: rightNo++, text },
          type: "context",
        });
      }
      i++;
      continue;
    }

    if (part.removed) {
      const removedLines = splitPartLines(part.value);
      removed += removedLines.length;

      // A removed part may be immediately followed by an added part —
      // jsdiff emits removed-then-added (never the reverse) for a
      // replacement. Zip them row-by-row.
      const next = parts[i + 1];
      const addedLines =
        next && next.added ? splitPartLines(next.value) : [];
      if (next && next.added) {
        added += addedLines.length;
      }

      const zipLength = Math.min(removedLines.length, addedLines.length);
      for (let j = 0; j < zipLength; j++) {
        const leftText = removedLines[j];
        const rightText = addedLines[j];
        const segs = charDiff(leftText, rightText);
        rows.push({
          left: { no: leftNo++, text: leftText },
          right: { no: rightNo++, text: rightText },
          type: "change",
          leftSegs: segs.left,
          rightSegs: segs.right,
        });
      }
      for (let j = zipLength; j < removedLines.length; j++) {
        rows.push({
          left: { no: leftNo++, text: removedLines[j] },
          right: null,
          type: "del",
        });
      }
      for (let j = zipLength; j < addedLines.length; j++) {
        rows.push({
          left: null,
          right: { no: rightNo++, text: addedLines[j] },
          type: "add",
        });
      }

      i += next && next.added ? 2 : 1;
      continue;
    }

    // Added part with no preceding removed part (added-only run).
    const addedLines = splitPartLines(part.value);
    added += addedLines.length;
    for (const text of addedLines) {
      rows.push({ left: null, right: { no: rightNo++, text }, type: "add" });
    }
    i++;
  }

  return { rows, stats: { added, removed } };
}
