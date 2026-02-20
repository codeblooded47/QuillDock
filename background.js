import { createCapture, deleteCapture, getAllCaptures, getCapture, updateCapture } from "./db.js";

const SCROLL_DELAY_MS = 220;
const MAX_CANVAS_EDGE = 32000;
const MAX_CANVAS_PIXELS = 268000000;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-sidebar-ui" });
  } catch (error) {
    try {
      if (!String(error).includes("Receiving end does not exist")) {
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content_script.js"]
      });

      await chrome.tabs.sendMessage(tab.id, { type: "toggle-sidebar-ui" });
    } catch (ignoredError) {
      // Ignore pages where scripts cannot be injected (for example chrome://).
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error?.message || "Unexpected extension error."
      });
    });

  return true;
});

async function handleMessage(message, sender) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid message payload.");
  }

  const context = resolveCaptureContext(message, sender);

  switch (message.type) {
    case "capture-visible":
      return withExtensionUiHidden(context.tabId, () => captureVisible(context.tabId, context.windowId));
    case "capture-selection":
      return withExtensionUiHidden(context.tabId, () =>
        captureSelection(context.tabId, context.windowId)
      );
    case "capture-fullpage":
      return withExtensionUiHidden(context.tabId, () =>
        captureFullPage(context.tabId, context.windowId)
      );
    case "save-note": {
      const capture = await updateCapture(message.id, { note: message.note || "" });
      return { ok: true, capture };
    }
    case "get-captures": {
      const captures = await getAllCaptures();
      return { ok: true, captures };
    }
    case "get-capture": {
      const capture = await getCapture(message.id);
      return { ok: true, capture };
    }
    case "update-capture": {
      if (!message.id || !message.updates || typeof message.updates !== "object") {
        throw new Error("Invalid update payload.");
      }
      const capture = await updateCapture(message.id, message.updates);
      return { ok: true, capture };
    }
    case "delete-capture": {
      if (!message.id) {
        throw new Error("Capture id is required.");
      }
      await deleteCapture(message.id);
      return { ok: true };
    }
    case "open-review-page": {
      const url = new URL(chrome.runtime.getURL("review.html"));
      if (message.captureId) {
        url.searchParams.set("editCaptureId", message.captureId);
      }
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    }
    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

function resolveCaptureContext(message, sender) {
  return {
    tabId: message?.tabId || sender?.tab?.id || null,
    windowId: message?.windowId || sender?.tab?.windowId || null
  };
}

async function withExtensionUiHidden(tabId, runCapture) {
  await sendTabMessageSafe(tabId, { type: "prepare-capture-ui" });

  try {
    return await runCapture();
  } finally {
    await sendTabMessageSafe(tabId, { type: "restore-capture-ui" });
  }
}

async function sendTabMessageSafe(tabId, message) {
  if (!tabId) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    // Ignore if content script is unavailable on this tab.
  }
}

async function captureVisible(tabId, windowId) {
  const tab = await getValidTab(tabId);
  const imageData = await captureVisibleData(windowId);

  const capture = await createCapture({
    url: tab.url || "",
    title: tab.title || "Untitled Page",
    imageData,
    captureType: "visible"
  });

  return { ok: true, capture };
}

async function captureSelection(tabId, windowId) {
  const tab = await getValidTab(tabId);

  const selection = await requestAreaSelection(tabId);
  if (!selection?.ok) {
    return {
      ok: false,
      canceled: true,
      error: selection?.error || "Area selection was canceled."
    };
  }

  const visibleImage = await captureVisibleData(windowId);
  const croppedImage = await cropDataUrl(visibleImage, selection.bounds);

  const capture = await createCapture({
    url: tab.url || "",
    title: tab.title || "Untitled Page",
    imageData: croppedImage,
    captureType: "selection"
  });

  return { ok: true, capture };
}

async function captureFullPage(tabId, windowId) {
  const tab = await getValidTab(tabId);
  const metrics = await getPageMetrics(tabId);

  validateCanvasBounds(metrics);

  const xPositions = buildPositions(metrics.pageWidth, metrics.viewportWidth);
  const yPositions = buildPositions(metrics.pageHeight, metrics.viewportHeight);

  let stitchedImage;
  try {
    stitchedImage = await stitchPageGrid(tabId, windowId, metrics, xPositions, yPositions);
  } finally {
    await scrollTo(tabId, metrics.originalX, metrics.originalY).catch(() => {
      // Best effort only.
    });
  }

  const capture = await createCapture({
    url: tab.url || "",
    title: tab.title || "Untitled Page",
    imageData: stitchedImage,
    captureType: "fullpage"
  });

  return { ok: true, capture };
}

