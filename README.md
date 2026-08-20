# Diff Tab

Diff Tab opens a full editor tab with two side-by-side text boxes and a
one-click, git-style line diff between them — no files, no source control,
no setup. Paste two blobs of text, press **Diff**, read the result.

<!-- Screenshot placeholder: toolbar + two inputs + rendered diff, light and
     dark theme. Add once the UI is stable. -->

## Features

- **Two size-adjustable text inputs.** A vertical splitter between them
  changes the width ratio; a horizontal splitter below them changes how
  much of the tab the inputs take up versus the result area. Both inputs
  always share the same height — there's a single splitter for that, not
  two independently resizable boxes that could drift apart.
- **Diff button.** Computes a Myers/LCS line diff (the same algorithm
  family `git diff` uses) and renders it underneath as two aligned columns:
  left is the original, right is the changed text, each with its own line
  numbers. Removed lines are highlighted on the left, added lines on the
  right, and gaps are padded so a removed block and its replacement line up
  row for row, the way GitHub's split diff view does. Long lines are
  ellipsized rather than wrapped, so row alignment never breaks — hover a
  clipped line to see it in full via its tooltip.
  Press **Ctrl+Enter** (**Cmd+Enter** on macOS) from inside either text box
  as a shortcut for the Diff button.
- **Inline character highlight.** Within a changed line, the exact
  differing characters get an extra-dark highlight on top of the row's own
  red/green background — the same line-vs-inline look VS Code's built-in
  diff editor uses, so a one-character edit in a long line is obvious at a
  glance instead of making you scan the whole line.
- **Whitespace and control-character markers.** Ambiguous or invisible
  characters that would otherwise make a real difference look like no
  difference at all — a non-breaking space standing in for a regular
  space, a zero-width space, an ideographic or narrow space, a stray form
  feed, and similar — render as a small, dimmed, tooltipped marker (e.g.
  hovering shows "NO-BREAK SPACE (U+00A0)") instead of disappearing into
  the text.
- **Line-ending differences.** A line that differs only in its line
  ending — CRLF vs LF — shows a highlighted carriage-return marker at the
  end of the line, the same way any other single-character difference
  does; no separate "line ending" UI is needed. Known limitation: a
  lone-CR (classic Mac, pre-OS X) line ending isn't recognized as a line
  break at all (the diff engine splits lines on `\n` only), so such a file
  is treated as one long line — its `\r` characters still render as
  markers, just not as separate diff rows.
- **Open in VS Code Diff Editor.** Sends both texts to VS Code's own built-in
  diff editor instead of Diff Tab's inline view. See below for how this works.
- **Multiple tabs.** Every "Diff Tab: New Diff" invocation opens its own
  independent tab; there's no limit on how many can be open at once.
- **Survives reload.** The last pair of texts you typed is restored the
  next time you open a fresh Diff Tab — including after a full window
  reload, not just hiding and re-showing the tab.
- **No settings.** Diff Tab has no configuration to open, learn, or keep in
  sync — everything it does is driven by the toolbar in front of you.

## Usage

1. Run **Diff Tab: New Diff** from the Command Palette (there's no default
   keybinding — this is an occasional tool, not something you'd want
   fighting for a shortcut with your regular editing keys).
2. Paste the original text into the left box, the changed text into the
   right box.
3. Press **Diff** (or Ctrl/Cmd+Enter) to see the aligned, colorized diff
   below the inputs, or **Open in VS Code Diff Editor** to compare the same
   two texts in VS Code's native diff view.

## The "Open in VS Code Diff Editor" mechanism

VS Code's built-in diff editor (`vscode.diff`) compares two files, not two
in-memory strings, so Diff Tab writes your two text boxes out to a pair of
real temporary files — under the extension's global storage folder, not
your workspace — and then opens VS Code's native diff on that pair. They're
real files rather than untitled/virtual documents specifically so the
native editor can re-diff live if you edit either side directly in that
diff view.

Each Diff Tab tab gets its own pair of temp files, overwritten every time
you click the button again. They're deleted when you close that tab, and
any files left behind from an earlier session (e.g. after a crash) are
swept away the next time the extension activates.

## Commands

| Command ID    | Title                | Notes                                                                                |
| ------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `diffTab.new` | Diff Tab: New Diff   | Opens a new Diff Tab editor tab. No default keybinding — command palette only; several tabs can be open at once. |

## Install from .vsix

Diff Tab isn't published to the Marketplace. Install the packaged
`.vsix` directly:

1. Download or build `vscode-diff-tab-0.2.0.vsix`.
2. In VS Code, open the Command Palette and run **Extensions: Install from
   VSIX...**, then pick the file — or from a terminal:

   ```bash
   code --install-extension vscode-diff-tab-0.2.0.vsix
   ```

3. Reload the window if prompted. **Diff Tab: New Diff** is now available
   from the Command Palette.
