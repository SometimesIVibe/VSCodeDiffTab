# Diff Tab

A VS Code extension that opens a webview editor tab with two size-adjustable
text inputs side by side. A **Diff** button computes a git-style line diff of
the two texts and renders it underneath, side by side and row-aligned, with
per-side line numbers, additions green and removals red. A second button
opens the same two texts in VS Code's built-in diff editor via temporary
files.

This is a scaffold; the diffing UI itself lands in later steps.

## Commands

| Command ID   | Title                | Notes                                        |
| ------------ | --------------------- | --------------------------------------------- |
| `diffTab.new` | Diff Tab: New Diff   | Opens a new Diff Tab editor tab. No default keybinding — command palette only; several tabs can be open at once. |
