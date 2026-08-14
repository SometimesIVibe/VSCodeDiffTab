// Diff Tab webview entry point. Layout/splitters/toolbar/persistence land
// in Step 2. Step 4 wires the Diff button to the pure alignDiff() model
// and renders the aligned rows into #result-area (src/webview/render.mjs).
// Step 5 wires Open in Diff Editor: posts { type: 'openNativeDiff', left,
// right } with the current textarea values, read at click time — no state
// round-trip. The extension host writes them to temp files and opens
// VS Code's built-in diff editor.
//
// Step 6 adds reload persistence: the same 300ms debounce that already
// drove getState/setState now also posts { type: 'textsChanged', left,
// right } to the host, which writes it to workspaceState (capped). A fresh
// panel is seeded from that workspaceState pair via `window.__DIFF_TAB_
// INIT__`, injected into the HTML by DiffPanel.getHtml() — but only used
// here when this webview has no getState() of its own, so it never
// clobbers a live hide/show session.
//
// The equal-height guarantee is structural, not something this script has
// to police: both textareas fill 100% of their flex cell inside
// `.inputs-row`, and that row's own height (`--inputs-height`) is the only
// height value either splitter ever touches. There is no code path that
// can set one textarea's height without the other.
import { alignDiff } from "./align.js";
import { renderDiff } from "./render.mjs";

