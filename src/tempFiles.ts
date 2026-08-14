import * as vscode from "vscode";

/**
 * Manages the pair of temp files backing the "Open in Diff Editor" button.
 * Rooted at `<globalStorageUri>/difftab/`, one `<panelId>-left.txt` /
 * `<panelId>-right.txt` pair per live DiffPanel. Real files (not untitled
 * docs) so VS Code's native diff editor can rediff live if the user edits
 * them, and so re-clicking the button just overwrites the same pair.
 */
export class TempFiles {
  private readonly rootUri: vscode.Uri;

  constructor(globalStorageUri: vscode.Uri) {
    this.rootUri = vscode.Uri.joinPath(globalStorageUri, "difftab");
  }

  /**
   * Writes `left`/`right` to the panel's temp-file pair, creating the
   * `difftab/` directory first (idempotent — `createDirectory` is a no-op
   * if it already exists). Returns the pair's URIs for `vscode.diff`.
   */
  public async writePair(
    panelId: string,
    left: string,
    right: string
  ): Promise<{ leftUri: vscode.Uri; rightUri: vscode.Uri }> {
    await vscode.workspace.fs.createDirectory(this.rootUri);

    const leftUri = this.fileUri(panelId, "left");
    const rightUri = this.fileUri(panelId, "right");
    const encoder = new TextEncoder();

    await Promise.all([
      vscode.workspace.fs.writeFile(leftUri, encoder.encode(left)),
      vscode.workspace.fs.writeFile(rightUri, encoder.encode(right)),
    ]);

    return { leftUri, rightUri };
  }

  /** Best-effort deletion of a panel's temp-file pair; ignores errors. */
  public async deletePair(panelId: string): Promise<void> {
    await Promise.all([
      this.deleteQuietly(this.fileUri(panelId, "left")),
      this.deleteQuietly(this.fileUri(panelId, "right")),
    ]);
  }

  /**
   * Deletes every file under `difftab/`. Fire-and-forget safe: tolerates a
   * missing directory (nothing to sweep on a fresh install) and swallows
   * per-entry failures so one locked/missing file can't abort the sweep.
   */
  public async sweep(): Promise<void> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(this.rootUri);
    } catch {
      return; // Directory doesn't exist yet — nothing to sweep.
    }

    await Promise.all(
      entries.map(([name]) =>
        this.deleteQuietly(vscode.Uri.joinPath(this.rootUri, name))
      )
    );
  }

  private fileUri(panelId: string, side: "left" | "right"): vscode.Uri {
    return vscode.Uri.joinPath(this.rootUri, `${panelId}-${side}.txt`);
  }

  private async deleteQuietly(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // Best-effort: file may already be gone or otherwise unreadable.
    }
  }
}
