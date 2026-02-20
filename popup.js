import { getAllCaptures, updateCapture } from "./db.js";

const TOOL_PEN = "pen";
const TOOL_RECT = "rect";
const TOOL_ARROW = "arrow";

const MAX_PREVIEW_PIXELS = 6_000_000;
const MAX_PREVIEW_HEIGHT = 8000;

const captureVisibleBtn = document.getElementById("captureVisibleBtn");
const captureSelectionBtn = document.getElementById("captureSelectionBtn");
const captureFullBtn = document.getElementById("captureFullBtn");
const openReviewBtn = document.getElementById("openReviewBtn");
const saveNoteBtn = document.getElementById("saveNoteBtn");
const statusText = document.getElementById("statusText");
const quickNoteSection = document.getElementById("quickNoteSection");
const noteInput = document.getElementById("noteInput");
const captureCount = document.getElementById("captureCount");

const drawPenBtn = document.getElementById("drawPenBtn");
const drawRectBtn = document.getElementById("drawRectBtn");
const drawArrowBtn = document.getElementById("drawArrowBtn");
const strokeColorInput = document.getElementById("strokeColorInput");
const strokeWidthInput = document.getElementById("strokeWidthInput");
const undoDrawBtn = document.getElementById("undoDrawBtn");
const clearDrawBtn = document.getElementById("clearDrawBtn");
const applyMarkupBtn = document.getElementById("applyMarkupBtn");
const canvasViewport = document.getElementById("canvasViewport");
const annotationCanvas = document.getElementById("annotationCanvas");

const canvasCtx = annotationCanvas.getContext("2d");

let latestCaptureId = null;
let busy = false;

let baseImage = null;
let naturalWidth = 0;
let naturalHeight = 0;
let renderWidth = 0;
let renderHeight = 0;

let currentTool = TOOL_PEN;
let shapes = [];
let activeShape = null;
let drawingPointerId = null;

init().catch((error) => {
  setStatus(error?.message || "Failed to load popup.", true);
});

async function init() {
  captureVisibleBtn.addEventListener("click", () => captureFromActiveTab("capture-visible"));
  captureSelectionBtn.addEventListener("click", () => captureFromActiveTab("capture-selection"));
  captureFullBtn.addEventListener("click", () => captureFromActiveTab("capture-fullpage"));
  openReviewBtn.addEventListener("click", () => openReviewWorkspace());
  saveNoteBtn.addEventListener("click", saveLatestNote);

  drawPenBtn.addEventListener("click", () => setTool(TOOL_PEN));
  drawRectBtn.addEventListener("click", () => setTool(TOOL_RECT));
  drawArrowBtn.addEventListener("click", () => setTool(TOOL_ARROW));
  undoDrawBtn.addEventListener("click", undoMarkup);
  clearDrawBtn.addEventListener("click", clearMarkup);
  applyMarkupBtn.addEventListener("click", applyMarkup);

  annotationCanvas.addEventListener("pointerdown", onPointerDown);
  annotationCanvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("resize", () => {
    if (baseImage && !quickNoteSection.classList.contains("hidden")) {
      redrawCanvas();
    }
  });

  await refreshCount();
  await showMostRecentCapture();
  refreshControlState();
}

async function captureFromActiveTab(type) {
  setBusy(true);
  setStatus("Capturing...", false);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || typeof tab.windowId !== "number") {
      throw new Error("No active tab available.");
    }

    const response = await chrome.runtime.sendMessage({
      type,
      tabId: tab.id,
      windowId: tab.windowId
    });

    if (!response?.ok) {
      if (response?.canceled) {
        setStatus("Capture canceled.", false);
        return;
      }

      throw new Error(response?.error || "Capture failed.");
    }

    latestCaptureId = response.capture.id;
    await showCapture(response.capture);
    noteInput.value = response.capture.note || "";
    quickNoteSection.classList.remove("hidden");

    setStatus("Capture saved. Opening full editor...", false);
    await refreshCount();
    openReviewWorkspace(response.capture.id);
  } catch (error) {
    setStatus(error?.message || "Capture failed.", true);
  } finally {
    setBusy(false);
  }
}

async function saveLatestNote() {
  if (!latestCaptureId) {
    setStatus("Capture first, then save a note.", true);
    return;
  }

  setBusy(true);
  try {
    const note = noteInput.value.trim();
    await updateCapture(latestCaptureId, { note });
    setStatus("Note saved.", false);
  } catch (error) {
    setStatus(error?.message || "Failed to save note.", true);
  } finally {
    setBusy(false);
  }
}

function openReviewWorkspace(captureId = null) {
  const url = new URL(chrome.runtime.getURL("review.html"));
  if (captureId) {
    url.searchParams.set("editCaptureId", captureId);
  }

  chrome.tabs.create({ url: url.toString() });
}

