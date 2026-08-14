// Diff Tab webview entry point. Layout/splitters/toolbar/persistence land
// in Step 2. Step 3 wires the Diff button to the pure alignDiff() model
// (console-logged proof only; real rendering is Step 4). Open in Diff
// Editor still posts a placeholder message for Step 5 to implement.
//
// The equal-height guarantee is structural, not something this script has
// to police: both textareas fill 100% of their flex cell inside
// `.inputs-row`, and that row's own height (`--inputs-height`) is the only
// height value either splitter ever touches. There is no code path that
// can set one textarea's height without the other.
import { alignDiff } from "./align.js";

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

  /** Clamps `value` into the inclusive [min, max] range. */
  function clamp(value, range) {
    const [min, max] = range;
    return Math.min(max, Math.max(min, value));
  }

  // ---------------------------------------------------------------------
  // State persistence — webview getState/setState (hide/show survival).
  // Reload survival via workspaceState is Step 6.
  // ---------------------------------------------------------------------

  function loadState() {
    const state = vscode.getState() || {};
    return {
      leftText: typeof state.leftText === "string" ? state.leftText : "",
      rightText: typeof state.rightText === "string" ? state.rightText : "",
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

  let saveTextTimer = null;
  function saveTextDebounced() {
    if (saveTextTimer !== null) {
      clearTimeout(saveTextTimer);
    }
    saveTextTimer = setTimeout(() => {
      saveTextTimer = null;
      saveState({ leftText: leftTextarea.value, rightText: rightTextarea.value });
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

  diffButton.addEventListener("click", () => {
    // Real rendering is Step 4; for now prove the bundled diff engine
    // works end-to-end via the dev-tools console.
    const { rows, stats } = alignDiff(leftTextarea.value, rightTextarea.value);
    console.log(`[diffTab] rows=${rows.length} added=${stats.added} removed=${stats.removed}`);
  });

  openDiffEditorButton.addEventListener("click", () => {
    vscode.postMessage({ command: "openDiffEditor" }); // Step 5 implements this.
  });

  clearButton.addEventListener("click", () => {
    leftTextarea.value = "";
    rightTextarea.value = "";
    saveState({ leftText: "", rightText: "" });
    leftTextarea.focus();
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
