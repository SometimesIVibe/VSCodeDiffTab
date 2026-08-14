import * as assert from "assert";
import * as vscode from "vscode";

/** Total number of open tabs across every tab group in the window. */
function totalTabCount(): number {
  return vscode.window.tabGroups.all.reduce((sum, group) => sum + group.tabs.length, 0);
}

suite("diffTab.new (light integration)", () => {
  teardown(async () => {
    // Close every tab opened by the test(s) so suites don't leak state
    // into each other or into a developer's real window.
    const allTabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    if (allTabs.length > 0) {
      await vscode.window.tabGroups.close(allTabs);
    }
  });

  test("executing the command opens a Diff Tab webview tab", async () => {
    const before = totalTabCount();

    await vscode.commands.executeCommand("diffTab.new");

    // Panel creation posts HTML synchronously but VS Code's own tab
    // bookkeeping can lag a tick behind the command returning.
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.strictEqual(totalTabCount(), before + 1);

    const newTab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).at(-1);
    assert.ok(newTab, "expected a new tab to exist");
    assert.strictEqual(newTab!.label, "Diff Tab");
  });

  test("executing the command twice opens two independent tabs", async () => {
    const before = totalTabCount();

    await vscode.commands.executeCommand("diffTab.new");
    await vscode.commands.executeCommand("diffTab.new");
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.strictEqual(totalTabCount(), before + 2);
  });
});