async function showMostRecentCapture() {
  const captures = await getAllCaptures();
  if (captures.length === 0) {
    latestCaptureId = null;
    quickNoteSection.classList.add("hidden");
    resetAnnotator();
    refreshControlState();
    return;
  }

  const latest = captures[captures.length - 1];
  latestCaptureId = latest.id;
  await showCapture(latest);
  noteInput.value = latest.note || "";
  quickNoteSection.classList.remove("hidden");
  refreshControlState();
}

async function showCapture(capture) {
  await loadImageIntoCanvas(capture.imageData);
  shapes = [];
  activeShape = null;
  redrawCanvas();
}

async function refreshCount() {
  const captures = await getAllCaptures();
  captureCount.textContent = `${captures.length} capture${captures.length === 1 ? "" : "s"} saved`;
}

function setBusy(isBusy) {
  busy = isBusy;
  refreshControlState();
}

function refreshControlState() {
  const hasCapture = Boolean(latestCaptureId && baseImage);

  captureVisibleBtn.disabled = busy;
  captureSelectionBtn.disabled = busy;
  captureFullBtn.disabled = busy;

  saveNoteBtn.disabled = busy || !hasCapture;

  drawPenBtn.disabled = busy || !hasCapture;
  drawRectBtn.disabled = busy || !hasCapture;
  drawArrowBtn.disabled = busy || !hasCapture;
  undoDrawBtn.disabled = busy || !hasCapture || shapes.length === 0;
  clearDrawBtn.disabled = busy || !hasCapture || shapes.length === 0;
  applyMarkupBtn.disabled = busy || !hasCapture || shapes.length === 0;
  strokeColorInput.disabled = busy || !hasCapture;
  strokeWidthInput.disabled = busy || !hasCapture;

  annotationCanvas.style.pointerEvents = busy || !hasCapture ? "none" : "auto";
}

function setStatus(text, isError) {
  statusText.textContent = text;
  statusText.style.color = isError ? "#b3261e" : "#4b5b6e";
}

function setTool(tool) {
  currentTool = tool;
  drawPenBtn.classList.toggle("active", tool === TOOL_PEN);
  drawRectBtn.classList.toggle("active", tool === TOOL_RECT);
  drawArrowBtn.classList.toggle("active", tool === TOOL_ARROW);
}

function onPointerDown(event) {
  if (!baseImage || busy) {
    return;
  }

  event.preventDefault();

  const point = getCanvasPoint(event);
  drawingPointerId = event.pointerId;
  annotationCanvas.setPointerCapture(event.pointerId);

  const style = getCurrentStyle();
  if (currentTool === TOOL_PEN) {
    activeShape = {
      type: TOOL_PEN,
      color: style.color,
      width: style.width,
      points: [point]
    };
  } else {
    activeShape = {
      type: currentTool,
      color: style.color,
      width: style.width,
      start: point,
      end: point
    };
  }

  redrawCanvas();
}

