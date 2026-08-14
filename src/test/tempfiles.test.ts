import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { TempFiles } from "../tempFiles";

suite("TempFiles", () => {
  let tmpDir: string;
  let tempFiles: TempFiles;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-tab-tempfiles-test-"));
    tempFiles = new TempFiles(vscode.Uri.file(tmpDir));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function difftabDir(): string {
    return path.join(tmpDir, "difftab");
  }

  test("writePair creates both files with exact contents", async () => {
    const { leftUri, rightUri } = await tempFiles.writePair("panel-1", "hello\nleft", "hello\nright");

    assert.strictEqual(leftUri.fsPath, path.join(difftabDir(), "panel-1-left.txt"));
    assert.strictEqual(rightUri.fsPath, path.join(difftabDir(), "panel-1-right.txt"));
    assert.strictEqual(fs.readFileSync(leftUri.fsPath, "utf8"), "hello\nleft");
    assert.strictEqual(fs.readFileSync(rightUri.fsPath, "utf8"), "hello\nright");
  });

  test("writePair overwrites an existing pair with new contents", async () => {
    await tempFiles.writePair("panel-1", "old-left", "old-right");
    const { leftUri, rightUri } = await tempFiles.writePair("panel-1", "new-left", "new-right");

    assert.strictEqual(fs.readFileSync(leftUri.fsPath, "utf8"), "new-left");
    assert.strictEqual(fs.readFileSync(rightUri.fsPath, "utf8"), "new-right");
  });

  test("deletePair removes both files for that panel and no others", async () => {
    await tempFiles.writePair("panel-1", "a", "b");
    await tempFiles.writePair("panel-2", "c", "d");

    await tempFiles.deletePair("panel-1");

    assert.strictEqual(fs.existsSync(path.join(difftabDir(), "panel-1-left.txt")), false);
    assert.strictEqual(fs.existsSync(path.join(difftabDir(), "panel-1-right.txt")), false);
    assert.strictEqual(fs.existsSync(path.join(difftabDir(), "panel-2-left.txt")), true);
    assert.strictEqual(fs.existsSync(path.join(difftabDir(), "panel-2-right.txt")), true);
  });

  test("deletePair on a never-written panel id does not throw", async () => {
    await assert.doesNotReject(tempFiles.deletePair("never-existed"));
  });

  test("sweep clears every leftover file under difftab/", async () => {
    await tempFiles.writePair("panel-1", "a", "b");
    await tempFiles.writePair("panel-2", "c", "d");

    await tempFiles.sweep();

    assert.deepStrictEqual(fs.readdirSync(difftabDir()), []);
  });

  test("sweep tolerates a missing difftab/ directory (fresh install)", async () => {
    assert.strictEqual(fs.existsSync(difftabDir()), false);
    await assert.doesNotReject(tempFiles.sweep());
  });
});
