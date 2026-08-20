import * as assert from "assert";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { alignDiff } from "../webview/align";

/**
 * `render.mjs` is a genuine ES module (`.mjs` forces ESM under Node
 * regardless of this project's CommonJS `package.json` "type"). A plain
 * `import("../../src/webview/render.mjs")` would look like the fix, but
 * TypeScript compiling to `"module": "commonjs"` rewrites *any*
 * statically-visible `import()` into `Promise.resolve().then(() =>
 * require(...))` — which still throws `ERR_REQUIRE_ESM` at runtime. Routing
 * the call through `new Function(...)` hides the `import()` from
 * TypeScript's transform entirely (it only sees a string literal), so the
 * real, native dynamic `import()` reaches Node at runtime — the standard
 * CJS-calls-ESM interop trick. The path is resolved to an absolute
 * `file://` URL via `__dirname` first so it doesn't depend on
 * import()'s ambiguous base-URL behavior when invoked this way.
 */
const importESM = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<{
  cellClasses: (row: {
    left: { no: number; text: string } | null;
    right: { no: number; text: string } | null;
    type: "context" | "del" | "add" | "change";
  }) => {
    left: { pad: boolean; highlight: boolean };
    right: { pad: boolean; highlight: boolean };
  };
}>;

let cellClasses: Awaited<ReturnType<typeof importESM>>["cellClasses"];

