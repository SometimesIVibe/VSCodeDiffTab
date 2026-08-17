import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
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

  /** workspaceState keys — single saved pair per the masterplan's YAGNI decision. */
  private static readonly LEFT_KEY = "diffTab.left";
  private static readonly RIGHT_KEY = "diffTab.right";

  /** Per-side cap for the reload-persistence save; beyond this, skip silently. */
  private static readonly MAX_SAVED_BYTES = 500 * 1024;

  private static readonly DEFAULT_TITLE = "Diff Tab";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panelId: string;

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly tempFiles: TempFiles,
    private readonly workspaceState: vscode.Memento,
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
  public static create(
    extensionUri: vscode.Uri,
    tempFiles: TempFiles,
    workspaceState: vscode.Memento
  ): DiffPanel {
    const webviewPanel = vscode.window.createWebviewPanel(
      "diffTab",
      DiffPanel.DEFAULT_TITLE,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    const instance = new DiffPanel(extensionUri, tempFiles, workspaceState, webviewPanel);
    DiffPanel.panels.add(instance);
    return instance;
  }

  /** All currently live Diff Tab panels. */
  public static get instances(): ReadonlySet<DiffPanel> {
    return DiffPanel.panels;
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }

    const type = (message as { type?: unknown }).type;

    if (type === "openNativeDiff") {
      await this.handleOpenNativeDiff(message as { left: unknown; right: unknown });
      return;
    }

    if (type === "textsChanged") {
      this.handleTextsChanged(message as { left?: unknown; right?: unknown });
      return;
    }

    if (type === "diffStats") {
      this.handleDiffStats(message as { added?: unknown; removed?: unknown });
      return;
    }
  }

  private async handleOpenNativeDiff(message: { left: unknown; right: unknown }): Promise<void> {
    const { left, right } = message;
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

  /**
   * Persists the debounced `{ left, right }` pair for reload survival.
   * Each side is capped independently at `MAX_SAVED_BYTES` — a side over
   * the cap is skipped silently (webview `getState`/`setState` already
   * covers hide/show survival regardless of size; only the heavier
   * workspaceState round-trip is capped).
   */
  private handleTextsChanged(message: { left?: unknown; right?: unknown }): void {
    if (typeof message.left === "string") {
      this.saveSide(DiffPanel.LEFT_KEY, message.left);
    }
    if (typeof message.right === "string") {
      this.saveSide(DiffPanel.RIGHT_KEY, message.right);
    }
  }

  private saveSide(key: string, text: string): void {
    if (Buffer.byteLength(text, "utf8") > DiffPanel.MAX_SAVED_BYTES) {
      return;
    }
    void this.workspaceState.update(key, text);
  }

  /**
   * Reflects the last diff's stats in the panel title (`Diff Tab (+A −R)`),
   * resetting to the plain title when there's nothing to show (empty
   * inputs or no differences) — the webview sends `added: 0, removed: 0`
   * for both of those cases.
   */
  private handleDiffStats(message: { added?: unknown; removed?: unknown }): void {
    const added = typeof message.added === "number" ? message.added : 0;
    const removed = typeof message.removed === "number" ? message.removed : 0;

    this.panel.title =
      added === 0 && removed === 0
        ? DiffPanel.DEFAULT_TITLE
        : `${DiffPanel.DEFAULT_TITLE} (+${added} −${removed})`;
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

    // Seeds a *fresh* panel from the single saved workspaceState pair. This
    // only ever reaches a webview that has no state of its own: getHtml()
    // runs once, in the constructor, before the webview has had a chance
    // to acquireVsCodeApi().setState() anything — retainContextWhenHidden
    // means the webview is never torn down/rebuilt (and getHtml() never
    // re-runs) for the lifetime of this panel, so there's no risk of this
    // clobbering a live editing session on hide/show. main.js additionally
    // only consults this payload when its own vscode.getState() comes back
    // empty, so even a future code path that re-renders the HTML stays safe.
    const initialLeft = this.workspaceState.get<string>(DiffPanel.LEFT_KEY, "");
    const initialRight = this.workspaceState.get<string>(DiffPanel.RIGHT_KEY, "");
    const initPayload = JSON.stringify({ left: initialLeft, right: initialRight }).replace(
      /</g,
      "\\u003c"
    );

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
      <button id="btn-diff" type="button" title="Compute the diff (Ctrl/Cmd+Enter)">Diff</button>
      <button id="btn-open-diff-editor" type="button" title="Open both texts in VS Code's built-in diff editor">Open in VS Code Diff Editor</button>
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
  <script nonce="${nonce}">window.__DIFF_TAB_INIT__ = ${initPayload};</script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  return randomBytes(16).toString("base64");
}
