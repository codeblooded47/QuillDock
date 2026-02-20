import {
  clearCaptures,
  deleteCapture,
  getAllCaptures,
  reorderCaptures,
  updateCapture
} from "./db.js";

const META_KEY = "website_doc_meta";
const DEFAULT_TEMPLATE_ID = "classic";
const PDF_TEMPLATES = [
  {
    id: "classic",
    className: "template-classic",
    name: "Classic Brief",
    description: "Google-Docs-like structure for polished team handoff documents."
  },
  {
    id: "spotlight",
    className: "template-spotlight",
    name: "Spotlight Guide",
    description: "Bold callouts with strong section framing for feature walkthroughs."
  },
  {
    id: "dossier",
    className: "template-dossier",
    name: "Dossier Notes",
    description: "Report-style layout with softer tones for audit and compliance docs."
  },
  {
    id: "blueprint",
    className: "template-blueprint",
    name: "Blueprint Flow",
    description: "Technical look with clean dividers and engineering-focused readability."
  }
];

const TOOL_PEN = "pen";
const TOOL_RECT = "rect";
const TOOL_ARROW = "arrow";
const TOOL_TEXT = "text";

const docTitleInput = document.getElementById("docTitleInput");
const docTitleHeading = document.getElementById("docTitleHeading");
const generatedMeta = document.getElementById("generatedMeta");
const introEditor = document.getElementById("introEditor");
const captureSummary = document.getElementById("captureSummary");
const captureList = document.getElementById("captureList");
const sectionsContainer = document.getElementById("sectionsContainer");
const sectionTemplate = document.getElementById("sectionTemplate");
const paper = document.getElementById("paper");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const refreshBtn = document.getElementById("refreshBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

const editorModal = document.getElementById("editorModal");
const modalCloseBtn = document.getElementById("modalCloseBtn");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalSaveBtn = document.getElementById("modalSaveBtn");
const modalCaptureTitle = document.getElementById("modalCaptureTitle");
const modalPenBtn = document.getElementById("modalPenBtn");
const modalRectBtn = document.getElementById("modalRectBtn");
const modalArrowBtn = document.getElementById("modalArrowBtn");
const modalTextBtn = document.getElementById("modalTextBtn");
const modalStrokeColorInput = document.getElementById("modalStrokeColorInput");
const modalStrokeWidthInput = document.getElementById("modalStrokeWidthInput");
const modalUndoBtn = document.getElementById("modalUndoBtn");
const modalClearBtn = document.getElementById("modalClearBtn");
const modalCanvasWrap = document.getElementById("modalCanvasWrap");
const modalCanvas = document.getElementById("modalCanvas");
const modalNoteInput = document.getElementById("modalNoteInput");
const templateModal = document.getElementById("templateModal");
const templateCloseBtn = document.getElementById("templateCloseBtn");
const templateList = document.getElementById("templateList");
const templatePreviewTitle = document.getElementById("templatePreviewTitle");
const templatePreviewDescription = document.getElementById("templatePreviewDescription");
const templatePreviewContent = document.getElementById("templatePreviewContent");
const templatePreviewBtn = document.getElementById("templatePreviewBtn");
const templateExportBtn = document.getElementById("templateExportBtn");

const modalCanvasCtx = modalCanvas.getContext("2d");

let captures = [];
let metaSaveTimer = null;
let noteSaveTimers = new Map();
let sidebarDragCaptureId = null;
let sidebarDropTargetId = null;
let sidebarDropPosition = "after";
let selectedTemplateId = DEFAULT_TEMPLATE_ID;
let modalTemplateSelectionId = DEFAULT_TEMPLATE_ID;

let pendingEditCaptureId = new URL(window.location.href).searchParams.get("editCaptureId");

let modalCaptureId = null;
let modalBusy = false;
let modalBaseImage = null;
let modalNaturalWidth = 0;
let modalNaturalHeight = 0;
let modalRenderWidth = 0;
let modalRenderHeight = 0;
let modalTool = TOOL_PEN;
let modalShapes = [];
let modalActiveShape = null;
let modalPointerId = null;

init().catch((error) => {
  console.error(error);
});

async function init() {
  bindEvents();
  await loadMeta();
  await renderAll();
  await maybeOpenCaptureFromQuery();
}

function bindEvents() {
  docTitleInput.addEventListener("input", () => {
    syncTitle();
    scheduleMetaSave();
  });

  introEditor.addEventListener("input", () => {
    scheduleMetaSave();
  });

  introEditor.addEventListener("blur", () => {
    normalizeEditor(introEditor);
  });

  exportPdfBtn.addEventListener("click", async () => {
    await persistMeta();
    await saveAllCurrentNotes();
    openTemplateModal();
  });

  refreshBtn.addEventListener("click", async () => {
    await renderAll();
  });

  clearAllBtn.addEventListener("click", async () => {
    const shouldClear = window.confirm("Delete every saved capture and note?");
    if (!shouldClear) {
      return;
    }

    await clearCaptures();
    closeEditorModal();
    closeTemplateModal();
    await renderAll();
  });

  modalCloseBtn.addEventListener("click", closeEditorModal);
  modalCancelBtn.addEventListener("click", closeEditorModal);
  modalSaveBtn.addEventListener("click", saveModalChanges);

  modalPenBtn.addEventListener("click", () => setModalTool(TOOL_PEN));
  modalRectBtn.addEventListener("click", () => setModalTool(TOOL_RECT));
  modalArrowBtn.addEventListener("click", () => setModalTool(TOOL_ARROW));
  modalTextBtn.addEventListener("click", () => setModalTool(TOOL_TEXT));
  modalUndoBtn.addEventListener("click", undoModalShape);
  modalClearBtn.addEventListener("click", clearModalShapes);

  modalCanvas.addEventListener("pointerdown", onModalPointerDown);
  modalCanvas.addEventListener("pointermove", onModalPointerMove);
  window.addEventListener("pointerup", onModalPointerUp);
  window.addEventListener("pointercancel", onModalPointerUp);

  templateCloseBtn.addEventListener("click", closeTemplateModal);
  templatePreviewBtn.addEventListener("click", async () => {
    await previewTemplateOnPage();
  });
  templateExportBtn.addEventListener("click", async () => {
    await exportSelectedTemplateAsPdf();
  });

  window.addEventListener("resize", () => {
    if (!isModalOpen() || !modalBaseImage) {
      return;
    }

    applyModalCanvasSize();
    redrawModalCanvas();
  });

  editorModal.addEventListener("mousedown", (event) => {
    if (event.target === editorModal) {
      closeEditorModal();
    }
  });

  templateModal.addEventListener("mousedown", (event) => {
    if (event.target === templateModal) {
      closeTemplateModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (isModalOpen()) {
      closeEditorModal();
      return;
    }

    if (isTemplateModalOpen()) {
      closeTemplateModal();
    }
  });
}

async function loadMeta() {
  const result = await chrome.storage.local.get(META_KEY);
  const meta = result[META_KEY] || {};

  docTitleInput.value = meta.title || "";
  introEditor.textContent = meta.overview || "";
  selectedTemplateId = normalizeTemplateId(meta.templateId);
  applyTemplateToPaper(selectedTemplateId);

  syncTitle();
  normalizeEditor(introEditor);
}

function syncTitle() {
  const title = docTitleInput.value.trim() || "Untitled Documentation";
  docTitleHeading.textContent = title;
}

function scheduleMetaSave() {
  if (metaSaveTimer) {
    clearTimeout(metaSaveTimer);
  }

  metaSaveTimer = setTimeout(() => {
    persistMeta().catch((error) => console.error(error));
  }, 350);
}

async function persistMeta() {
  if (metaSaveTimer) {
    clearTimeout(metaSaveTimer);
    metaSaveTimer = null;
  }

  await chrome.storage.local.set({
    [META_KEY]: {
      title: docTitleInput.value.trim(),
      overview: readEditorText(introEditor),
      templateId: selectedTemplateId
    }
  });

  syncTitle();
  updateGeneratedMeta();
}

async function renderAll() {
  captures = await getAllCaptures();
  renderSidebar();
  renderSections();
  captureSummary.textContent = `${captures.length} capture${captures.length === 1 ? "" : "s"}`;
  updateGeneratedMeta();
}

function renderSidebar() {
  captureList.textContent = "";

  captures.forEach((capture, index) => {
    const li = document.createElement("li");
    li.dataset.captureId = capture.id;
    li.draggable = true;

    const title = document.createElement("div");
    title.className = "list-title";
    title.textContent = `${index + 1}. ${capture.title || "Untitled Page"}`;

    const listRow = document.createElement("div");
    listRow.className = "list-row";

    const listActions = document.createElement("div");
    listActions.className = "list-actions";

    const moveUpBtn = document.createElement("button");
    moveUpBtn.type = "button";
    moveUpBtn.className = "ghost tiny sidebar-move-btn";
    moveUpBtn.textContent = "Up";
    moveUpBtn.draggable = false;
    moveUpBtn.disabled = index === 0;
    moveUpBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await handleAction("move-up", capture.id, index);
    });

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button";
    moveDownBtn.className = "ghost tiny sidebar-move-btn";
    moveDownBtn.textContent = "Down";
    moveDownBtn.draggable = false;
    moveDownBtn.disabled = index === captures.length - 1;
    moveDownBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await handleAction("move-down", capture.id, index);
    });

    listActions.append(moveUpBtn, moveDownBtn);
    listRow.append(title, listActions);

    const sub = document.createElement("div");
    sub.className = "list-sub";
    sub.textContent = `${formatCaptureType(capture.captureType)} • ${new Date(
      capture.createdAt
    ).toLocaleString()}`;

    li.append(listRow, sub);

    li.addEventListener("click", () => {
      const card = sectionsContainer.querySelector(`[data-capture-id="${capture.id}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    li.addEventListener("dragstart", (event) => {
      sidebarDragCaptureId = capture.id;
      li.classList.add("dragging");

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", capture.id);
      }
    });

    li.addEventListener("dragover", (event) => {
      if (!sidebarDragCaptureId || sidebarDragCaptureId === capture.id) {
        return;
      }

      event.preventDefault();

      const rect = li.getBoundingClientRect();
      const isBefore = event.clientY - rect.top < rect.height / 2;

      sidebarDropTargetId = capture.id;
      sidebarDropPosition = isBefore ? "before" : "after";

      li.classList.toggle("drop-before", isBefore);
      li.classList.toggle("drop-after", !isBefore);

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });

    li.addEventListener("dragleave", (event) => {
      if (event.relatedTarget && li.contains(event.relatedTarget)) {
        return;
      }
      li.classList.remove("drop-before", "drop-after");
    });

    li.addEventListener("drop", async (event) => {
      if (!sidebarDragCaptureId || sidebarDragCaptureId === capture.id) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const targetId = capture.id;
      const position = sidebarDropPosition || "after";

      await reorderFromSidebarDrag(sidebarDragCaptureId, targetId, position);
      clearSidebarDragState();
    });

    li.addEventListener("dragend", () => {
      clearSidebarDragState();
    });

    captureList.appendChild(li);
  });
}

function renderSections() {
  sectionsContainer.textContent = "";

  if (captures.length === 0) {
    const empty = document.createElement("p");
    empty.textContent =
      "No captures yet. Use the extension popup to capture visible area, selected area, or full page.";
    empty.style.color = "#58687a";
    sectionsContainer.appendChild(empty);
    return;
  }

  captures.forEach((capture, index) => {
    const fragment = sectionTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".section-card");
    const badge = fragment.querySelector(".capture-badge");
    const link = fragment.querySelector(".page-link");
    const timestamp = fragment.querySelector(".time-stamp");
    const image = fragment.querySelector(".capture-image");
    const note = fragment.querySelector(".section-note");

    card.dataset.captureId = capture.id;
    badge.textContent = formatCaptureType(capture.captureType);

    link.href = capture.url || "#";
    link.textContent = capture.url || capture.title || "Page";

    timestamp.textContent = new Date(capture.createdAt).toLocaleString();
    image.src = capture.imageData;
    image.addEventListener("click", () => {
      openEditorModal(capture.id).catch((error) => console.error(error));
    });

    note.textContent = capture.note || "";

    note.addEventListener("input", () => {
      scheduleNoteSave(capture.id, note);
    });

    note.addEventListener("blur", () => {
      normalizeEditor(note);
      saveNoteNow(capture.id, note).catch((error) => console.error(error));
    });

    const actionButtons = fragment.querySelectorAll("[data-action]");
    actionButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.getAttribute("data-action");
        await handleAction(action, capture.id, index);
      });
    });

    sectionsContainer.appendChild(fragment);
  });
}

function scheduleNoteSave(captureId, editorEl) {
  const pending = noteSaveTimers.get(captureId);
  if (pending) {
    clearTimeout(pending);
  }

  const timer = setTimeout(() => {
    saveNoteNow(captureId, editorEl).catch((error) => console.error(error));
  }, 400);

  noteSaveTimers.set(captureId, timer);
}

async function saveNoteNow(captureId, editorEl) {
  const pending = noteSaveTimers.get(captureId);
  if (pending) {
    clearTimeout(pending);
    noteSaveTimers.delete(captureId);
  }

  const note = readEditorText(editorEl);
  await updateCapture(captureId, { note });

  const localCapture = captures.find((item) => item.id === captureId);
  if (localCapture) {
    localCapture.note = note;
  }

  updateGeneratedMeta();
}

async function handleAction(action, captureId, index) {
  if (action === "edit-full") {
    await openEditorModal(captureId);
    return;
  }

  if (action === "delete") {
    const shouldDelete = window.confirm("Delete this capture and note?");
    if (!shouldDelete) {
      return;
    }

    await deleteCapture(captureId);
    if (modalCaptureId === captureId) {
      closeEditorModal();
    }
    await renderAll();
    return;
  }

  if (action === "move-up" && index > 0) {
    await saveAllCurrentNotes();
    const orderedIds = captures.map((item) => item.id);
    [orderedIds[index - 1], orderedIds[index]] = [orderedIds[index], orderedIds[index - 1]];
    await reorderCaptures(orderedIds);
    await renderAll();
    return;
  }

  if (action === "move-down" && index < captures.length - 1) {
    await saveAllCurrentNotes();
    const orderedIds = captures.map((item) => item.id);
    [orderedIds[index + 1], orderedIds[index]] = [orderedIds[index], orderedIds[index + 1]];
    await reorderCaptures(orderedIds);
    await renderAll();
  }
}

async function reorderFromSidebarDrag(dragId, targetId, position) {
  if (!dragId || !targetId || dragId === targetId) {
    return;
  }

  await saveAllCurrentNotes();

  const orderedIds = captures.map((item) => item.id);
  const fromIndex = orderedIds.indexOf(dragId);
  const targetIndex = orderedIds.indexOf(targetId);

  if (fromIndex === -1 || targetIndex === -1) {
    return;
  }

  orderedIds.splice(fromIndex, 1);

  let insertIndex = orderedIds.indexOf(targetId);
  if (insertIndex === -1) {
    orderedIds.push(dragId);
  } else {
    if (position === "after") {
      insertIndex += 1;
    }
    orderedIds.splice(insertIndex, 0, dragId);
  }

  await reorderCaptures(orderedIds);
  await renderAll();
}

function clearSidebarDragState() {
  sidebarDragCaptureId = null;
  sidebarDropTargetId = null;
  sidebarDropPosition = "after";

  const sidebarItems = captureList.querySelectorAll("li");
  sidebarItems.forEach((item) => {
    item.classList.remove("dragging", "drop-before", "drop-after");
  });
}

async function saveAllCurrentNotes() {
  const cards = sectionsContainer.querySelectorAll(".section-card");
  for (const card of cards) {
    const captureId = card.getAttribute("data-capture-id");
    const noteEditor = card.querySelector(".section-note");
    if (captureId && noteEditor) {
      normalizeEditor(noteEditor);
      await saveNoteNow(captureId, noteEditor);
    }
  }
}

function readEditorText(editor) {
  return editor.innerText.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeEditor(editor) {
  const text = readEditorText(editor);
  editor.textContent = text;
}

function formatCaptureType(captureType) {
  const labels = {
    visible: "Visible",
    selection: "Selection",
    fullpage: "Full Page"
  };

  return labels[captureType] || "Capture";
}

function updateGeneratedMeta() {
  generatedMeta.textContent = `Updated ${new Date().toLocaleString()} • ${captures.length} capture${
    captures.length === 1 ? "" : "s"
  }`;
}

async function maybeOpenCaptureFromQuery() {
  if (!pendingEditCaptureId) {
    return;
  }

  const exists = captures.some((capture) => capture.id === pendingEditCaptureId);
  if (exists) {
    await openEditorModal(pendingEditCaptureId);
  }

  clearEditCaptureQuery();
}

function clearEditCaptureQuery() {
  if (!pendingEditCaptureId) {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("editCaptureId");
  window.history.replaceState({}, "", url.toString());
  pendingEditCaptureId = null;
}

function normalizeTemplateId(templateId) {
  if (PDF_TEMPLATES.some((template) => template.id === templateId)) {
    return templateId;
  }

  return DEFAULT_TEMPLATE_ID;
}

function getTemplateById(templateId) {
  return PDF_TEMPLATES.find((template) => template.id === templateId) || PDF_TEMPLATES[0];
}

function applyTemplateToPaper(templateId, targetPaper = paper) {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const nextTemplate = getTemplateById(normalizedTemplateId);

  for (const template of PDF_TEMPLATES) {
    targetPaper.classList.remove(template.className);
  }

  targetPaper.classList.add(nextTemplate.className);
  return normalizedTemplateId;
}

function openTemplateModal() {
  modalTemplateSelectionId = selectedTemplateId;
  renderTemplateOptionList();
  renderTemplatePreview();
  templateModal.classList.remove("hidden");
  syncBodyModalState();
}

function closeTemplateModal() {
  templateModal.classList.add("hidden");
  syncBodyModalState();
}

function renderTemplateOptionList() {
  templateList.textContent = "";

  PDF_TEMPLATES.forEach((template) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `template-option ${template.id === modalTemplateSelectionId ? "active" : ""}`;
    card.setAttribute("data-template-id", template.id);

    card.innerHTML = `
      <div class="template-option-head">
        <strong>${template.name}</strong>
      </div>
      <p>${template.description}</p>
      <div class="template-mini-preview mini-${template.id}">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;

    card.addEventListener("click", () => {
      modalTemplateSelectionId = template.id;
      renderTemplateOptionList();
      renderTemplatePreview();
    });

    templateList.appendChild(card);
  });
}

function renderTemplatePreview() {
  const selectedTemplate = getTemplateById(modalTemplateSelectionId);
  templatePreviewTitle.textContent = selectedTemplate.name;
  templatePreviewDescription.textContent = selectedTemplate.description;

  const previewPaper = paper.cloneNode(true);
  previewPaper.id = "";
  previewPaper.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  previewPaper.classList.add("template-preview-paper");
  previewPaper.querySelectorAll(".section-actions").forEach((element) => element.remove());
  previewPaper.querySelectorAll("[contenteditable='true']").forEach((element) => {
    element.setAttribute("contenteditable", "false");
  });

  applyTemplateToPaper(selectedTemplate.id, previewPaper);
  templatePreviewContent.replaceChildren(previewPaper);
}

async function previewTemplateOnPage() {
  selectedTemplateId = applyTemplateToPaper(modalTemplateSelectionId);
  await persistMeta();
  closeTemplateModal();
}

async function exportSelectedTemplateAsPdf() {
  selectedTemplateId = applyTemplateToPaper(modalTemplateSelectionId);
  await persistMeta();
  closeTemplateModal();
  await nextFrame();
  await nextFrame();
  window.print();
}

async function openEditorModal(captureId) {
  await saveAllCurrentNotes();

  const capture = captures.find((item) => item.id === captureId);
  if (!capture) {
    return;
  }

  modalCaptureId = captureId;
  modalCaptureTitle.textContent = capture.title || "Untitled Page";
  modalNoteInput.value = capture.note || "";
  modalShapes = [];
  modalActiveShape = null;
  modalPointerId = null;
  modalBusy = false;

  editorModal.classList.remove("hidden");
  syncBodyModalState();

  await nextFrame();
  await loadModalImage(capture.imageData);

  setModalTool(TOOL_PEN);
  redrawModalCanvas();
  updateModalControls();
}

function closeEditorModal() {
  if (modalBusy) {
    return;
  }

  editorModal.classList.add("hidden");
  syncBodyModalState();

  modalCaptureId = null;
  modalBaseImage = null;
  modalNaturalWidth = 0;
  modalNaturalHeight = 0;
  modalRenderWidth = 0;
  modalRenderHeight = 0;
  modalShapes = [];
  modalActiveShape = null;
  modalPointerId = null;

  modalCanvas.width = 1;
  modalCanvas.height = 1;
  modalCanvasCtx.clearRect(0, 0, 1, 1);
}

function isModalOpen() {
  return !editorModal.classList.contains("hidden");
}

function isTemplateModalOpen() {
  return !templateModal.classList.contains("hidden");
}

function syncBodyModalState() {
  const shouldLockScroll = isModalOpen() || isTemplateModalOpen();
  document.body.classList.toggle("modal-open", shouldLockScroll);
}

function setModalTool(tool) {
  modalTool = tool;

  modalPenBtn.classList.toggle("active", tool === TOOL_PEN);
  modalRectBtn.classList.toggle("active", tool === TOOL_RECT);
  modalArrowBtn.classList.toggle("active", tool === TOOL_ARROW);
  modalTextBtn.classList.toggle("active", tool === TOOL_TEXT);
}

function onModalPointerDown(event) {
  if (!isModalOpen() || !modalBaseImage || modalBusy) {
    return;
  }

  event.preventDefault();

  const point = getModalPoint(event);
  if (modalTool === TOOL_TEXT) {
    const style = getModalStyle();
    const textInput = window.prompt("Enter text annotation:");
    const text = textInput ? textInput.trim() : "";

    if (text) {
      modalShapes.push({
        type: TOOL_TEXT,
        color: style.color,
        width: style.width,
        text,
        x: point.x,
        y: point.y
      });
      redrawModalCanvas();
      updateModalControls();
    }

    return;
  }

  modalPointerId = event.pointerId;
  modalCanvas.setPointerCapture(event.pointerId);

  const style = getModalStyle();

  if (modalTool === TOOL_PEN) {
    modalActiveShape = {
      type: TOOL_PEN,
      color: style.color,
      width: style.width,
      points: [point]
    };
  } else {
    modalActiveShape = {
      type: modalTool,
      color: style.color,
      width: style.width,
      start: point,
      end: point
    };
  }

  redrawModalCanvas();
}

function onModalPointerMove(event) {
  if (!modalActiveShape || modalPointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  const point = getModalPoint(event);

  if (modalActiveShape.type === TOOL_PEN) {
    const last = modalActiveShape.points[modalActiveShape.points.length - 1];
    if (!last || distance(last, point) >= 1.4) {
      modalActiveShape.points.push(point);
    }
  } else {
    modalActiveShape.end = point;
  }

  redrawModalCanvas();
}

function onModalPointerUp(event) {
  if (!modalActiveShape || modalPointerId !== event.pointerId) {
    return;
  }

  const point = getModalPoint(event);

  if (modalActiveShape.type === TOOL_PEN) {
    const last = modalActiveShape.points[modalActiveShape.points.length - 1];
    if (!last || distance(last, point) >= 1.4) {
      modalActiveShape.points.push(point);
    }
  } else {
    modalActiveShape.end = point;
  }

  if (isMeaningfulShape(modalActiveShape)) {
    modalShapes.push(modalActiveShape);
  }

  modalActiveShape = null;
  modalPointerId = null;

  try {
    modalCanvas.releasePointerCapture(event.pointerId);
  } catch (error) {
    // Ignore pointer release errors.
  }

  redrawModalCanvas();
  updateModalControls();
}

function undoModalShape() {
  if (modalShapes.length === 0 || modalBusy) {
    return;
  }

  modalShapes.pop();
  redrawModalCanvas();
  updateModalControls();
}

function clearModalShapes() {
  if (modalShapes.length === 0 || modalBusy) {
    return;
  }

  modalShapes = [];
  modalActiveShape = null;
  redrawModalCanvas();
  updateModalControls();
}

async function saveModalChanges() {
  if (!modalCaptureId || !modalBaseImage || modalBusy) {
    return;
  }

  const targetCaptureId = modalCaptureId;
  setModalBusy(true);

  try {
    const note = modalNoteInput.value.trim();
    const updates = { note };

    if (modalShapes.length > 0) {
      updates.imageData = await renderModalAnnotatedImageData();
    }

    await updateCapture(targetCaptureId, updates);
    setModalBusy(false);
    closeEditorModal();
    await renderAll();

    const card = sectionsContainer.querySelector(`[data-capture-id="${targetCaptureId}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    console.error(error);
    alert(error?.message || "Failed to save screenshot changes.");
  } finally {
    setModalBusy(false);
  }
}

function setModalBusy(isBusy) {
  modalBusy = isBusy;
  updateModalControls();
}

function updateModalControls() {
  const hasImage = Boolean(modalBaseImage);

  modalPenBtn.disabled = modalBusy || !hasImage;
  modalRectBtn.disabled = modalBusy || !hasImage;
  modalArrowBtn.disabled = modalBusy || !hasImage;
  modalTextBtn.disabled = modalBusy || !hasImage;
  modalStrokeColorInput.disabled = modalBusy || !hasImage;
  modalStrokeWidthInput.disabled = modalBusy || !hasImage;
  modalUndoBtn.disabled = modalBusy || !hasImage || modalShapes.length === 0;
  modalClearBtn.disabled = modalBusy || !hasImage || modalShapes.length === 0;
  modalSaveBtn.disabled = modalBusy || !hasImage;
  modalCancelBtn.disabled = modalBusy;
  modalCloseBtn.disabled = modalBusy;
  modalNoteInput.disabled = modalBusy || !hasImage;

  modalCanvas.style.pointerEvents = modalBusy || !hasImage ? "none" : "auto";
}

function getModalStyle() {
  return {
    color: modalStrokeColorInput.value || "#ff0000",
    width: Number(modalStrokeWidthInput.value) || 3
  };
}

async function loadModalImage(dataUrl) {
  modalBaseImage = await loadImage(dataUrl);
  modalNaturalWidth = modalBaseImage.naturalWidth || modalBaseImage.width;
  modalNaturalHeight = modalBaseImage.naturalHeight || modalBaseImage.height;

  applyModalCanvasSize();
}

function applyModalCanvasSize() {
  if (!modalNaturalWidth || !modalNaturalHeight) {
    return;
  }

  const maxWidth = Math.max(320, modalCanvasWrap.clientWidth - 18);
  const maxHeight = Math.max(240, Math.min(window.innerHeight * 0.58, modalCanvasWrap.clientHeight - 16));

  const scale = Math.min(1, maxWidth / modalNaturalWidth, maxHeight / modalNaturalHeight);

  modalRenderWidth = Math.max(1, Math.floor(modalNaturalWidth * scale));
  modalRenderHeight = Math.max(1, Math.floor(modalNaturalHeight * scale));

  modalCanvas.width = modalRenderWidth;
  modalCanvas.height = modalRenderHeight;
  modalCanvas.style.width = `${modalRenderWidth}px`;
  modalCanvas.style.height = `${modalRenderHeight}px`;
}

function redrawModalCanvas() {
  if (!modalBaseImage || modalRenderWidth <= 0 || modalRenderHeight <= 0) {
    return;
  }

  modalCanvasCtx.clearRect(0, 0, modalRenderWidth, modalRenderHeight);
  modalCanvasCtx.drawImage(modalBaseImage, 0, 0, modalRenderWidth, modalRenderHeight);

  const previewScale = modalRenderWidth / modalNaturalWidth;

  for (const shape of modalShapes) {
    drawShape(modalCanvasCtx, shape, previewScale);
  }

  if (modalActiveShape) {
    drawShape(modalCanvasCtx, modalActiveShape, previewScale);
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
    const first = shape.points[0];
    ctx.moveTo(first.x * scale, first.y * scale);

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
    ctx.font = `700 ${fontSize}px "IBM Plex Sans", "Avenir Next", sans-serif`;
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
    endY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    endX - headLength * Math.cos(angle + Math.PI / 6),
    endY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function getModalPoint(event) {
  const rect = modalCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || !modalNaturalWidth || !modalNaturalHeight) {
    return { x: 0, y: 0 };
  }

  const x = clamp((event.clientX - rect.left) * (modalNaturalWidth / rect.width), 0, modalNaturalWidth);
  const y = clamp((event.clientY - rect.top) * (modalNaturalHeight / rect.height), 0, modalNaturalHeight);

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
  if (!modalBaseImage || !modalNaturalWidth || !modalNaturalHeight) {
    throw new Error("No image available to annotate.");
  }

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = modalNaturalWidth;
  exportCanvas.height = modalNaturalHeight;

  const exportCtx = exportCanvas.getContext("2d", { alpha: false });
  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, modalNaturalWidth, modalNaturalHeight);
  exportCtx.drawImage(modalBaseImage, 0, 0, modalNaturalWidth, modalNaturalHeight);

  for (const shape of modalShapes) {
    drawShape(exportCtx, shape, 1);
  }

  return exportCanvas.toDataURL("image/png");
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load screenshot image."));
    image.src = dataUrl;
  });
}

function nextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
