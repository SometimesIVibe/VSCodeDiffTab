import * as assert from "assert";
import { classifyChar, splitForMarkers } from "../webview/whitespace";

// Every space-like/invisible code point below is built via
// String.fromCharCode / codePointAt, never typed as a literal
// space-like character in this source file, so there's no ambiguity
// about which character is actually under test.
const SPACE = 0x0020;
const NBSP = 0x00a0;
const IDEOGRAPHIC_SPACE = 0x3000;
const ZERO_WIDTH_SPACE = 0x200b;
const TAB = 0x0009;
const CR = 0x000d;
const LF = 0x000a;
const LETTER_A = "a".codePointAt(0)!;

suite("classifyChar", () => {
  test("NBSP is notable", () => {
    assert.deepStrictEqual(classifyChar(NBSP), { glyph: "␣", name: "NO-BREAK SPACE" });
  });

  test("ideographic space is notable", () => {
    assert.deepStrictEqual(classifyChar(IDEOGRAPHIC_SPACE), {
      glyph: "␣",
      name: "IDEOGRAPHIC SPACE",
    });
  });

  test("zero-width space is notable", () => {
    assert.deepStrictEqual(classifyChar(ZERO_WIDTH_SPACE), {
      glyph: "␣",
      name: "ZERO WIDTH SPACE",
    });
  });

  test("carriage return is notable", () => {
    assert.deepStrictEqual(classifyChar(CR), { glyph: "␍", name: "CARRIAGE RETURN" });
  });

  test("tab is notable", () => {
    assert.deepStrictEqual(classifyChar(TAB), { glyph: "→", name: "TAB" });
  });

  test("plain space is NOT notable", () => {
    assert.strictEqual(classifyChar(SPACE), undefined);
  });

  test("newline is NOT notable", () => {
    assert.strictEqual(classifyChar(LF), undefined);
  });

  test("an ordinary letter is NOT notable", () => {
    assert.strictEqual(classifyChar(LETTER_A), undefined);
  });

  // Property-based fallback: characters NOT in the curated NOTABLE map are
  // still detected via their Unicode properties, so the feature isn't
  // limited to the hardcoded list (or frozen at today's Unicode version).
  test("an uncurated invisible format char (BOM / ZERO WIDTH NO-BREAK SPACE, U+FEFF) is still notable", () => {
    const info = classifyChar(0xfeff);
    assert.ok(info, "U+FEFF should be classified as notable via its Unicode Cf property");
    assert.strictEqual(info!.name, "INVISIBLE FORMAT CHARACTER");
  });

  test("an uncurated format char (SOFT HYPHEN, U+00AD) is still notable", () => {
    const info = classifyChar(0x00ad); // SOFT HYPHEN — invisible format char, not in NOTABLE
    assert.ok(info, "U+00AD should be classified via its Unicode Cf property");
    assert.strictEqual(info!.name, "INVISIBLE FORMAT CHARACTER");
  });

  test("an uncurated control char (NUL, U+0000) is notable with a Control Pictures glyph", () => {
    const info = classifyChar(0x0000);
    assert.ok(info, "U+0000 should be classified via its Unicode Cc property");
    assert.strictEqual(info!.name, "CONTROL CHARACTER");
    assert.strictEqual(info!.glyph, "␀", "C0 controls map to the U+2400 Control Pictures block");
  });

  test("a curated code point keeps its exact Unicode name, not the generic fallback", () => {
    assert.strictEqual(classifyChar(0x00a0)!.name, "NO-BREAK SPACE");
  });
});

suite("splitForMarkers", () => {
  test("slices a string with two notable characters into plain/marker/plain/marker/plain", () => {
    // "a" + NBSP + " " + "b" + TAB + "c" -> plain "a", marker(NBSP),
    // plain " b" (plain space is not notable), marker(TAB), plain "c".
    const text =
      "a" +
      String.fromCharCode(NBSP) +
      " " +
      "b" +
      String.fromCharCode(TAB) +
      "c";

    const parts = splitForMarkers(text);

    assert.strictEqual(parts.length, 5);
    assert.deepStrictEqual(parts[0], { text: "a" });
    assert.deepStrictEqual(parts[1], {
      marker: { glyph: "␣", name: "NO-BREAK SPACE", cp: NBSP },
    });
    assert.deepStrictEqual(parts[2], { text: " b" });
    assert.deepStrictEqual(parts[3], {
      marker: { glyph: "→", name: "TAB", cp: TAB },
    });
    assert.deepStrictEqual(parts[4], { text: "c" });
  });

  test("a string with no notable characters is a single plain part", () => {
    const parts = splitForMarkers("hello world");
    assert.deepStrictEqual(parts, [{ text: "hello world" }]);
  });

  test("an empty string produces no parts", () => {
    assert.deepStrictEqual(splitForMarkers(""), []);
  });

  test("a string that is entirely notable characters produces only markers, no empty plain parts", () => {
    const text = String.fromCharCode(TAB) + String.fromCharCode(CR);
    const parts = splitForMarkers(text);
    assert.strictEqual(parts.length, 2);
    assert.ok("marker" in parts[0]);
    assert.ok("marker" in parts[1]);
  });

  test("adjacent identical notable characters each get their own marker entry", () => {
    const text = String.fromCharCode(TAB) + String.fromCharCode(TAB);
    const parts = splitForMarkers(text);
    assert.strictEqual(parts.length, 2);
    assert.deepStrictEqual(parts[0], { marker: { glyph: "→", name: "TAB", cp: TAB } });
    assert.deepStrictEqual(parts[1], { marker: { glyph: "→", name: "TAB", cp: TAB } });
  });
});