suite("alignDiff", () => {
  test("identical texts produce all-context rows with matching line numbers", () => {
    const text = "a\nb\nc\n";
    const { rows, stats } = alignDiff(text, text);

    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(stats, { added: 0, removed: 0 });
    for (const row of rows) {
      assert.strictEqual(row.type, "context");
      assert.ok(row.left && row.right);
      assert.strictEqual(row.left!.text, row.right!.text);
      assert.strictEqual(row.left!.no, row.right!.no);
    }
    assert.deepStrictEqual(rows.map((r) => r.left!.text), ["a", "b", "c"]);
  });

  test("both empty texts produce no rows", () => {
    const { rows, stats } = alignDiff("", "");
    assert.deepStrictEqual(rows, []);
    assert.deepStrictEqual(stats, { added: 0, removed: 0 });
  });

  test("add-only: empty old text, non-empty new text", () => {
    const { rows, stats } = alignDiff("", "x\ny\n");

    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(stats, { added: 2, removed: 0 });
    for (const row of rows) {
      assert.strictEqual(row.type, "add");
      assert.strictEqual(row.left, null);
    }
    assert.deepStrictEqual(
      rows.map((r) => [r.right!.no, r.right!.text]),
      [
        [1, "x"],
        [2, "y"],
      ]
    );
  });

  test("del-only: non-empty old text, empty new text", () => {
    const { rows, stats } = alignDiff("x\ny\n", "");

    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(stats, { added: 0, removed: 2 });
    for (const row of rows) {
      assert.strictEqual(row.type, "del");
      assert.strictEqual(row.right, null);
    }
    assert.deepStrictEqual(
      rows.map((r) => [r.left!.no, r.left!.text]),
      [
        [1, "x"],
        [2, "y"],
      ]
    );
  });

  test("equal-length replace zips row-by-row with no pad rows", () => {
    const { rows, stats } = alignDiff("a\nb\n", "x\ny\n");

    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(stats, { added: 2, removed: 2 });
    for (const row of rows) {
      assert.strictEqual(row.type, "change");
      assert.ok(row.left && row.right);
    }
    assert.deepStrictEqual(
      rows.map((r) => [r.left!.text, r.right!.text]),
      [
        ["a", "x"],
        ["b", "y"],
      ]
    );
    // Both sides number independently starting at 1.
    assert.deepStrictEqual(rows.map((r) => r.left!.no), [1, 2]);
    assert.deepStrictEqual(rows.map((r) => r.right!.no), [1, 2]);
  });

  test("unequal replace: removed block longer — pads the right side with del rows", () => {
    const { rows, stats } = alignDiff("a\nb\nc\n", "x\n");

    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(stats, { added: 1, removed: 3 });

    assert.strictEqual(rows[0].type, "change");
    assert.deepStrictEqual([rows[0].left!.text, rows[0].right!.text], ["a", "x"]);

    assert.strictEqual(rows[1].type, "del");
    assert.strictEqual(rows[1].left!.text, "b");
    assert.strictEqual(rows[1].right, null);

    assert.strictEqual(rows[2].type, "del");
    assert.strictEqual(rows[2].left!.text, "c");
    assert.strictEqual(rows[2].right, null);
  });

  test("unequal replace: added block longer — pads the left side with add rows", () => {
    const { rows, stats } = alignDiff("a\n", "x\ny\nz\n");

    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(stats, { added: 3, removed: 1 });

    assert.strictEqual(rows[0].type, "change");
    assert.deepStrictEqual([rows[0].left!.text, rows[0].right!.text], ["a", "x"]);

    assert.strictEqual(rows[1].type, "add");
    assert.strictEqual(rows[1].left, null);
    assert.strictEqual(rows[1].right!.text, "y");

    assert.strictEqual(rows[2].type, "add");
    assert.strictEqual(rows[2].left, null);
    assert.strictEqual(rows[2].right!.text, "z");
  });

  test("multi-hunk: separate context/change hunks keep independent per-side numbering", () => {
    const oldText = "same1\nold-a\nsame2\nold-b\nold-c\nsame3\n";
    const newText = "same1\nnew-a\nsame2\nnew-b\nsame3\n";

    const { rows, stats } = alignDiff(oldText, newText);

    const types = rows.map((r) => r.type);
    assert.deepStrictEqual(types, ["context", "change", "context", "change", "del", "context"]);
    assert.deepStrictEqual(stats, { added: 2, removed: 3 });

    // Per-side line numbers strictly increase by exactly 1 per row that has
    // a non-null cell on that side, regardless of the other side's type.
    const leftNos = rows.filter((r) => r.left).map((r) => r.left!.no);
    const rightNos = rows.filter((r) => r.right).map((r) => r.right!.no);
    assert.deepStrictEqual(leftNos, [1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(rightNos, [1, 2, 3, 4, 5]);

    assert.deepStrictEqual(
      rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null]),
      [
        ["same1", "same1"],
        ["old-a", "new-a"],
        ["same2", "same2"],
        ["old-b", "new-b"],
        ["old-c", null],
        ["same3", "same3"],
      ]
    );
  });

  test("no trailing newline on the last line of either side", () => {
    const { rows } = alignDiff("a\nb", "a\nb");
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].type, "context");
    assert.strictEqual(rows[1].type, "context");
    assert.deepStrictEqual(rows.map((r) => r.left!.text), ["a", "b"]);
  });

  test("trailing-newline-only difference is treated as a real content change", () => {
    // jsdiff's diffLines treats "b\n" and "b" as different lines (the
    // newline is part of the line's identity), so this is a one-line
    // replace, not a no-op.
    const { rows, stats } = alignDiff("a\nb\n", "a\nb");

    assert.strictEqual(stats.added, 1);
    assert.strictEqual(stats.removed, 1);
    assert.strictEqual(rows[0].type, "context");
    assert.strictEqual(rows[0].left!.text, "a");
    assert.strictEqual(rows[1].type, "change");
    assert.strictEqual(rows[1].left!.text, "b");
    assert.strictEqual(rows[1].right!.text, "b");
  });

  test("per-side line numbers only advance on rows where that side is non-null", () => {
    // del rows must not consume a right-side number; add rows must not
    // consume a left-side number.
    const { rows } = alignDiff("keep\nremoved\n", "keep\nadded\n");
    // "removed" and "added" are unrelated single lines -> del then add
    // (not zipped as "change") is also an acceptable diffLines outcome,
    // but jsdiff diffLines pairs same-position replace runs as one
    // removed+added part pair, so this actually zips as "change". Assert
    // the numbering invariant directly instead of the exact row shape.
    let leftNo = 0;
    let rightNo = 0;
    for (const row of rows) {
      if (row.left) {
        assert.strictEqual(row.left.no, leftNo + 1);
        leftNo = row.left.no;
      }
      if (row.right) {
        assert.strictEqual(row.right.no, rightNo + 1);
        rightNo = row.right.no;
      }
    }
    assert.strictEqual(leftNo, 2);
    assert.strictEqual(rightNo, 2);
  });

  test("stats count every added/removed line across multiple hunks", () => {
    const { stats } = alignDiff("a\nb\nc\nd\ne\n", "a\nX\nc\nY\nZ\ne\n");
    // b -> X (1 removed, 1 added), d -> Y, Z (1 removed, 2 added)
    assert.deepStrictEqual(stats, { added: 3, removed: 2 });
  });

  // -------------------------------------------------------------------
  // Step 8: char-diff segments + line-ending (\r) handling.
  // -------------------------------------------------------------------

  test("a change row exposes leftSegs/rightSegs from charDiff", () => {
    const { rows } = alignDiff("cat\n", "cot\n");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].type, "change");
    assert.deepStrictEqual(rows[0].leftSegs, [
      { text: "c", changed: false },
      { text: "a", changed: true },
      { text: "t", changed: false },
    ]);
    assert.deepStrictEqual(rows[0].rightSegs, [
      { text: "c", changed: false },
      { text: "o", changed: true },
      { text: "t", changed: false },
    ]);
  });

  test("context/del/add rows never carry leftSegs/rightSegs", () => {
    const { rows } = alignDiff("keep\nold\n", "keep\n");
    for (const row of rows) {
      assert.strictEqual(row.leftSegs, undefined);
      assert.strictEqual(row.rightSegs, undefined);
    }
  });

  test("CRLF vs LF on an otherwise-identical line: one change row whose only changed char is \\r", () => {
    const { rows, stats } = alignDiff("x\r\n", "x\n");

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].type, "change");
    assert.strictEqual(rows[0].left!.text, "x\r");
    assert.strictEqual(rows[0].right!.text, "x");
    assert.deepStrictEqual(rows[0].leftSegs, [
      { text: "x", changed: false },
      { text: "\r", changed: true },
    ]);
    assert.deepStrictEqual(rows[0].rightSegs, [{ text: "x", changed: false }]);
    assert.deepStrictEqual(stats, { added: 1, removed: 1 });
  });

  test("a plain trailing-newline-only difference does not crash and still zips as one change row", () => {
    const { rows, stats } = alignDiff("b\n", "b");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].type, "change");
    assert.strictEqual(rows[0].left!.text, "b");
    assert.strictEqual(rows[0].right!.text, "b");
    // Identical line text on both sides once the trailing "\n" separator
    // itself is stripped -> charDiff sees no character difference at all.
    assert.deepStrictEqual(rows[0].leftSegs, [{ text: "b", changed: false }]);
    assert.deepStrictEqual(rows[0].rightSegs, [{ text: "b", changed: false }]);
    assert.deepStrictEqual(stats, { added: 1, removed: 1 });
  });

  suite("cellClasses (media/render.mjs)", () => {
    suiteSetup(async () => {
      const renderMjsPath = path.join(__dirname, "..", "..", "src", "webview", "render.mjs");
      const renderModule = await importESM(pathToFileURL(renderMjsPath).href);
      cellClasses = renderModule.cellClasses;
    });

    test("context row: neither side padded nor highlighted", () => {
      const row = {
        left: { no: 1, text: "a" },
        right: { no: 1, text: "a" },
        type: "context" as const,
      };
      assert.deepStrictEqual(cellClasses(row), {
        left: { pad: false, highlight: false },
        right: { pad: false, highlight: false },
      });
    });

    test("del row: left highlighted, right padded", () => {
      const row = { left: { no: 1, text: "a" }, right: null, type: "del" as const };
      assert.deepStrictEqual(cellClasses(row), {
        left: { pad: false, highlight: true },
        right: { pad: true, highlight: false },
      });
    });

    test("add row: right highlighted, left padded", () => {
      const row = { left: null, right: { no: 1, text: "a" }, type: "add" as const };
      assert.deepStrictEqual(cellClasses(row), {
        left: { pad: true, highlight: false },
        right: { pad: false, highlight: true },
      });
    });

    test("change row: both sides highlighted, neither padded", () => {
      const row = {
        left: { no: 1, text: "a" },
        right: { no: 1, text: "x" },
        type: "change" as const,
      };
      assert.deepStrictEqual(cellClasses(row), {
        left: { pad: false, highlight: true },
        right: { pad: false, highlight: true },
      });
    });
  });
});