async function getValidTab(tabId) {
  if (!tabId || typeof tabId !== "number") {
    throw new Error("No active tab detected.");
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url) {
    throw new Error("Unable to access current tab.");
  }

  if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
    throw new Error("Chrome internal pages cannot be captured.");
  }

  return tab;
}

async function requestAreaSelection(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "start-area-selection" });
  } catch (error) {
    if (!String(error).includes("Receiving end does not exist")) {
      throw new Error("Unable to start area selection on this page.");
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content_script.js"]
    });

    return chrome.tabs.sendMessage(tabId, { type: "start-area-selection" });
  }
}

async function captureVisibleData(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, {
      format: "png"
    });
  } catch (error) {
    throw new Error("Failed to capture screenshot. Make sure this tab is a standard webpage.");
  }
}

async function getPageMetrics(tabId) {
  return executeInTab(tabId, () => {
    const doc = document.documentElement;
    const body = document.body;

    const pageWidth = Math.max(
      doc.scrollWidth,
      body ? body.scrollWidth : 0,
      doc.clientWidth,
      window.innerWidth
    );

    const pageHeight = Math.max(
      doc.scrollHeight,
      body ? body.scrollHeight : 0,
      doc.clientHeight,
      window.innerHeight
    );

    return {
      pageWidth,
      pageHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      originalX: window.scrollX,
      originalY: window.scrollY
    };
  });
}

function validateCanvasBounds(metrics) {
  const widthPx = Math.round(metrics.pageWidth * metrics.devicePixelRatio);
  const heightPx = Math.round(metrics.pageHeight * metrics.devicePixelRatio);

  if (widthPx > MAX_CANVAS_EDGE || heightPx > MAX_CANVAS_EDGE) {
    throw new Error("Page is too large to export as a single image in this browser.");
  }

  if (widthPx * heightPx > MAX_CANVAS_PIXELS) {
    throw new Error("Page capture exceeds memory limits. Try visible or selected area capture.");
  }
}

async function stitchPageGrid(tabId, windowId, metrics, xPositions, yPositions) {
  const dpr = metrics.devicePixelRatio;
  const canvasWidth = Math.max(1, Math.round(metrics.pageWidth * dpr));
  const canvasHeight = Math.max(1, Math.round(metrics.pageHeight * dpr));

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  for (const y of yPositions) {
    for (const x of xPositions) {
      await scrollTo(tabId, x, y);
      await sleep(SCROLL_DELAY_MS);

      const dataUrl = await captureVisibleData(windowId);
      const bitmap = await dataUrlToBitmap(dataUrl);

      const tileWidthCss = Math.min(metrics.viewportWidth, metrics.pageWidth - x);
      const tileHeightCss = Math.min(metrics.viewportHeight, metrics.pageHeight - y);

      const tileWidthPx = Math.max(1, Math.round(tileWidthCss * dpr));
      const tileHeightPx = Math.max(1, Math.round(tileHeightCss * dpr));

      const destX = Math.round(x * dpr);
      const destY = Math.round(y * dpr);

      ctx.drawImage(
        bitmap,
        0,
        0,
        tileWidthPx,
        tileHeightPx,
        destX,
        destY,
        tileWidthPx,
        tileHeightPx
      );

      if (typeof bitmap.close === "function") {
        bitmap.close();
      }
    }
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

async function cropDataUrl(dataUrl, bounds) {
  if (!bounds || bounds.width < 4 || bounds.height < 4) {
    throw new Error("Selection area is too small.");
  }

  const bitmap = await dataUrlToBitmap(dataUrl);
  const dpr = bounds.devicePixelRatio || 1;

  const sx = clamp(Math.round(bounds.x * dpr), 0, bitmap.width - 1);
  const sy = clamp(Math.round(bounds.y * dpr), 0, bitmap.height - 1);
  const sw = clamp(Math.round(bounds.width * dpr), 1, bitmap.width - sx);
  const sh = clamp(Math.round(bounds.height * dpr), 1, bitmap.height - sy);

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d", { alpha: false });

  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  if (typeof bitmap.close === "function") {
    bitmap.close();
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

function buildPositions(totalSize, viewportSize) {
  if (totalSize <= viewportSize) {
    return [0];
  }

  const positions = [];
  for (let value = 0; value < totalSize; value += viewportSize) {
    positions.push(Math.min(value, totalSize - viewportSize));
  }

  return [...new Set(positions)];
}

async function executeInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });

  if (!results || results.length === 0) {
    throw new Error("Failed to execute script in tab.");
  }

  return results[0].result;
}

async function scrollTo(tabId, x, y) {
  await executeInTab(
    tabId,
    (nextX, nextY) => {
      window.scrollTo(nextX, nextY);
    },
    [x, y]
  );
}

async function dataUrlToBitmap(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
