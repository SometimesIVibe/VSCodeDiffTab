import * as vscode from "vscode";
import { DiffPanel } from "./panel/DiffPanel";
import { TempFiles } from "./tempFiles";

export function activate(context: vscode.ExtensionContext): void {
  const tempFiles = new TempFiles(context.globalStorageUri);

  // Any files left in difftab/ are stale by definition — panel ids don't
  // outlive a session. Fire-and-forget; nothing depends on this finishing.
  void tempFiles.sweep();

  context.subscriptions.push(
    vscode.commands.registerCommand("diffTab.new", () => {
      DiffPanel.create(context.extensionUri, tempFiles);
    })
  );
}

export function deactivate(): void {
  // No-op.
}
