(() => {
  if (window.__quilldockContentScriptBooted) {
    return;
  }
  window.__quilldockContentScriptBooted = true;

  const TOOL_PEN = "pen";
  const TOOL_RECT = "rect";
  const TOOL_ARROW = "arrow";
  const TOOL_TEXT = "text";

  const MAX_PREVIEW_PIXELS = 6_000_000;
  const MAX_PREVIEW_HEIGHT = 9000;

  let activeSelectionTask = null;
  let uiHiddenForCapture = false;
  let uiHiddenWasOpen = false;

  const state = {
    panelOpen: false,
    busy: false,
    captures: [],
    selectedCaptureId: null,
    modal: {
      open: false,
      busy: false,
      captureId: null,
      isDraftCapture: false,
      originalImageData: "",
      originalNote: "",
      currentTool: TOOL_PEN,
      baseImage: null,
      naturalWidth: 0,
      naturalHeight: 0,
      renderWidth: 0,
      renderHeight: 0,
      shapes: [],
      activeShape: null,
      pointerId: null,
    },
  };

  const refs = {
    host: null,
    shadow: null,
    launcherBtn: null,
    panel: null,
    closePanelBtn: null,
    captureVisibleBtn: null,
    captureSelectionBtn: null,
    captureFullBtn: null,
    openReviewBtn: null,
    statusText: null,
    captureCount: null,
    captureList: null,
    emptyList: null,
    modal: null,
    modalCloseBtn: null,
    modalTitle: null,
    modalHint: null,
    modalPenBtn: null,
    modalRectBtn: null,
    modalArrowBtn: null,
    modalTextBtn: null,
    modalStrokeColorInput: null,
    modalStrokeWidthInput: null,
    modalUndoBtn: null,
    modalClearBtn: null,
    modalCanvasWrap: null,
    modalCanvas: null,
    modalNoteInput: null,
    modalDiscardBtn: null,
    modalSaveBtn: null,
    modalCanvasCtx: null,
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return undefined;
    }

    if (message.type === "start-area-selection") {
      if (activeSelectionTask) {
        activeSelectionTask.cancel();
        activeSelectionTask = null;
      }

      activeSelectionTask = createAreaSelectionTask();

      activeSelectionTask.promise
        .then((result) => sendResponse(result))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error?.message || "Selection canceled.",
          });
        })
        .finally(() => {
          activeSelectionTask = null;
        });

      return true;
    }

    if (message.type === "toggle-sidebar-ui") {
      togglePanel();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "prepare-capture-ui") {
      prepareUiForCapture();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "restore-capture-ui") {
      restoreUiAfterCapture();
      sendResponse({ ok: true });
      return false;
    }

    return undefined;
  });

  init().catch((error) => {
    console.error("Failed to initialize QuillDock sidebar", error);
  });

  async function init() {
    buildUi();
    bindUiEvents();
    setPanelOpen(false);
    setStatus("Ready.", false);
    await refreshCaptures();
    updateControlState();
  }

  function buildUi() {
    refs.host = document.createElement("div");
    refs.host.id = "quilldock-host";
    refs.host.style.position = "fixed";
    refs.host.style.inset = "0";
    refs.host.style.zIndex = "2147483640";
    refs.host.style.pointerEvents = "none";

    refs.shadow = refs.host.attachShadow({ mode: "open" });
    refs.shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        * {
          box-sizing: border-box;
          font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        }

        .launcher {
          position: fixed;
          top: 46%;
          right: 12px;
          width: 46px;
          height: 46px;
          border: 1px solid #9ab7df;
          border-radius: 13px;
          background: linear-gradient(155deg, #1a73e8 0%, #1a60c7 100%);
          color: #ffffff;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          cursor: pointer;
          display: grid;
          place-items: center;
          box-shadow: 0 14px 28px rgba(12, 30, 57, 0.38);
          pointer-events: auto;
          transition: transform 130ms ease, box-shadow 130ms ease;
        }

        .launcher:hover {
          transform: translateY(-1px);
          box-shadow: 0 18px 32px rgba(12, 30, 57, 0.45);
        }

        .panel {
          position: fixed;
          top: 12px;
          right: 12px;
          width: min(390px, calc(100vw - 20px));
          height: calc(100vh - 24px);
          border: 1px solid #c8d8ec;
          border-radius: 14px;
          background: linear-gradient(180deg, #f7fbff 0%, #edf4fc 100%);
          box-shadow: 0 24px 55px rgba(12, 25, 45, 0.36);
          transform: translateX(calc(100% + 16px));
          opacity: 0;
          pointer-events: none;
          transition: transform 180ms ease, opacity 180ms ease;
          padding: 12px;
          display: grid;
          grid-template-rows: auto auto auto auto 1fr;
          gap: 10px;
        }

        .panel.open {
          transform: translateX(0);
          opacity: 1;
          pointer-events: auto;
        }

        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid #d7e4f3;
        }

        .panel-title-wrap {
          min-width: 0;
        }

        .panel-title {
          margin: 0;
          font-size: 16px;
          color: #12395f;
          font-weight: 800;
          letter-spacing: 0.02em;
        }

        .panel-subtitle {
          margin: 3px 0 0;
          font-size: 11px;
          color: #5b7188;
        }

        .close-btn {
          border: 1px solid #c9d9ec;
          border-radius: 9px;
          padding: 6px 8px;
          font-size: 12px;
          font-weight: 700;
          background: #ffffff;
          color: #355675;
          cursor: pointer;
        }

        button {
          border: 0;
          border-radius: 9px;
          padding: 8px 9px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          cursor: pointer;
          transition: transform 120ms ease, background 120ms ease, opacity 120ms ease;
        }

        button:disabled {
          opacity: 0.58;
          cursor: not-allowed;
        }

        button:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .primary {
          background: #1a73e8;
          color: #ffffff;
        }

        .primary:hover:not(:disabled) {
          background: #0f60c9;
        }

        .ghost {
          background: #e4eefc;
          color: #173f68;
        }

        .ghost:hover:not(:disabled) {
          background: #d8e8fc;
        }

        .capture-controls {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
        }

        .panel-actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
        }

        .status {
          margin: 0;
          min-height: 16px;
          font-size: 11px;
          color: #5c7188;
        }

        .list-section {
          border: 1px solid #d0ddef;
          border-radius: 11px;
          background: #ffffff;
          padding: 8px;
          min-height: 0;
          display: grid;
          grid-template-rows: auto 1fr;
          gap: 8px;
        }

        .list-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          border-bottom: 1px solid #e0ebf8;
          padding-bottom: 6px;
        }

        .list-header h3 {
          margin: 0;
          font-size: 13px;
          color: #15395f;
        }

        .list-header span {
          font-size: 11px;
          color: #5b7088;
        }

        .capture-list {
          list-style: none;
          margin: 0;
          padding: 0;
          overflow: auto;
          display: grid;
          gap: 7px;
          min-height: 0;
        }

        .capture-item {
          border: 1px solid #d4e1f0;
          border-radius: 9px;
          background: #f9fbff;
          padding: 6px;
          display: grid;
          gap: 5px;
          cursor: pointer;
        }

        .capture-item:hover {
          border-color: #1a73e8;
        }

        .capture-item.active {
          border-color: #1a73e8;
          background: #eff5ff;
        }

        .capture-thumb {
          width: 100%;
          max-height: 88px;
          object-fit: cover;
          border: 1px solid #d3dfef;
          border-radius: 6px;
          background: #ffffff;
        }

        .capture-line {
          font-size: 11px;
          color: #15395f;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .capture-meta {
          font-size: 10px;
          color: #60758e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .empty-list {
          margin: 0;
          font-size: 11px;
          color: #60758e;
          text-align: center;
          border: 1px dashed #d2deee;
          border-radius: 8px;
          padding: 10px;
        }

        .editor-modal {
          position: fixed;
          inset: 0;
          background: rgba(8, 18, 33, 0.62);
          backdrop-filter: blur(2px);
          display: none;
          align-items: center;
          justify-content: center;
          padding: 18px;
          pointer-events: auto;
        }

        .editor-modal.open {
          display: flex;
        }

        .editor-card {
          width: min(980px, calc(100vw - 24px));
          max-height: calc(100vh - 28px);
          overflow: auto;
          border: 1px solid #c7d7ec;
          border-radius: 16px;
          background: linear-gradient(180deg, #f8fbff 0%, #edf4fc 100%);
          box-shadow: 0 28px 56px rgba(8, 21, 40, 0.42);
          padding: 12px;
          display: grid;
          gap: 10px;
        }

        .editor-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid #d6e4f4;
        }

        .editor-header h3 {
          margin: 0;
          font-size: 20px;
          color: #12395f;
          letter-spacing: 0.01em;
        }

        .editor-header p {
          margin: 4px 0 0;
          font-size: 12px;
          color: #5b7088;
        }

        .toolbar {
          border: 1px solid #d0deee;
          border-radius: 11px;
          background: #ffffff;
          padding: 8px;
          display: grid;
          gap: 7px;
        }

        .tool-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }

        .tool-btn {
          background: #e7f0fd;
          color: #17416c;
          padding: 7px 10px;
          font-size: 12px;
          border-radius: 8px;
        }

        .tool-btn.active {
          background: #1a73e8;
          color: #ffffff;
        }

        .field {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 8px;
          border: 1px solid #d0deee;
          border-radius: 8px;
          font-size: 11px;
          color: #36597b;
          background: #f8fbff;
        }

        .field input[type="color"] {
          width: 22px;
          height: 18px;
          border: none;
          background: transparent;
          padding: 0;
        }

        .field input[type="range"] {
          width: 110px;
        }

        .canvas-wrap {
          border: 1px solid #d0dfee;
          border-radius: 11px;
          background: #ffffff;
          padding: 8px;
          max-height: 56vh;
          overflow: auto;
        }

        .canvas {
          display: block;
          margin: 0 auto;
          border-radius: 8px;
          touch-action: none;
          cursor: crosshair;
        }

        .note-label {
          font-size: 13px;
          font-weight: 700;
          color: #244a73;
        }

        .note-input {
          width: 100%;
          min-height: 120px;
          border: 1px solid #c8d7eb;
          border-radius: 10px;
          padding: 10px;
          resize: vertical;
          font-size: 14px;
          line-height: 1.45;
          color: #1a395d;
          background: #ffffff;
        }

        .note-input:focus {
          outline: 2px solid rgba(26, 115, 232, 0.25);
          border-color: #1a73e8;
        }

        .editor-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        .danger {
          background: #fae9e9;
          color: #b3261e;
        }

        .danger:hover:not(:disabled) {
          background: #f8dcdc;
        }

        @media (max-width: 900px) {
          .panel {
            width: min(370px, calc(100vw - 18px));
          }

          .editor-card {
            width: calc(100vw - 14px);
            max-height: calc(100vh - 14px);
            border-radius: 12px;
          }

          .canvas-wrap {
            max-height: 46vh;
          }
        }
      </style>

      <button id="launcherBtn" class="launcher" type="button" title="Open QuillDock">
        <img src="${chrome.runtime.getURL("icons/icon48.png")}" alt="QuillDock" style="width: 24px; height: 24px; display: block;" />
      </button>

      <aside id="panel" class="panel" aria-label="QuillDock sidebar">
        <header class="panel-header">
          <div class="panel-title-wrap">
            <h2 class="panel-title">QuillDock Capture</h2>
            <p class="panel-subtitle">Capture and document while browsing.</p>
          </div>
          <button id="closePanelBtn" class="close-btn" type="button">Close</button>
        </header>

        <section class="capture-controls">
          <button id="captureVisibleBtn" class="primary" type="button">Visible</button>
          <button id="captureSelectionBtn" class="primary" type="button">Selection</button>
          <button id="captureFullBtn" class="primary" type="button">Full Page</button>
        </section>

        <section class="panel-actions">
          <button id="openReviewBtn" class="ghost" type="button">Open Workspace</button>
        </section>

        <p id="statusText" class="status" role="status">Ready.</p>

        <section class="list-section">
          <div class="list-header">
            <h3>Captured Screens</h3>
            <span id="captureCount">0 captures</span>
          </div>
          <ul id="captureList" class="capture-list"></ul>
          <p id="emptyList" class="empty-list">No captures yet.</p>
        </section>
      </aside>

      <div id="editorModal" class="editor-modal" role="dialog" aria-modal="true">
        <article class="editor-card">
          <header class="editor-header">
            <div>
              <h3 id="modalTitle">Review Capture</h3>
              <p id="modalHint">Annotate and add notes before saving to workspace.</p>
            </div>
            <button id="modalCloseBtn" class="ghost" type="button">Close</button>
          </header>

          <section class="toolbar">
            <div class="tool-row">
              <button id="modalPenBtn" class="tool-btn active" type="button">Pen</button>
              <button id="modalRectBtn" class="tool-btn" type="button">Rectangle</button>
              <button id="modalArrowBtn" class="tool-btn" type="button">Arrow</button>
              <button id="modalTextBtn" class="tool-btn" type="button">Text</button>
            </div>

            <div class="tool-row">
              <label class="field">
                <span>Color</span>
                <input id="modalStrokeColorInput" type="color" value="#ff0000" />
              </label>

              <label class="field">
                <span>Size</span>
                <input id="modalStrokeWidthInput" type="range" min="1" max="14" step="1" value="3" />
              </label>

              <button id="modalUndoBtn" class="ghost" type="button">Undo</button>
              <button id="modalClearBtn" class="ghost" type="button">Clear</button>
            </div>
          </section>

          <div id="modalCanvasWrap" class="canvas-wrap">
            <canvas id="modalCanvas" class="canvas" aria-label="Capture editor canvas"></canvas>
          </div>

          <label for="modalNoteInput" class="note-label">Add Notes</label>
          <textarea
            id="modalNoteInput"
            class="note-input"
            placeholder="Write documentation notes for this screenshot..."
          ></textarea>

          <footer class="editor-footer">
            <button id="modalDiscardBtn" class="danger" type="button">Discard</button>
            <button id="modalSaveBtn" class="primary" type="button">Save To Workspace</button>
          </footer>
        </article>
      </div>
    `;

    refs.launcherBtn = refs.shadow.getElementById("launcherBtn");
    refs.panel = refs.shadow.getElementById("panel");
    refs.closePanelBtn = refs.shadow.getElementById("closePanelBtn");
    refs.captureVisibleBtn = refs.shadow.getElementById("captureVisibleBtn");
    refs.captureSelectionBtn = refs.shadow.getElementById(
      "captureSelectionBtn",
    );
    refs.captureFullBtn = refs.shadow.getElementById("captureFullBtn");
    refs.openReviewBtn = refs.shadow.getElementById("openReviewBtn");
    refs.statusText = refs.shadow.getElementById("statusText");
    refs.captureCount = refs.shadow.getElementById("captureCount");
    refs.captureList = refs.shadow.getElementById("captureList");
    refs.emptyList = refs.shadow.getElementById("emptyList");

    refs.modal = refs.shadow.getElementById("editorModal");
    refs.modalCloseBtn = refs.shadow.getElementById("modalCloseBtn");
    refs.modalTitle = refs.shadow.getElementById("modalTitle");
    refs.modalHint = refs.shadow.getElementById("modalHint");
    refs.modalPenBtn = refs.shadow.getElementById("modalPenBtn");
    refs.modalRectBtn = refs.shadow.getElementById("modalRectBtn");
    refs.modalArrowBtn = refs.shadow.getElementById("modalArrowBtn");
    refs.modalTextBtn = refs.shadow.getElementById("modalTextBtn");
    refs.modalStrokeColorInput = refs.shadow.getElementById(
      "modalStrokeColorInput",
    );
    refs.modalStrokeWidthInput = refs.shadow.getElementById(
      "modalStrokeWidthInput",
    );
    refs.modalUndoBtn = refs.shadow.getElementById("modalUndoBtn");
    refs.modalClearBtn = refs.shadow.getElementById("modalClearBtn");
    refs.modalCanvasWrap = refs.shadow.getElementById("modalCanvasWrap");
    refs.modalCanvas = refs.shadow.getElementById("modalCanvas");
    refs.modalNoteInput = refs.shadow.getElementById("modalNoteInput");
    refs.modalDiscardBtn = refs.shadow.getElementById("modalDiscardBtn");
    refs.modalSaveBtn = refs.shadow.getElementById("modalSaveBtn");

    refs.modalCanvasCtx = refs.modalCanvas.getContext("2d");

    document.documentElement.appendChild(refs.host);
  }

  function bindUiEvents() {
    refs.launcherBtn.addEventListener("click", () => setPanelOpen(true));
    refs.closePanelBtn.addEventListener("click", () => setPanelOpen(false));

    refs.captureVisibleBtn.addEventListener("click", () => {
      captureAndOpenDraft("capture-visible").catch((error) => {
        setStatus(error?.message || "Capture failed.", true);
      });
    });

    refs.captureSelectionBtn.addEventListener("click", () => {
      captureAndOpenDraft("capture-selection").catch((error) => {
        setStatus(error?.message || "Capture failed.", true);
      });
    });

    refs.captureFullBtn.addEventListener("click", () => {
      captureAndOpenDraft("capture-fullpage").catch((error) => {
        setStatus(error?.message || "Capture failed.", true);
      });
    });

    refs.openReviewBtn.addEventListener("click", () => {
      openReviewWorkspace().catch((error) => {
        setStatus(error?.message || "Failed to open workspace.", true);
      });
    });

    refs.modalCloseBtn.addEventListener("click", () => {
      closeModalByUser().catch((error) => {
        setStatus(error?.message || "Unable to close modal.", true);
      });
    });

    refs.modalDiscardBtn.addEventListener("click", () => {
      discardModalCapture().catch((error) => {
        setStatus(error?.message || "Failed to discard capture.", true);
      });
    });

    refs.modalSaveBtn.addEventListener("click", () => {
      saveModalCapture().catch((error) => {
        setStatus(error?.message || "Failed to save capture.", true);
      });
    });

    refs.modalPenBtn.addEventListener("click", () => setModalTool(TOOL_PEN));
    refs.modalRectBtn.addEventListener("click", () => setModalTool(TOOL_RECT));
    refs.modalArrowBtn.addEventListener("click", () =>
      setModalTool(TOOL_ARROW),
    );
    refs.modalTextBtn.addEventListener("click", () => setModalTool(TOOL_TEXT));

    refs.modalUndoBtn.addEventListener("click", undoModalShape);
    refs.modalClearBtn.addEventListener("click", clearModalShapes);

    refs.modalCanvas.addEventListener("pointerdown", onModalPointerDown);
    refs.modalCanvas.addEventListener("pointermove", onModalPointerMove);
    window.addEventListener("pointerup", onModalPointerUp);
    window.addEventListener("pointercancel", onModalPointerUp);

    refs.modal.addEventListener("mousedown", (event) => {
      if (event.target === refs.modal) {
        closeModalByUser().catch((error) => {
          setStatus(error?.message || "Unable to close modal.", true);
        });
      }
    });

    window.addEventListener("resize", () => {
      if (!state.modal.open || !state.modal.baseImage) {
        return;
      }
      applyModalCanvasSize();
      redrawModalCanvas();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.modal.open) {
        closeModalByUser().catch((error) => {
          setStatus(error?.message || "Unable to close modal.", true);
        });
      }
    });
  }

  async function captureAndOpenDraft(type) {
    setBusy(true);
    setStatus("Capturing...", false);

    try {
      const response = await requestBackground({ type });
      if (!response?.capture?.id) {
        throw new Error("Capture did not return image data.");
      }

      await refreshCaptures({ selectCaptureId: response.capture.id });
      await openCaptureEditor(response.capture.id, true);
      setStatus("Capture ready. Save or discard from modal.", false);
    } catch (error) {
      if (
        String(error?.message || "")
          .toLowerCase()
          .includes("canceled")
      ) {
        setStatus("Capture canceled.", false);
      } else {
        throw error;
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshCaptures({ selectCaptureId = null } = {}) {
    const response = await requestBackground({ type: "get-captures" });
    const sorted = [...(response.captures || [])].sort(
      (a, b) => b.createdAt - a.createdAt,
    );

    state.captures = sorted;

    if (sorted.length === 0) {
      state.selectedCaptureId = null;
    } else if (
      selectCaptureId &&
      sorted.some((capture) => capture.id === selectCaptureId)
    ) {
      state.selectedCaptureId = selectCaptureId;
    } else if (
      state.selectedCaptureId &&
      sorted.some((capture) => capture.id === state.selectedCaptureId)
    ) {
      // keep current selection
    } else {
      state.selectedCaptureId = sorted[0].id;
    }

    renderCaptureList();
    updateControlState();
  }

  function renderCaptureList() {
    refs.captureList.textContent = "";

    for (const [index, capture] of state.captures.entries()) {
      const li = document.createElement("li");
      li.className = "capture-item";
      li.dataset.captureId = capture.id;
      if (capture.id === state.selectedCaptureId) {
        li.classList.add("active");
      }

      const thumb = document.createElement("img");
      thumb.className = "capture-thumb";
      thumb.src = capture.imageData;
      thumb.alt = `Capture ${index + 1}`;

      const title = document.createElement("div");
      title.className = "capture-line";
      title.textContent = `${index + 1}. ${capture.title || "Untitled Page"}`;

      const meta = document.createElement("div");
      meta.className = "capture-meta";
      meta.textContent = `${formatCaptureType(capture.captureType)} • ${new Date(
        capture.createdAt,
      ).toLocaleString()}`;

      const note = document.createElement("div");
      note.className = "capture-meta";
      note.textContent = capture.note
        ? capture.note.replace(/\s+/g, " ").trim().slice(0, 80)
        : "No notes";

      li.append(thumb, title, meta, note);
      li.addEventListener("click", () => {
        openCaptureEditor(capture.id, false).catch((error) => {
          setStatus(error?.message || "Failed to open capture.", true);
        });
      });

      refs.captureList.appendChild(li);
    }

    refs.emptyList.style.display =
      state.captures.length === 0 ? "block" : "none";
    refs.captureCount.textContent = `${state.captures.length} capture${
      state.captures.length === 1 ? "" : "s"
    }`;
  }

  async function openCaptureEditor(captureId, isDraftCapture) {
    const capture = state.captures.find((item) => item.id === captureId);
    if (!capture) {
      return;
    }

    state.selectedCaptureId = captureId;
    renderCaptureList();

    state.modal.open = true;
    state.modal.captureId = captureId;
    state.modal.isDraftCapture = Boolean(isDraftCapture);
    state.modal.originalImageData = capture.imageData;
    state.modal.originalNote = capture.note || "";
    state.modal.shapes = [];
    state.modal.activeShape = null;
    state.modal.pointerId = null;
    state.modal.busy = false;

    refs.modalTitle.textContent = isDraftCapture
      ? "Review New Capture"
      : "Edit Capture";
    refs.modalHint.textContent = isDraftCapture
      ? "Annotate and add notes now. Save to workspace or discard."
      : "Update your screenshot annotations and notes.";
    refs.modalSaveBtn.textContent = isDraftCapture
      ? "Save To Workspace"
      : "Save Changes";
    refs.modalDiscardBtn.textContent = isDraftCapture
      ? "Discard Capture"
      : "Discard Changes";

    refs.modalNoteInput.value = state.modal.originalNote;

    refs.modal.classList.add("open");
    await nextFrame();

    await loadModalImage(capture.imageData);
    setModalTool(TOOL_PEN);
    redrawModalCanvas();
    updateControlState();
  }

  async function closeModalByUser() {
    if (!state.modal.open || state.modal.busy) {
      return;
    }

    if (state.modal.isDraftCapture) {
      const shouldDiscard = window.confirm("Discard this new capture?");
      if (!shouldDiscard) {
        return;
      }
      await discardModalCapture();
      return;
    }

    closeModalState();
    setStatus("Changes not saved.", false);
  }

  async function discardModalCapture() {
    if (!state.modal.open || state.modal.busy || !state.modal.captureId) {
      return;
    }

    if (!state.modal.isDraftCapture) {
      closeModalState();
      setStatus("Changes discarded.", false);
      return;
    }

    setModalBusy(true);

    try {
      await requestBackground({
        type: "delete-capture",
        id: state.modal.captureId,
      });
      closeModalState();
      await refreshCaptures();
      setStatus("Capture discarded.", false);
    } finally {
      setModalBusy(false);
    }
  }

  async function saveModalCapture() {
    if (!state.modal.open || state.modal.busy || !state.modal.captureId) {
      return;
    }

    setModalBusy(true);

    try {
      const note = refs.modalNoteInput.value;
      const updates = { note };

      if (state.modal.shapes.length > 0) {
        updates.imageData = await renderModalAnnotatedImageData();
      }

      await requestBackground({
        type: "update-capture",
        id: state.modal.captureId,
        updates,
      });

      const savedId = state.modal.captureId;
      const wasDraft = state.modal.isDraftCapture;

      closeModalState();
      await refreshCaptures({ selectCaptureId: savedId });
      setStatus(wasDraft ? "Saved to workspace." : "Capture updated.", false);
    } finally {
      setModalBusy(false);
    }
  }

  function closeModalState() {
    refs.modal.classList.remove("open");

    state.modal.open = false;
    state.modal.captureId = null;
    state.modal.isDraftCapture = false;
    state.modal.originalImageData = "";
    state.modal.originalNote = "";
    state.modal.baseImage = null;
    state.modal.naturalWidth = 0;
    state.modal.naturalHeight = 0;
    state.modal.renderWidth = 0;
    state.modal.renderHeight = 0;
    state.modal.shapes = [];
    state.modal.activeShape = null;
    state.modal.pointerId = null;

    refs.modalCanvas.width = 1;
    refs.modalCanvas.height = 1;
    refs.modalCanvasCtx.clearRect(0, 0, 1, 1);

    updateControlState();
  }

  async function openReviewWorkspace() {
    await requestBackground({
      type: "open-review-page",
      captureId: state.selectedCaptureId,
    });
  }

  async function requestBackground(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      throw new Error(response?.error || "Extension request failed.");
    }
    return response;
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    updateControlState();
  }

  function setModalBusy(isBusy) {
    state.modal.busy = isBusy;
    updateControlState();
  }

  function updateControlState() {
    const hasCaptures = state.captures.length > 0;
    const modalHasImage = Boolean(state.modal.baseImage);

    refs.captureVisibleBtn.disabled = state.busy || state.modal.busy;
    refs.captureSelectionBtn.disabled = state.busy || state.modal.busy;
    refs.captureFullBtn.disabled = state.busy || state.modal.busy;
    refs.openReviewBtn.disabled =
      state.busy || state.modal.busy || !hasCaptures;

    refs.modalCloseBtn.disabled = state.modal.busy;
    refs.modalDiscardBtn.disabled = state.modal.busy;
    refs.modalSaveBtn.disabled = state.modal.busy || !state.modal.captureId;
    refs.modalNoteInput.disabled = state.modal.busy || !state.modal.captureId;

    refs.modalPenBtn.disabled = state.modal.busy || !modalHasImage;
    refs.modalRectBtn.disabled = state.modal.busy || !modalHasImage;
    refs.modalArrowBtn.disabled = state.modal.busy || !modalHasImage;
    refs.modalTextBtn.disabled = state.modal.busy || !modalHasImage;
    refs.modalStrokeColorInput.disabled = state.modal.busy || !modalHasImage;
    refs.modalStrokeWidthInput.disabled = state.modal.busy || !modalHasImage;
    refs.modalUndoBtn.disabled =
      state.modal.busy || !modalHasImage || state.modal.shapes.length === 0;
    refs.modalClearBtn.disabled =
      state.modal.busy || !modalHasImage || state.modal.shapes.length === 0;

    refs.modalCanvas.style.pointerEvents =
      state.modal.busy || !modalHasImage ? "none" : "auto";
  }

  function setStatus(text, isError) {
    refs.statusText.textContent = text;
    refs.statusText.style.color = isError ? "#b3261e" : "#5c7188";
  }

  function setPanelOpen(isOpen) {
    state.panelOpen = isOpen;
    refs.panel.classList.toggle("open", isOpen);
    refs.launcherBtn.style.display = isOpen ? "none" : "grid";
  }

  function togglePanel() {
    setPanelOpen(!state.panelOpen);
  }

  function prepareUiForCapture() {
    if (!refs.host || uiHiddenForCapture) {
      return;
    }

    uiHiddenWasOpen = state.panelOpen;
    uiHiddenForCapture = true;

    refs.host.style.display = "none";
  }

  function restoreUiAfterCapture() {
    if (!refs.host || !uiHiddenForCapture) {
      return;
    }

    refs.host.style.display = "";
    setPanelOpen(uiHiddenWasOpen);

    uiHiddenForCapture = false;
    uiHiddenWasOpen = false;
  }

  function setModalTool(tool) {
    state.modal.currentTool = tool;

    refs.modalPenBtn.classList.toggle("active", tool === TOOL_PEN);
    refs.modalRectBtn.classList.toggle("active", tool === TOOL_RECT);
    refs.modalArrowBtn.classList.toggle("active", tool === TOOL_ARROW);
    refs.modalTextBtn.classList.toggle("active", tool === TOOL_TEXT);
  }

  function getModalStyle() {
    return {
      color: refs.modalStrokeColorInput.value || "#ff0000",
      width: Number(refs.modalStrokeWidthInput.value) || 3,
    };
  }

  function onModalPointerDown(event) {
    if (!state.modal.open || !state.modal.baseImage || state.modal.busy) {
      return;
    }

    event.preventDefault();
    const point = getModalPoint(event);

    if (state.modal.currentTool === TOOL_TEXT) {
      const textInput = window.prompt("Enter text annotation:");
      const text = textInput ? textInput.trim() : "";
      if (text) {
        const style = getModalStyle();
        state.modal.shapes.push({
          type: TOOL_TEXT,
          color: style.color,
          width: style.width,
          text,
          x: point.x,
          y: point.y,
        });
        redrawModalCanvas();
        updateControlState();
      }
      return;
    }

    state.modal.pointerId = event.pointerId;
    refs.modalCanvas.setPointerCapture(event.pointerId);

    const style = getModalStyle();
    if (state.modal.currentTool === TOOL_PEN) {
      state.modal.activeShape = {
        type: TOOL_PEN,
        color: style.color,
        width: style.width,
        points: [point],
      };
    } else {
      state.modal.activeShape = {
        type: state.modal.currentTool,
        color: style.color,
        width: style.width,
        start: point,
        end: point,
      };
    }

    redrawModalCanvas();
  }

  function onModalPointerMove(event) {
    if (!state.modal.activeShape || state.modal.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    const point = getModalPoint(event);
    if (state.modal.activeShape.type === TOOL_PEN) {
      const last =
        state.modal.activeShape.points[
          state.modal.activeShape.points.length - 1
        ];
      if (!last || distance(last, point) >= 1.2) {
        state.modal.activeShape.points.push(point);
      }
    } else {
      state.modal.activeShape.end = point;
    }

    redrawModalCanvas();
  }

  function onModalPointerUp(event) {
    if (!state.modal.activeShape || state.modal.pointerId !== event.pointerId) {
      return;
    }

    const point = getModalPoint(event);
    if (state.modal.activeShape.type === TOOL_PEN) {
      const last =
        state.modal.activeShape.points[
          state.modal.activeShape.points.length - 1
        ];
      if (!last || distance(last, point) >= 1.2) {
        state.modal.activeShape.points.push(point);
      }
    } else {
      state.modal.activeShape.end = point;
    }

    if (isMeaningfulShape(state.modal.activeShape)) {
      state.modal.shapes.push(state.modal.activeShape);
    }

    state.modal.activeShape = null;
    state.modal.pointerId = null;

    try {
      refs.modalCanvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // ignore pointer release errors
    }

    redrawModalCanvas();
    updateControlState();
  }

  function undoModalShape() {
    if (state.modal.shapes.length === 0 || state.modal.busy) {
      return;
    }

    state.modal.shapes.pop();
    redrawModalCanvas();
    updateControlState();
  }

  function clearModalShapes() {
    if (state.modal.shapes.length === 0 || state.modal.busy) {
      return;
    }

    state.modal.shapes = [];
    state.modal.activeShape = null;
    redrawModalCanvas();
    updateControlState();
  }

  async function loadModalImage(dataUrl) {
    const image = await loadImage(dataUrl);

    state.modal.baseImage = image;
    state.modal.naturalWidth = image.naturalWidth || image.width;
    state.modal.naturalHeight = image.naturalHeight || image.height;

    applyModalCanvasSize();
  }

  function applyModalCanvasSize() {
    if (!state.modal.naturalWidth || !state.modal.naturalHeight) {
      return;
    }

    const maxWidth = Math.max(320, refs.modalCanvasWrap.clientWidth - 16);
    const maxHeight = Math.max(
      240,
      Math.min(
        window.innerHeight * 0.56,
        refs.modalCanvasWrap.clientHeight - 16,
      ),
    );

    const scale = Math.min(
      1,
      maxWidth / state.modal.naturalWidth,
      maxHeight / state.modal.naturalHeight,
    );

    let width = Math.max(1, Math.floor(state.modal.naturalWidth * scale));
    let height = Math.max(1, Math.floor(state.modal.naturalHeight * scale));

    if (width * height > MAX_PREVIEW_PIXELS) {
      const ratio = Math.sqrt(MAX_PREVIEW_PIXELS / (width * height));
      width = Math.max(1, Math.floor(width * ratio));
      height = Math.max(1, Math.floor(height * ratio));
    }

    if (height > MAX_PREVIEW_HEIGHT) {
      const ratio = MAX_PREVIEW_HEIGHT / height;
      width = Math.max(1, Math.floor(width * ratio));
      height = MAX_PREVIEW_HEIGHT;
    }

    state.modal.renderWidth = width;
    state.modal.renderHeight = height;

    refs.modalCanvas.width = width;
    refs.modalCanvas.height = height;
    refs.modalCanvas.style.width = `${width}px`;
    refs.modalCanvas.style.height = `${height}px`;
  }

  function redrawModalCanvas() {
    if (
      !state.modal.baseImage ||
      state.modal.renderWidth <= 0 ||
      state.modal.renderHeight <= 0 ||
      !refs.modalCanvasCtx
    ) {
      return;
    }

    refs.modalCanvasCtx.clearRect(
      0,
      0,
      state.modal.renderWidth,
      state.modal.renderHeight,
    );
    refs.modalCanvasCtx.drawImage(
      state.modal.baseImage,
      0,
      0,
      state.modal.renderWidth,
      state.modal.renderHeight,
    );

    const previewScale = state.modal.renderWidth / state.modal.naturalWidth;

    for (const shape of state.modal.shapes) {
      drawShape(refs.modalCanvasCtx, shape, previewScale);
    }

    if (state.modal.activeShape) {
      drawShape(refs.modalCanvasCtx, state.modal.activeShape, previewScale);
    }
  }

  function drawShape(ctx, shape, scale) {
    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.color;
    ctx.lineWidth = shape.width * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (shape.type === TOOL_PEN) {
      if (!shape.points || shape.points.length === 0) {
        ctx.restore();
        return;
      }

      ctx.beginPath();
      ctx.moveTo(shape.points[0].x * scale, shape.points[0].y * scale);
      for (let i = 1; i < shape.points.length; i += 1) {
        const point = shape.points[i];
        ctx.lineTo(point.x * scale, point.y * scale);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (shape.type === TOOL_RECT) {
      const left = Math.min(shape.start.x, shape.end.x) * scale;
      const top = Math.min(shape.start.y, shape.end.y) * scale;
      const width = Math.abs(shape.end.x - shape.start.x) * scale;
      const height = Math.abs(shape.end.y - shape.start.y) * scale;
      ctx.strokeRect(left, top, width, height);
      ctx.restore();
      return;
    }

    if (shape.type === TOOL_TEXT) {
      const fontSize = Math.max(14, shape.width * 6) * scale;
      ctx.font = `700 ${fontSize}px "Avenir Next", "Segoe UI", sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(shape.text, shape.x * scale, shape.y * scale);
      ctx.restore();
      return;
    }

    if (shape.type === TOOL_ARROW) {
      const startX = shape.start.x * scale;
      const startY = shape.start.y * scale;
      const endX = shape.end.x * scale;
      const endY = shape.end.y * scale;
      drawArrow(ctx, startX, startY, endX, endY, shape.width * scale);
      ctx.restore();
    }
  }

  function drawArrow(ctx, startX, startY, endX, endY, lineWidth) {
    const headLength = Math.max(10, lineWidth * 4);
    const angle = Math.atan2(endY - startY, endX - startX);

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle - Math.PI / 6),
      endY - headLength * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      endX - headLength * Math.cos(angle + Math.PI / 6),
      endY - headLength * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();
  }

  function getModalPoint(event) {
    const rect = refs.modalCanvas.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      !state.modal.naturalWidth ||
      !state.modal.naturalHeight
    ) {
      return { x: 0, y: 0 };
    }

    const x = clamp(
      (event.clientX - rect.left) * (state.modal.naturalWidth / rect.width),
      0,
      state.modal.naturalWidth,
    );
    const y = clamp(
      (event.clientY - rect.top) * (state.modal.naturalHeight / rect.height),
      0,
      state.modal.naturalHeight,
    );

    return { x, y };
  }

  function isMeaningfulShape(shape) {
    if (shape.type === TOOL_TEXT) {
      return Boolean(shape.text && shape.text.trim());
    }

    if (shape.type === TOOL_PEN) {
      return Array.isArray(shape.points) && shape.points.length > 1;
    }

    if (shape.type === TOOL_RECT || shape.type === TOOL_ARROW) {
      const dx = Math.abs(shape.end.x - shape.start.x);
      const dy = Math.abs(shape.end.y - shape.start.y);
      return dx >= 4 || dy >= 4;
    }

    return false;
  }

  async function renderModalAnnotatedImageData() {
    if (
      !state.modal.baseImage ||
      !state.modal.naturalWidth ||
      !state.modal.naturalHeight
    ) {
      throw new Error("No screenshot loaded in editor.");
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = state.modal.naturalWidth;
    exportCanvas.height = state.modal.naturalHeight;

    const exportCtx = exportCanvas.getContext("2d", { alpha: false });
    exportCtx.fillStyle = "#ffffff";
    exportCtx.fillRect(
      0,
      0,
      state.modal.naturalWidth,
      state.modal.naturalHeight,
    );
    exportCtx.drawImage(
      state.modal.baseImage,
      0,
      0,
      state.modal.naturalWidth,
      state.modal.naturalHeight,
    );

    for (const shape of state.modal.shapes) {
      drawShape(exportCtx, shape, 1);
    }

    return exportCanvas.toDataURL("image/png");
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to load image."));
      image.src = dataUrl;
    });
  }

  function nextFrame() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  function formatCaptureType(captureType) {
    const labels = {
      visible: "Visible",
      selection: "Selection",
      fullpage: "Full Page",
    };

    return labels[captureType] || "Capture";
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function createAreaSelectionTask() {
    let resolveTask;
    const promise = new Promise((resolve) => {
      resolveTask = resolve;
    });

    const overlay = document.createElement("div");
    overlay.setAttribute("data-webdoc-overlay", "true");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.cursor = "crosshair";
    overlay.style.background = "rgba(32, 48, 68, 0.12)";
    overlay.style.userSelect = "none";

    const hint = document.createElement("div");
    hint.textContent = "Drag to select area. Press Esc to cancel.";
    hint.style.position = "fixed";
    hint.style.top = "16px";
    hint.style.left = "50%";
    hint.style.transform = "translateX(-50%)";
    hint.style.padding = "8px 12px";
    hint.style.borderRadius = "8px";
    hint.style.background = "rgba(19, 26, 37, 0.9)";
    hint.style.color = "#f0f5ff";
    hint.style.fontFamily =
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
    hint.style.fontSize = "12px";
    hint.style.letterSpacing = "0.03em";

    const selectionBox = document.createElement("div");
    selectionBox.style.position = "fixed";
    selectionBox.style.border = "2px solid #1a73e8";
    selectionBox.style.background = "rgba(26, 115, 232, 0.18)";
    selectionBox.style.display = "none";
    selectionBox.style.pointerEvents = "none";

    overlay.appendChild(hint);
    overlay.appendChild(selectionBox);
    document.documentElement.appendChild(overlay);

    let dragStart = null;
    let latestPoint = null;
    let isDone = false;

    function stopEvent(event) {
      event.preventDefault();
      event.stopPropagation();
    }

    function normalizeRect(start, end) {
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);

      return {
        x: left,
        y: top,
        width,
        height,
        devicePixelRatio: window.devicePixelRatio || 1,
      };
    }

    function drawRect(start, end) {
      const rect = normalizeRect(start, end);
      selectionBox.style.display = "block";
      selectionBox.style.left = `${rect.x}px`;
      selectionBox.style.top = `${rect.y}px`;
      selectionBox.style.width = `${rect.width}px`;
      selectionBox.style.height = `${rect.height}px`;
    }

    function cleanup() {
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.removeEventListener("pointerdown", onPointerDown, true);
      overlay.removeEventListener("pointermove", onPointerMove, true);
      overlay.removeEventListener("pointerup", onPointerUp, true);
      overlay.removeEventListener("pointercancel", onPointerCancel, true);
      overlay.removeEventListener("contextmenu", stopEvent, true);

      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }

    function finish(result) {
      if (isDone) {
        return;
      }

      isDone = true;
      cleanup();
      resolveTask(result);
    }

    function cancelWithMessage(message) {
      finish({
        ok: false,
        canceled: true,
        error: message || "Selection canceled.",
      });
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        stopEvent(event);
        cancelWithMessage("Selection canceled.");
      }
    }

    function onPointerDown(event) {
      stopEvent(event);
      dragStart = { x: event.clientX, y: event.clientY };
      latestPoint = dragStart;
      drawRect(dragStart, latestPoint);
    }

    function onPointerMove(event) {
      if (!dragStart) {
        return;
      }

      stopEvent(event);
      latestPoint = { x: event.clientX, y: event.clientY };
      drawRect(dragStart, latestPoint);
    }

    function onPointerUp(event) {
      if (!dragStart) {
        return;
      }

      stopEvent(event);
      latestPoint = { x: event.clientX, y: event.clientY };

      const rect = normalizeRect(dragStart, latestPoint);
      if (rect.width < 8 || rect.height < 8) {
        cancelWithMessage("Selection is too small.");
        return;
      }

      finish({ ok: true, bounds: rect });
    }

    function onPointerCancel(event) {
      stopEvent(event);
      cancelWithMessage("Selection canceled.");
    }

    document.addEventListener("keydown", onKeyDown, true);
    overlay.addEventListener("pointerdown", onPointerDown, true);
    overlay.addEventListener("pointermove", onPointerMove, true);
    overlay.addEventListener("pointerup", onPointerUp, true);
    overlay.addEventListener("pointercancel", onPointerCancel, true);
    overlay.addEventListener("contextmenu", stopEvent, true);

    return {
      promise,
      cancel: () => cancelWithMessage("Selection restarted."),
    };
  }
})();
