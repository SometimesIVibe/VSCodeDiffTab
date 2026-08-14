import * as vscode from "vscode";
import { DiffPanel } from "./panel/DiffPanel";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("diffTab.new", () => {
      DiffPanel.create(context.extensionUri);
    })
  );
}

export function deactivate(): void {
  // No-op.
}