(function main() {
  const vscode = acquireVsCodeApi();

  const DEFAULTS = {
    leftRatio: 50, // percent width of the left input inside .inputs-row
    inputsHeight: 40, // percent height of .inputs-row inside #root
  };

  const CLAMP = {
    leftRatio: [15, 85],
    inputsHeight: [10, 85],
  };

  const root = document.getElementById("root");
  const inputsRow = document.getElementById("inputs-row");
  const leftTextarea = document.getElementById("input-left");
  const rightTextarea = document.getElementById("input-right");
  const vSplitter = document.getElementById("v-splitter");
  const hSplitter = document.getElementById("h-splitter");
  const diffButton = document.getElementById("btn-diff");
  const openDiffEditorButton = document.getElementById("btn-open-diff-editor");
  const clearButton = document.getElementById("btn-clear");
  const swapButton = document.getElementById("btn-swap");
  const resultArea = document.getElementById("result-area");

  /** Clamps `value` into the inclusive [min, max] range. */
  function clamp(value, range) {
    const [min, max] = range;
    return Math.min(max, Math.max(min, value));
  }

  // ---------------------------------------------------------------------
  // State persistence.
  //   - webview getState/setState: cheap hide/show survival, always wins
  //     once it exists (this webview instance has already touched state).
  //   - workspaceState (host-side, via `textsChanged`): reload survival.
  //     `window.__DIFF_TAB_INIT__` is this fresh panel's seed from it —
  //     only consulted below when getState() is empty, i.e. nothing has
  //     been saved into *this* webview instance yet.
  // ---------------------------------------------------------------------

  function loadState() {
    const rawState = vscode.getState();
    const state = rawState || {};
    const seed = rawState == null ? window.__DIFF_TAB_INIT__ : null;
    return {
      leftText:
        typeof state.leftText === "string"
          ? state.leftText
          : seed && typeof seed.left === "string"
            ? seed.left
            : "",
      rightText:
        typeof state.rightText === "string"
          ? state.rightText
          : seed && typeof seed.right === "string"
            ? seed.right
            : "",
      leftRatio:
        typeof state.leftRatio === "number" ? state.leftRatio : DEFAULTS.leftRatio,
      inputsHeight:
        typeof state.inputsHeight === "number"
          ? state.inputsHeight
          : DEFAULTS.inputsHeight,
    };
  }

  function saveState(partial) {
    const current = vscode.getState() || {};
    vscode.setState(Object.assign({}, current, partial));
  }

  /** Immediate save: webview state (hide/show) + host workspaceState (reload). */
  function commitTexts() {
    const left = leftTextarea.value;
    const right = rightTextarea.value;
    saveState({ leftText: left, rightText: right });
    vscode.postMessage({ type: "textsChanged", left, right });
  }

  let saveTextTimer = null;
  function saveTextDebounced() {
    if (saveTextTimer !== null) {
      clearTimeout(saveTextTimer);
    }
    saveTextTimer = setTimeout(() => {
      saveTextTimer = null;
      commitTexts();
    }, 300);
  }

  // ---------------------------------------------------------------------
  // Splitter axes.
  // ---------------------------------------------------------------------

  function setLeftRatio(percent) {
    const clamped = clamp(percent, CLAMP.leftRatio);
    root.style.setProperty("--left-ratio", clamped + "%");
    return clamped;
  }

  function setInputsHeight(percent) {
    const clamped = clamp(percent, CLAMP.inputsHeight);
    root.style.setProperty("--inputs-height", clamped + "%");
    return clamped;
  }

  function currentLeftRatio() {
    const raw = parseFloat(getComputedStyle(root).getPropertyValue("--left-ratio"));
    return Number.isFinite(raw) ? raw : DEFAULTS.leftRatio;
  }

  function currentInputsHeight() {
    const raw = parseFloat(getComputedStyle(root).getPropertyValue("--inputs-height"));
    return Number.isFinite(raw) ? raw : DEFAULTS.inputsHeight;
  }

  /**
   * Wires pointer-driven dragging for one splitter. `onMove` receives the
   * raw pointermove event and is responsible for writing the clamped CSS
   * variable; `onReset` restores that axis's default on double-click.
   * Pointer capture means pointermove/up keep firing on `splitterEl` even
   * once the cursor leaves its 6px hit area, so the whole drag is driven
   * from listeners on the splitter itself — no document-level listeners
   * needed.
   */
  function setupDrag(splitterEl, { onMove, onReset, cursorClass }) {
    let dragging = false;

    splitterEl.addEventListener("pointerdown", (event) => {
      dragging = true;
      splitterEl.setPointerCapture(event.pointerId);
      splitterEl.classList.add("dragging");
      document.body.classList.add(cursorClass);
      event.preventDefault();
    });

    splitterEl.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      onMove(event);
    });

    function endDrag(event) {
      if (!dragging) {
        return;
      }
      dragging = false;
      splitterEl.classList.remove("dragging");
      document.body.classList.remove(cursorClass);
      try {
        splitterEl.releasePointerCapture(event.pointerId);
      } catch (_err) {
        // Capture may already be gone (e.g. pointercancel); nothing to do.
      }
      saveState({ leftRatio: currentLeftRatio(), inputsHeight: currentInputsHeight() });
    }

    splitterEl.addEventListener("pointerup", endDrag);
    splitterEl.addEventListener("pointercancel", endDrag);

    splitterEl.addEventListener("dblclick", () => {
      onReset();
      saveState({ leftRatio: currentLeftRatio(), inputsHeight: currentInputsHeight() });
    });
  }

  setupDrag(vSplitter, {
    cursorClass: "dragging-v",
    onMove(event) {
      const rowRect = inputsRow.getBoundingClientRect();
      if (rowRect.width <= 0) {
        return;
      }
      const percent = ((event.clientX - rowRect.left) / rowRect.width) * 100;
      setLeftRatio(percent);
    },
    onReset() {
      setLeftRatio(DEFAULTS.leftRatio);
    },
  });

  setupDrag(hSplitter, {
    cursorClass: "dragging-h",
    onMove(event) {
      const rootRect = root.getBoundingClientRect();
      const rowRect = inputsRow.getBoundingClientRect();
      if (rootRect.height <= 0) {
        return;
      }
      // Height is measured from the top of the (fixed-position) inputs
      // row down to the pointer — that's the row's own height, the single
      // value both textareas take their height from.
      const heightPx = event.clientY - rowRect.top;
      const percent = (heightPx / rootRect.height) * 100;
      setInputsHeight(percent);
    },
    onReset() {
      setInputsHeight(DEFAULTS.inputsHeight);
    },
  });

  // ---------------------------------------------------------------------
  // Toolbar.
  // ---------------------------------------------------------------------

  /** Replaces #result-area with a single centered friendly-message line. */
  function showResultMessage(text, friendly) {
    resultArea.textContent = "";
    const message = document.createElement("p");
    message.className = friendly ? "placeholder placeholder-friendly" : "placeholder";
    message.textContent = text;
    resultArea.appendChild(message);
  }

  /** Tells the host what to show in the panel title (reset on 0/0). */
  function postDiffStats(added, removed) {
    vscode.postMessage({ type: "diffStats", added, removed });
  }

  /** Shared by the Diff button and the Ctrl/Cmd+Enter shortcut below. */
  function runDiff() {
    const leftValue = leftTextarea.value;
    const rightValue = rightTextarea.value;

    if (leftValue === "" && rightValue === "") {
      showResultMessage("Paste text into both boxes, then press Diff.");
      postDiffStats(0, 0);
      return;
    }

    const { rows, stats } = alignDiff(leftValue, rightValue);

    if (stats.added === 0 && stats.removed === 0) {
      showResultMessage("No differences.", true);
      postDiffStats(0, 0);
      return;
    }

    renderDiff(resultArea, rows, stats);
    postDiffStats(stats.added, stats.removed);
  }

  diffButton.addEventListener("click", runDiff);

  // Webview-local convenience shortcut — not a VS Code keybinding, so it
  // only fires while focus is inside this panel's own DOM.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      runDiff();
    }
  });

  openDiffEditorButton.addEventListener("click", () => {
    vscode.postMessage({
      type: "openNativeDiff",
      left: leftTextarea.value,
      right: rightTextarea.value,
    });
  });

  clearButton.addEventListener("click", () => {
    leftTextarea.value = "";
    rightTextarea.value = "";
    if (saveTextTimer !== null) {
      clearTimeout(saveTextTimer);
      saveTextTimer = null;
    }
    commitTexts();
    leftTextarea.focus();
  });

  // Swap goes through the normal (debounced) save path — the same one
  // every keystroke uses — rather than a bespoke immediate save.
  swapButton.addEventListener("click", () => {
    const leftValue = leftTextarea.value;
    const rightValue = rightTextarea.value;
    leftTextarea.value = rightValue;
    rightTextarea.value = leftValue;
    saveTextDebounced();
  });

  leftTextarea.addEventListener("input", saveTextDebounced);
  rightTextarea.addEventListener("input", saveTextDebounced);

  // ---------------------------------------------------------------------
  // Init — restore persisted state.
  // ---------------------------------------------------------------------

  (function restore() {
    const state = loadState();
    leftTextarea.value = state.leftText;
    rightTextarea.value = state.rightText;
    setLeftRatio(state.leftRatio);
    setInputsHeight(state.inputsHeight);
  })();
})();