function onPointerMove(event) {
  if (!activeShape || drawingPointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();

  const point = getCanvasPoint(event);

  if (activeShape.type === TOOL_PEN) {
    const last = activeShape.points[activeShape.points.length - 1];
    if (!last || distance(last, point) >= 0.8) {
      activeShape.points.push(point);
    }
  } else {
    activeShape.end = point;
  }

  redrawCanvas();
}

function onPointerUp(event) {
  if (!activeShape || drawingPointerId !== event.pointerId) {
    return;
  }

  const point = getCanvasPoint(event);
  if (activeShape.type === TOOL_PEN) {
    const last = activeShape.points[activeShape.points.length - 1];
    if (!last || distance(last, point) >= 0.8) {
      activeShape.points.push(point);
    }
  } else {
    activeShape.end = point;
  }

  if (isMeaningfulShape(activeShape)) {
    shapes.push(activeShape);
  }

  activeShape = null;
  drawingPointerId = null;
  try {
    annotationCanvas.releasePointerCapture(event.pointerId);
  } catch (error) {
    // Ignore release failures when pointer capture was already lost.
  }

  redrawCanvas();
  refreshControlState();
}

function undoMarkup() {
  if (shapes.length === 0) {
    return;
  }

  shapes.pop();
  redrawCanvas();
  refreshControlState();
}

function clearMarkup() {
  if (shapes.length === 0) {
    return;
  }

  shapes = [];
  activeShape = null;
  redrawCanvas();
  refreshControlState();
}

async function applyMarkup() {
  if (!latestCaptureId || !baseImage) {
    setStatus("Capture first to annotate.", true);
    return;
  }

  if (shapes.length === 0) {
    setStatus("Draw something first, then click Apply Markup.", true);
    return;
  }

  setBusy(true);
  try {
    const annotatedImageData = await renderAnnotatedImageData();
    await updateCapture(latestCaptureId, { imageData: annotatedImageData });

    await loadImageIntoCanvas(annotatedImageData);
    shapes = [];
    activeShape = null;
    redrawCanvas();
    setStatus("Markup applied to screenshot.", false);
  } catch (error) {
    setStatus(error?.message || "Failed to apply markup.", true);
  } finally {
    setBusy(false);
  }
}

function getCurrentStyle() {
  return {
    color: strokeColorInput.value || "#ff0000",
    width: Number(strokeWidthInput.value) || 3
  };
}

async function loadImageIntoCanvas(dataUrl) {
  const image = await loadImage(dataUrl);

  baseImage = image;
  naturalWidth = image.naturalWidth || image.width;
  naturalHeight = image.naturalHeight || image.height;

  const viewportWidth = Math.max(220, canvasViewport.clientWidth - 12 || 320);

  let nextWidth = Math.min(viewportWidth, naturalWidth);
  if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
    nextWidth = 320;
  }

  let nextHeight = Math.max(1, Math.round((naturalHeight / naturalWidth) * nextWidth));

  if (nextWidth * nextHeight > MAX_PREVIEW_PIXELS) {
    const ratio = Math.sqrt(MAX_PREVIEW_PIXELS / (nextWidth * nextHeight));
    nextWidth = Math.max(1, Math.floor(nextWidth * ratio));
    nextHeight = Math.max(1, Math.floor(nextHeight * ratio));
  }

  if (nextHeight > MAX_PREVIEW_HEIGHT) {
    const ratio = MAX_PREVIEW_HEIGHT / nextHeight;
    nextWidth = Math.max(1, Math.floor(nextWidth * ratio));
    nextHeight = MAX_PREVIEW_HEIGHT;
  }

  renderWidth = nextWidth;
  renderHeight = nextHeight;

  annotationCanvas.width = renderWidth;
  annotationCanvas.height = renderHeight;
  annotationCanvas.style.width = `${renderWidth}px`;
  annotationCanvas.style.height = `${renderHeight}px`;
}

function redrawCanvas() {
  if (!baseImage || !canvasCtx || renderWidth <= 0 || renderHeight <= 0) {
    return;
  }

  canvasCtx.clearRect(0, 0, renderWidth, renderHeight);
  canvasCtx.drawImage(baseImage, 0, 0, renderWidth, renderHeight);

  for (const shape of shapes) {
    drawShape(canvasCtx, shape, 1);
  }

  if (activeShape) {
    drawShape(canvasCtx, activeShape, 1);
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

function isMeaningfulShape(shape) {
  if (shape.type === TOOL_PEN) {
    return Array.isArray(shape.points) && shape.points.length > 1;
  }

  if (shape.type === TOOL_RECT || shape.type === TOOL_ARROW) {
    const dx = Math.abs(shape.end.x - shape.start.x);
    const dy = Math.abs(shape.end.y - shape.start.y);
    return dx >= 3 || dy >= 3;
  }

  return false;
}

function getCanvasPoint(event) {
  const rect = annotationCanvas.getBoundingClientRect();
  const scaleX = annotationCanvas.width / rect.width;
  const scaleY = annotationCanvas.height / rect.height;

  const x = clamp((event.clientX - rect.left) * scaleX, 0, annotationCanvas.width);
  const y = clamp((event.clientY - rect.top) * scaleY, 0, annotationCanvas.height);

  return { x, y };
}

function resetAnnotator() {
  baseImage = null;
  naturalWidth = 0;
  naturalHeight = 0;
  renderWidth = 0;
  renderHeight = 0;
  shapes = [];
  activeShape = null;
  drawingPointerId = null;

  annotationCanvas.width = 1;
  annotationCanvas.height = 1;
  canvasCtx.clearRect(0, 0, 1, 1);
}

async function renderAnnotatedImageData() {
  if (!baseImage || naturalWidth <= 0 || naturalHeight <= 0 || renderWidth <= 0 || renderHeight <= 0) {
    throw new Error("No screenshot available to annotate.");
  }

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = naturalWidth;
  exportCanvas.height = naturalHeight;

  const exportCtx = exportCanvas.getContext("2d", { alpha: false });
  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, naturalWidth, naturalHeight);
  exportCtx.drawImage(baseImage, 0, 0, naturalWidth, naturalHeight);

  const scale = naturalWidth / renderWidth;
  for (const shape of shapes) {
    drawShape(exportCtx, shape, scale);
  }

  return exportCanvas.toDataURL("image/png");
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load screenshot image."));
    image.src = dataUrl;
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
