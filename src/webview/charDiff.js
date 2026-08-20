// Pure character-level diff for one changed row's two texts. Zero
// DOM/vscode dependencies — plain data in, plain data out — so it is
// importable both by the webview bundle (Step 8 rendering) and by
// node-based unit tests, exactly like align.js.
import { diffChars } from "diff";

/**
 * @typedef {{ text: string, changed: boolean }} Seg
 * A run of characters that is either unchanged (`changed: false`, shared by
 * both sides) or part of the character-level difference (`changed: true`,
 * present on only one side).
 */

/**
 * Computes the character-level diff between one changed row's left and
 * right text, using jsdiff's `diffChars` (char granularity, not word/line —
 * required so a single differing character, e.g. one space swapped for an
 * NBSP, is caught precisely instead of being absorbed into a larger run).
 *
 * `diffChars` returns a flat list of parts, each either common (neither
 * `added` nor `removed`), removed-only, or added-only — jsdiff never marks
 * a single part as both. Left segments are built from the common + removed
 * parts (i.e. everything that appears in `leftText`); right segments from
 * the common + added parts (everything in `rightText`). Adjacent parts of
 * the same kind are already coalesced by jsdiff, so no further merging is
 * needed here.
 *
 * @param {string} leftText
 * @param {string} rightText
 * @returns {{ left: Seg[], right: Seg[] }}
 */
export function charDiff(leftText, rightText) {
  const parts = diffChars(leftText, rightText);

  /** @type {Seg[]} */
  const left = [];
  /** @type {Seg[]} */
  const right = [];

  for (const part of parts) {
    if (part.added) {
      right.push({ text: part.value, changed: true });
    } else if (part.removed) {
      left.push({ text: part.value, changed: true });
    } else {
      left.push({ text: part.value, changed: false });
      right.push({ text: part.value, changed: false });
    }
  }

  return { left, right };
}
