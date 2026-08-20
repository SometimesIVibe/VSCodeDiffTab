import * as assert from "assert";
import { charDiff } from "../webview/charDiff";

// Built via String.fromCharCode, never a literal space-like character in
// this source file, so there is zero ambiguity about which of these two
// visually-identical characters is which.
const SPACE = String.fromCharCode(0x0020);
const NBSP = String.fromCharCode(0x00a0);

suite("charDiff", () => {
  test("identical texts produce a single unchanged segment on each side", () => {
    const { left, right } = charDiff("abc", "abc");
    assert.deepStrictEqual(left, [{ text: "abc", changed: false }]);
    assert.deepStrictEqual(right, [{ text: "abc", changed: false }]);
  });

  test("single char change: only the differing character is marked changed", () => {
    // "cat" -> "cot": common "c", removed "a"/added "o", common "t".
    const { left, right } = charDiff("cat", "cot");
    assert.deepStrictEqual(left, [
      { text: "c", changed: false },
      { text: "a", changed: true },
      { text: "t", changed: false },
    ]);
    assert.deepStrictEqual(right, [
      { text: "c", changed: false },
      { text: "o", changed: true },
      { text: "t", changed: false },
    ]);
  });

  test("whitespace-only change: a plain space vs NBSP are the only changed segments", () => {
    // Visually identical, but U+0020 (plain space) on the left vs U+00A0
    // (NBSP) on the right at the same position: exactly the case charDiff
    // exists to catch precisely.
    const leftText = "a" + SPACE + "b";
    const rightText = "a" + NBSP + "b";
    const { left, right } = charDiff(leftText, rightText);
    assert.deepStrictEqual(left, [
      { text: "a", changed: false },
      { text: SPACE, changed: true },
      { text: "b", changed: false },
    ]);
    assert.deepStrictEqual(right, [
      { text: "a", changed: false },
      { text: NBSP, changed: true },
      { text: "b", changed: false },
    ]);
  });

  test("insert run: added characters appear only on the right, as one changed segment", () => {
    const { left, right } = charDiff("ac", "abc");
    assert.deepStrictEqual(left, [
      { text: "a", changed: false },
      { text: "c", changed: false },
    ]);
    assert.deepStrictEqual(right, [
      { text: "a", changed: false },
      { text: "b", changed: true },
      { text: "c", changed: false },
    ]);
  });

  test("delete run: removed characters appear only on the left, as one changed segment", () => {
    const { left, right } = charDiff("abc", "ac");
    assert.deepStrictEqual(left, [
      { text: "a", changed: false },
      { text: "b", changed: true },
      { text: "c", changed: false },
    ]);
    assert.deepStrictEqual(right, [
      { text: "a", changed: false },
      { text: "c", changed: false },
    ]);
  });

  test("empty left side: the whole right side is one changed segment, left is empty", () => {
    const { left, right } = charDiff("", "abc");
    assert.deepStrictEqual(left, []);
    assert.deepStrictEqual(right, [{ text: "abc", changed: true }]);
  });

  test("empty right side: the whole left side is one changed segment, right is empty", () => {
    const { left, right } = charDiff("abc", "");
    assert.deepStrictEqual(left, [{ text: "abc", changed: true }]);
    assert.deepStrictEqual(right, []);
  });
});
