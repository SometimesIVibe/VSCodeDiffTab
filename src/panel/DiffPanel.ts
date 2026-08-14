import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { TempFiles } from "../tempFiles";

/**
 * Wraps a single "Diff Tab" webview editor panel (`createWebviewPanel`,
 * `ViewColumn.Active`). Unlike a `WebviewViewProvider`-based bottom panel,
 * each invocation of `diffTab.new` creates its own independent instance —
 * several Diff Tab editor tabs can be open at once. All live instances are
 * tracked in `DiffPanel.instances` for later cross-panel bookkeeping (e.g.
 * cleaning up temp diff files on `deactivate`).
 */
export class DiffPanel {
  private static readonly panels = new Set<DiffPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panelId: string;

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly tempFiles: TempFiles,
    panel: vscode.WebviewPanel
  ) {
    this.panel = panel;
    this.panelId = randomBytes(6).toString("hex");
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /** Creates and shows a new Diff Tab panel in the active editor column. */
  public static create(extensionUri: vscode.Uri, tempFiles: TempFiles): DiffPanel {
    const webviewPanel = vscode.window.createWebviewPanel(
      "diffTab",
      "Diff Tab",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    const instance = new DiffPanel(extensionUri, tempFiles, webviewPanel);
    DiffPanel.panels.add(instance);
    return instance;
  }

  /** All currently live Diff Tab panels. */
  public static get instances(): ReadonlySet<DiffPanel> {
    return DiffPanel.panels;
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (
      !message ||
      typeof message !== "object" ||
      (message as { type?: unknown }).type !== "openNativeDiff"
    ) {
      return;
    }

    const { left, right } = message as { left: unknown; right: unknown };
    const leftText = typeof left === "string" ? left : "";
    const rightText = typeof right === "string" ? right : "";

    if (leftText === "" && rightText === "") {
      vscode.window.showInformationMessage(
        "Paste text into both boxes before opening the diff editor."
      );
      return;
    }

    const { leftUri, rightUri } = await this.tempFiles.writePair(
      this.panelId,
      leftText,
      rightText
    );

    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      "Diff Tab: Original ↔ Changed"
    );
  }

  public dispose(): void {
    DiffPanel.panels.delete(this);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel.dispose();
    void this.tempFiles.deletePair(this.panelId);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.js")
    );

    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>Diff Tab</title>
</head>
<body>
  <div id="root">
    <div class="toolbar">
      <button id="btn-diff" type="button">Diff</button>
      <button id="btn-open-diff-editor" type="button">Open in Diff Editor</button>
      <button id="btn-clear" type="button">Clear</button>
    </div>
    <div class="inputs-row" id="inputs-row">
      <div class="input-cell input-left" id="input-left-cell">
        <textarea
          id="input-left"
          class="input-textarea"
          spellcheck="false"
          placeholder="Paste original text…"
        ></textarea>
      </div>
      <div
        class="v-splitter"
        id="v-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inputs"
        tabindex="0"
      ></div>
      <div class="input-cell input-right" id="input-right-cell">
        <textarea
          id="input-right"
          class="input-textarea"
          spellcheck="false"
          placeholder="Paste changed text…"
        ></textarea>
      </div>
    </div>
    <div
      class="h-splitter"
      id="h-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize inputs against result area"
      tabindex="0"
    ></div>
    <div class="result-area" id="result-area">
      <p class="placeholder">Diff results will appear here.</p>
    </div>
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  return randomBytes(16).toString("base64");
}
