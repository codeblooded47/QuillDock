import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearCaptures,
  deleteCapture,
  getAllCaptures,
  reorderCaptures,
  updateCapture
} from "../../db.js";
import { loadMeta, saveMeta } from "./storage.js";
import {
  DEFAULT_TEMPLATE_ID,
  PDF_TEMPLATES,
  captureTypeLabel,
  getTemplateById,
  normalizeTemplateId
} from "./templates.js";

const TOOL_PEN = "pen";
const TOOL_RECT = "rect";
const TOOL_ARROW = "arrow";
const TOOL_TEXT = "text";

export default function App() {
  const [captures, setCaptures] = useState([]);
  const [docTitle, setDocTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(Date.now());

  const [dragCaptureId, setDragCaptureId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [dropPosition, setDropPosition] = useState("after");

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateSelectionId, setTemplateSelectionId] = useState(DEFAULT_TEMPLATE_ID);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCaptureId, setEditorCaptureId] = useState(null);
  const [editorCaptureTitle, setEditorCaptureTitle] = useState("Edit Screenshot");
  const [editorNote, setEditorNote] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalTool, setModalTool] = useState(TOOL_PEN);
  const [modalStrokeColor, setModalStrokeColor] = useState("#ff0000");
  const [modalStrokeWidth, setModalStrokeWidth] = useState(3);
  const [modalImageReady, setModalImageReady] = useState(false);
  const [shapeVersion, setShapeVersion] = useState(0);

  const capturesRef = useRef([]);
  const sectionRefs = useRef(new Map());
  const metaSaveTimerRef = useRef(null);
  const noteSaveTimersRef = useRef(new Map());
  const dirtyNoteIdsRef = useRef(new Set());

  const modalCanvasWrapRef = useRef(null);
  const modalCanvasRef = useRef(null);
  const modalCtxRef = useRef(null);
  const modalBaseImageRef = useRef(null);
  const modalNaturalWidthRef = useRef(0);
  const modalNaturalHeightRef = useRef(0);
  const modalRenderWidthRef = useRef(0);
  const modalRenderHeightRef = useRef(0);
  const modalShapesRef = useRef([]);
  const modalActiveShapeRef = useRef(null);
  const modalPointerIdRef = useRef(null);

  const selectedTemplate = useMemo(() => getTemplateById(selectedTemplateId), [selectedTemplateId]);
  const selectedTemplateClassName = selectedTemplate.className;
  const templateForModal = useMemo(() => getTemplateById(templateSelectionId), [templateSelectionId]);

  const captureCountLabel = useMemo(() => {
    const count = captures.length;
    return `${count} capture${count === 1 ? "" : "s"}`;
  }, [captures.length]);

  const generatedMetaLabel = useMemo(() => {
    const count = captures.length;
    return `Updated ${new Date(lastUpdatedAt).toLocaleString()} • ${count} capture${count === 1 ? "" : "s"}`;
  }, [captures.length, lastUpdatedAt]);

  const modalHasShapes = useMemo(() => modalShapesRef.current.length > 0, [shapeVersion]);

  const touchDocument = useCallback(() => {
    setLastUpdatedAt(Date.now());
  }, []);

  const persistMetaNow = useCallback(
    async (overrides = {}) => {
      const meta = {
        title: (overrides.title ?? docTitle).trim(),
        overview: (overrides.overview ?? overview).trim(),
        templateId: normalizeTemplateId(overrides.templateId ?? selectedTemplateId)
      };

      await saveMeta(meta);
      touchDocument();
    },
    [docTitle, overview, selectedTemplateId, touchDocument]
  );

  const scheduleMetaSave = useCallback(
    (overrides = {}) => {
      if (metaSaveTimerRef.current) {
        clearTimeout(metaSaveTimerRef.current);
      }

      metaSaveTimerRef.current = setTimeout(() => {
        persistMetaNow(overrides).catch((error) => console.error(error));
      }, 350);
    },
    [persistMetaNow]
  );

  const refreshCaptures = useCallback(async () => {
    const nextCaptures = await getAllCaptures();
    capturesRef.current = nextCaptures;
    setCaptures(nextCaptures);
    touchDocument();
    return nextCaptures;
  }, [touchDocument]);

  const saveNoteImmediately = useCallback(
    async (captureId, note) => {
      const pendingTimer = noteSaveTimersRef.current.get(captureId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        noteSaveTimersRef.current.delete(captureId);
      }

      dirtyNoteIdsRef.current.add(captureId);
      await updateCapture(captureId, { note: note.trim() });
      dirtyNoteIdsRef.current.delete(captureId);
      touchDocument();
    },
    [touchDocument]
  );

  const scheduleNoteSave = useCallback(
    (captureId, note) => {
      const pendingTimer = noteSaveTimersRef.current.get(captureId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
      }

      dirtyNoteIdsRef.current.add(captureId);

      const timerId = setTimeout(() => {
        updateCapture(captureId, { note: note.trim() })
          .then(() => {
            dirtyNoteIdsRef.current.delete(captureId);
            touchDocument();
          })
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            noteSaveTimersRef.current.delete(captureId);
          });
      }, 400);

      noteSaveTimersRef.current.set(captureId, timerId);
    },
    [touchDocument]
  );

  const saveAllCurrentNotes = useCallback(async () => {
    for (const timer of noteSaveTimersRef.current.values()) {
      clearTimeout(timer);
    }
    noteSaveTimersRef.current.clear();

    const dirtyIds = Array.from(dirtyNoteIdsRef.current);
    if (dirtyIds.length === 0) {
      return;
    }

    const byId = new Map(capturesRef.current.map((capture) => [capture.id, capture]));

    await Promise.all(
      dirtyIds.map(async (captureId) => {
        const capture = byId.get(captureId);
        if (!capture) {
          dirtyNoteIdsRef.current.delete(captureId);
          return;
        }

        await updateCapture(captureId, { note: (capture.note || "").trim() });
        dirtyNoteIdsRef.current.delete(captureId);
      })
    );

    touchDocument();
  }, [touchDocument]);

  const clearSidebarDragState = useCallback(() => {
    setDragCaptureId(null);
    setDropTargetId(null);
    setDropPosition("after");
  }, []);

  const setCanvasShapeCollection = useCallback((shapes) => {
    modalShapesRef.current = shapes;
    setShapeVersion((current) => current + 1);
  }, []);

  const redrawModalCanvas = useCallback(() => {
    const canvas = modalCanvasRef.current;
    const ctx = modalCtxRef.current;

    if (!canvas || !ctx || !modalBaseImageRef.current) {
      return;
    }

    const renderWidth = modalRenderWidthRef.current;
    const renderHeight = modalRenderHeightRef.current;
    const naturalWidth = modalNaturalWidthRef.current;

    if (renderWidth <= 0 || renderHeight <= 0 || naturalWidth <= 0) {
      return;
    }

    ctx.clearRect(0, 0, renderWidth, renderHeight);
    ctx.drawImage(modalBaseImageRef.current, 0, 0, renderWidth, renderHeight);

    const previewScale = renderWidth / naturalWidth;

    for (const shape of modalShapesRef.current) {
      drawShape(ctx, shape, previewScale);
    }

    if (modalActiveShapeRef.current) {
      drawShape(ctx, modalActiveShapeRef.current, previewScale);
    }
  }, []);

  const applyModalCanvasSize = useCallback(() => {
    const canvasWrap = modalCanvasWrapRef.current;
    const canvas = modalCanvasRef.current;

    if (!canvasWrap || !canvas) {
      return;
    }

    const naturalWidth = modalNaturalWidthRef.current;
    const naturalHeight = modalNaturalHeightRef.current;

    if (!naturalWidth || !naturalHeight) {
      return;
    }

    const maxWidth = Math.max(320, canvasWrap.clientWidth - 18);
    const maxHeight = Math.max(240, Math.min(window.innerHeight * 0.58, canvasWrap.clientHeight - 16));
    const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);

    const renderWidth = Math.max(1, Math.floor(naturalWidth * scale));
    const renderHeight = Math.max(1, Math.floor(naturalHeight * scale));

    modalRenderWidthRef.current = renderWidth;
    modalRenderHeightRef.current = renderHeight;

    canvas.width = renderWidth;
    canvas.height = renderHeight;
    canvas.style.width = `${renderWidth}px`;
    canvas.style.height = `${renderHeight}px`;
  }, []);

  const loadModalImage = useCallback(
    async (imageData) => {
      const image = await loadImage(imageData);
      modalBaseImageRef.current = image;
      modalNaturalWidthRef.current = image.naturalWidth || image.width;
      modalNaturalHeightRef.current = image.naturalHeight || image.height;

      applyModalCanvasSize();
      redrawModalCanvas();
      setModalImageReady(true);
    },
    [applyModalCanvasSize, redrawModalCanvas]
  );

  const closeEditorModal = useCallback(
    (force = false) => {
      if (!force && modalBusy) {
        return;
      }

      setEditorOpen(false);
      setEditorCaptureId(null);
      setEditorCaptureTitle("Edit Screenshot");
      setEditorNote("");
      setModalBusy(false);
      setModalImageReady(false);
      setModalTool(TOOL_PEN);

      modalBaseImageRef.current = null;
      modalNaturalWidthRef.current = 0;
      modalNaturalHeightRef.current = 0;
      modalRenderWidthRef.current = 0;
      modalRenderHeightRef.current = 0;
      modalActiveShapeRef.current = null;
      modalPointerIdRef.current = null;
      setCanvasShapeCollection([]);

      const canvas = modalCanvasRef.current;
      const ctx = modalCtxRef.current;
      if (canvas && ctx) {
        canvas.width = 1;
        canvas.height = 1;
        ctx.clearRect(0, 0, 1, 1);
      }
    },
    [modalBusy, setCanvasShapeCollection]
  );

  const openEditorModal = useCallback(
    async (captureId, captureList = capturesRef.current) => {
      await saveAllCurrentNotes();

      const capture = captureList.find((item) => item.id === captureId);
      if (!capture) {
        return;
      }

      setEditorCaptureId(capture.id);
      setEditorCaptureTitle(capture.title || "Untitled Page");
      setEditorNote(capture.note || "");
      setModalBusy(false);
      setModalImageReady(false);
      setModalTool(TOOL_PEN);
      setEditorOpen(true);

      modalActiveShapeRef.current = null;
      modalPointerIdRef.current = null;
      setCanvasShapeCollection([]);

      await nextFrame();
      await loadModalImage(capture.imageData);
    },
    [loadModalImage, saveAllCurrentNotes, setCanvasShapeCollection]
  );

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const [meta, loadedCaptures] = await Promise.all([loadMeta(), getAllCaptures()]);

        if (!isMounted) {
          return;
        }

        const normalizedTemplateId = normalizeTemplateId(meta.templateId);

        setDocTitle(meta.title || "");
        setOverview(meta.overview || "");
        setSelectedTemplateId(normalizedTemplateId);
        setTemplateSelectionId(normalizedTemplateId);

        capturesRef.current = loadedCaptures;
        setCaptures(loadedCaptures);
        touchDocument();

        const url = new URL(window.location.href);
        const pendingEditCaptureId = url.searchParams.get("editCaptureId");

        if (pendingEditCaptureId) {
          await openEditorModal(pendingEditCaptureId, loadedCaptures);
          url.searchParams.delete("editCaptureId");
          window.history.replaceState({}, "", url.toString());
        }
      } catch (error) {
        console.error(error);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, [openEditorModal, touchDocument]);

  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);

  useEffect(() => {
    const shouldLockScroll = editorOpen || templateModalOpen;
    document.body.classList.toggle("modal-open", shouldLockScroll);

    return () => {
      document.body.classList.remove("modal-open");
    };
  }, [editorOpen, templateModalOpen]);

  useEffect(() => {
    if (!editorOpen || !modalImageReady) {
      return undefined;
    }

    const onResize = () => {
      applyModalCanvasSize();
      redrawModalCanvas();
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [applyModalCanvasSize, editorOpen, modalImageReady, redrawModalCanvas]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (editorOpen) {
        closeEditorModal();
        return;
      }

      if (templateModalOpen) {
        setTemplateModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeEditorModal, editorOpen, templateModalOpen]);

  useEffect(() => {
    const canvas = modalCanvasRef.current;
    if (!canvas) {
      return;
    }

    modalCtxRef.current = canvas.getContext("2d");
  }, []);

  useEffect(() => {
    return () => {
      if (metaSaveTimerRef.current) {
        clearTimeout(metaSaveTimerRef.current);
      }

      for (const timer of noteSaveTimersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const handleDocTitleChange = (event) => {
    const value = event.target.value;
    setDocTitle(value);
    scheduleMetaSave({ title: value });
  };

  const handleOverviewChange = (event) => {
    const value = event.target.value;
    setOverview(value);
    scheduleMetaSave({ overview: value });
  };

  const handleOverviewBlur = async () => {
    await persistMetaNow();
  };

  const handleRefresh = async () => {
    await refreshCaptures();
  };

  const handleClearAll = async () => {
    const shouldClear = window.confirm("Delete every saved capture and note?");
    if (!shouldClear) {
      return;
    }

    await clearCaptures();

    for (const timer of noteSaveTimersRef.current.values()) {
      clearTimeout(timer);
    }
    noteSaveTimersRef.current.clear();
    dirtyNoteIdsRef.current.clear();

    closeEditorModal(true);
    setTemplateModalOpen(false);
    setCaptures([]);
    capturesRef.current = [];
    touchDocument();
  };

  const handleSectionNoteChange = (captureId, value) => {
    setCaptures((current) => {
      const next = current.map((capture) => {
        if (capture.id !== captureId) {
          return capture;
        }

        return {
          ...capture,
          note: value
        };
      });

      capturesRef.current = next;
      return next;
    });

    scheduleNoteSave(captureId, value);
  };

  const handleSectionNoteBlur = async (captureId, value) => {
    await saveNoteImmediately(captureId, value);
  };

  const handleDeleteCapture = async (captureId) => {
    const shouldDelete = window.confirm("Delete this capture and note?");
    if (!shouldDelete) {
      return;
    }

    await deleteCapture(captureId);

    if (editorCaptureId === captureId) {
      closeEditorModal(true);
    }

    await refreshCaptures();
  };

  const handleMoveByIndex = async (index, direction) => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= captures.length) {
      return;
    }

    await saveAllCurrentNotes();

    const orderedIds = captures.map((capture) => capture.id);
    [orderedIds[index], orderedIds[targetIndex]] = [orderedIds[targetIndex], orderedIds[index]];

    await reorderCaptures(orderedIds);
    await refreshCaptures();
  };

  const handleCardAction = async (action, captureId, index) => {
    if (action === "edit-full") {
      await openEditorModal(captureId);
      return;
    }

    if (action === "delete") {
      await handleDeleteCapture(captureId);
      return;
    }

    if (action === "move-up") {
      await handleMoveByIndex(index, "up");
      return;
    }

    if (action === "move-down") {
      await handleMoveByIndex(index, "down");
    }
  };

  const reorderFromSidebarDrag = async (movingId, targetId, position) => {
    if (!movingId || !targetId || movingId === targetId) {
      return;
    }

    await saveAllCurrentNotes();

    const orderedIds = captures.map((capture) => capture.id);
    const fromIndex = orderedIds.indexOf(movingId);
    const targetIndex = orderedIds.indexOf(targetId);

    if (fromIndex === -1 || targetIndex === -1) {
      return;
    }

    orderedIds.splice(fromIndex, 1);

    let insertIndex = orderedIds.indexOf(targetId);
    if (insertIndex === -1) {
      orderedIds.push(movingId);
    } else {
      if (position === "after") {
        insertIndex += 1;
      }
      orderedIds.splice(insertIndex, 0, movingId);
    }

    await reorderCaptures(orderedIds);
    await refreshCaptures();
  };

  const handleSidebarItemClick = (captureId) => {
    const card = sectionRefs.current.get(captureId);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const registerSectionRef = (captureId, element) => {
    if (element) {
      sectionRefs.current.set(captureId, element);
      return;
    }

    sectionRefs.current.delete(captureId);
  };

  const handleExportClick = async () => {
    await persistMetaNow();
    await saveAllCurrentNotes();

    setTemplateSelectionId(selectedTemplateId);
    setTemplateModalOpen(true);
  };

  const closeTemplateModal = () => {
    setTemplateModalOpen(false);
  };

  const handlePreviewTemplate = async () => {
    const normalizedTemplateId = normalizeTemplateId(templateSelectionId);
    setSelectedTemplateId(normalizedTemplateId);
    await persistMetaNow({ templateId: normalizedTemplateId });
    closeTemplateModal();
  };

  const handleExportWithTemplate = async () => {
    const normalizedTemplateId = normalizeTemplateId(templateSelectionId);
    setSelectedTemplateId(normalizedTemplateId);
    await persistMetaNow({ templateId: normalizedTemplateId });
    closeTemplateModal();
    await nextFrame();
    await nextFrame();
    window.print();
  };

  const getModalPoint = (event) => {
    const canvas = modalCanvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    const naturalWidth = modalNaturalWidthRef.current;
    const naturalHeight = modalNaturalHeightRef.current;

    if (rect.width <= 0 || rect.height <= 0 || !naturalWidth || !naturalHeight) {
      return { x: 0, y: 0 };
    }

    const x = clamp((event.clientX - rect.left) * (naturalWidth / rect.width), 0, naturalWidth);
    const y = clamp((event.clientY - rect.top) * (naturalHeight / rect.height), 0, naturalHeight);

    return { x, y };
  };

  const onModalPointerDown = (event) => {
    if (!editorOpen || !modalImageReady || modalBusy) {
      return;
    }

    event.preventDefault();

    const point = getModalPoint(event);

    if (modalTool === TOOL_TEXT) {
      const textInput = window.prompt("Enter text annotation:");
      const text = textInput ? textInput.trim() : "";
      if (!text) {
        return;
      }

      const nextShapes = [
        ...modalShapesRef.current,
        {
          type: TOOL_TEXT,
          color: modalStrokeColor,
          width: Number(modalStrokeWidth) || 3,
          text,
          x: point.x,
          y: point.y
        }
      ];

      setCanvasShapeCollection(nextShapes);
      redrawModalCanvas();
      return;
    }

    const pointerId = event.pointerId;
    modalPointerIdRef.current = pointerId;
    modalCanvasRef.current?.setPointerCapture(pointerId);

    const style = {
      color: modalStrokeColor || "#ff0000",
      width: Number(modalStrokeWidth) || 3
    };

    if (modalTool === TOOL_PEN) {
      modalActiveShapeRef.current = {
        type: TOOL_PEN,
        color: style.color,
        width: style.width,
        points: [point]
      };
    } else {
      modalActiveShapeRef.current = {
        type: modalTool,
        color: style.color,
        width: style.width,
        start: point,
        end: point
      };
    }

    redrawModalCanvas();
  };

  const onModalPointerMove = (event) => {
    const activeShape = modalActiveShapeRef.current;
    if (!activeShape || modalPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();

    const point = getModalPoint(event);

    if (activeShape.type === TOOL_PEN) {
      const lastPoint = activeShape.points[activeShape.points.length - 1];
      if (!lastPoint || distance(lastPoint, point) >= 1.4) {
        activeShape.points.push(point);
      }
    } else {
      activeShape.end = point;
    }

    redrawModalCanvas();
  };

  const onModalPointerUp = (event) => {
    const activeShape = modalActiveShapeRef.current;
    if (!activeShape || modalPointerIdRef.current !== event.pointerId) {
      return;
    }

    const point = getModalPoint(event);

    if (activeShape.type === TOOL_PEN) {
      const lastPoint = activeShape.points[activeShape.points.length - 1];
      if (!lastPoint || distance(lastPoint, point) >= 1.4) {
        activeShape.points.push(point);
      }
    } else {
      activeShape.end = point;
    }

    if (isMeaningfulShape(activeShape)) {
      setCanvasShapeCollection([...modalShapesRef.current, activeShape]);
    }

    modalActiveShapeRef.current = null;
    modalPointerIdRef.current = null;

    try {
      modalCanvasRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer release errors.
    }

    redrawModalCanvas();
  };

  const undoModalShape = () => {
    if (!modalHasShapes || modalBusy) {
      return;
    }

    const nextShapes = [...modalShapesRef.current];
    nextShapes.pop();
    setCanvasShapeCollection(nextShapes);
    redrawModalCanvas();
  };

  const clearModalShapes = () => {
    if (!modalHasShapes || modalBusy) {
      return;
    }

    modalActiveShapeRef.current = null;
    setCanvasShapeCollection([]);
    redrawModalCanvas();
  };

  const renderModalAnnotatedImageData = async () => {
    if (!modalBaseImageRef.current) {
      throw new Error("No image available to annotate.");
    }

    const naturalWidth = modalNaturalWidthRef.current;
    const naturalHeight = modalNaturalHeightRef.current;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = naturalWidth;
    exportCanvas.height = naturalHeight;

    const exportCtx = exportCanvas.getContext("2d", { alpha: false });
    exportCtx.fillStyle = "#ffffff";
    exportCtx.fillRect(0, 0, naturalWidth, naturalHeight);
    exportCtx.drawImage(modalBaseImageRef.current, 0, 0, naturalWidth, naturalHeight);

    for (const shape of modalShapesRef.current) {
      drawShape(exportCtx, shape, 1);
    }

    return exportCanvas.toDataURL("image/png");
  };

  const saveModalChanges = async () => {
    if (!editorCaptureId || !modalImageReady || modalBusy) {
      return;
    }

    setModalBusy(true);

    try {
      const updates = {
        note: editorNote.trim()
      };

      if (modalShapesRef.current.length > 0) {
        updates.imageData = await renderModalAnnotatedImageData();
      }

      await updateCapture(editorCaptureId, updates);

      closeEditorModal(true);
      await refreshCaptures();

      const card = sectionRefs.current.get(editorCaptureId);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      console.error(error);
      window.alert(error?.message || "Failed to save screenshot changes.");
      setModalBusy(false);
    }
  };

  return (
    <>
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-left">
            <div className="app-name">QuillDock Workspace</div>
            <input
              id="docTitleInput"
              type="text"
              placeholder="Document Title"
              value={docTitle}
              onChange={handleDocTitleChange}
              onBlur={() => persistMetaNow().catch((error) => console.error(error))}
            />
          </div>

          <div className="topbar-actions">
            <button id="refreshBtn" className="ghost" onClick={handleRefresh} type="button">
              Refresh
            </button>
            <button id="exportPdfBtn" className="primary" onClick={handleExportClick} type="button">
              Export As PDF
            </button>
            <button id="clearAllBtn" className="danger" onClick={handleClearAll} type="button">
              Clear All Captures
            </button>
          </div>
        </header>

        <div className="workspace">
          <aside className="sidebar">
            <h2>Captured Screens</h2>
            <p id="captureSummary">{captureCountLabel}</p>
            <ul id="captureList">
              {captures.map((capture, index) => {
                const isDropBefore = dropTargetId === capture.id && dropPosition === "before";
                const isDropAfter = dropTargetId === capture.id && dropPosition === "after";

                return (
                  <li
                    key={capture.id}
                    data-capture-id={capture.id}
                    draggable
                    className={`${dragCaptureId === capture.id ? "dragging" : ""} ${
                      isDropBefore ? "drop-before" : ""
                    } ${isDropAfter ? "drop-after" : ""}`}
                    onDragStart={(event) => {
                      setDragCaptureId(capture.id);
                      if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", capture.id);
                      }
                    }}
                    onDragOver={(event) => {
                      if (!dragCaptureId || dragCaptureId === capture.id) {
                        return;
                      }

                      event.preventDefault();

                      const rect = event.currentTarget.getBoundingClientRect();
                      const isBefore = event.clientY - rect.top < rect.height / 2;

                      setDropTargetId(capture.id);
                      setDropPosition(isBefore ? "before" : "after");

                      if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget)) {
                        return;
                      }

                      if (dropTargetId === capture.id) {
                        setDropTargetId(null);
                      }
                    }}
                    onDrop={async (event) => {
                      if (!dragCaptureId || dragCaptureId === capture.id) {
                        return;
                      }

                      event.preventDefault();
                      await reorderFromSidebarDrag(dragCaptureId, capture.id, dropPosition);
                      clearSidebarDragState();
                    }}
                    onDragEnd={clearSidebarDragState}
                    onClick={() => handleSidebarItemClick(capture.id)}
                  >
                    <div className="list-row">
                      <div className="list-title">{`${index + 1}. ${capture.title || "Untitled Page"}`}</div>
                      <div className="list-actions">
                        <button
                          type="button"
                          className="ghost tiny sidebar-move-btn"
                          disabled={index === 0}
                          onClick={async (event) => {
                            event.stopPropagation();
                            await handleMoveByIndex(index, "up");
                          }}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="ghost tiny sidebar-move-btn"
                          disabled={index === captures.length - 1}
                          onClick={async (event) => {
                            event.stopPropagation();
                            await handleMoveByIndex(index, "down");
                          }}
                        >
                          Down
                        </button>
                      </div>
                    </div>
                    <div className="list-sub">
                      {captureTypeLabel(capture.captureType)} • {new Date(capture.createdAt).toLocaleString()}
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="editor-canvas">
            <article id="paper" className={`paper ${selectedTemplateClassName}`}>
              <header className="paper-header">
                <h1 id="docTitleHeading">{docTitle.trim() || "Untitled Documentation"}</h1>
                <p id="generatedMeta">{generatedMetaLabel}</p>
              </header>

              <section className="intro-block">
                <h3>Overview</h3>
                <textarea
                  id="introEditor"
                  className="rich-note"
                  placeholder="Write a short overview for this walkthrough..."
                  value={overview}
                  onChange={handleOverviewChange}
                  onBlur={handleOverviewBlur}
                />
              </section>

              <section id="sectionsContainer">
                {captures.length === 0 ? (
                  <p style={{ color: "#58687a" }}>
                    No captures yet. Use the extension sidebar to capture visible area, selected area, or full
                    page.
                  </p>
                ) : (
                  captures.map((capture, index) => (
                    <article
                      className="section-card"
                      data-capture-id={capture.id}
                      key={capture.id}
                      ref={(element) => registerSectionRef(capture.id, element)}
                    >
                      <div className="section-header">
                        <div className="section-meta">
                          <span className="capture-badge">{captureTypeLabel(capture.captureType)}</span>
                          <a className="page-link" href={capture.url || "#"} target="_blank" rel="noreferrer">
                            {capture.url || capture.title || "Page"}
                          </a>
                          <span className="time-stamp">{new Date(capture.createdAt).toLocaleString()}</span>
                        </div>

                        <div className="section-actions">
                          <button
                            data-action="edit-full"
                            className="primary tiny"
                            type="button"
                            onClick={() => handleCardAction("edit-full", capture.id, index)}
                          >
                            Edit
                          </button>
                          <button
                            data-action="move-up"
                            className="ghost tiny"
                            type="button"
                            onClick={() => handleCardAction("move-up", capture.id, index)}
                          >
                            Up
                          </button>
                          <button
                            data-action="move-down"
                            className="ghost tiny"
                            type="button"
                            onClick={() => handleCardAction("move-down", capture.id, index)}
                          >
                            Down
                          </button>
                          <button
                            data-action="delete"
                            className="danger tiny"
                            type="button"
                            onClick={() => handleCardAction("delete", capture.id, index)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <img
                        className="capture-image"
                        src={capture.imageData}
                        alt="Captured page segment"
                        onClick={() => openEditorModal(capture.id).catch((error) => console.error(error))}
                      />

                      <h4>Documentation Notes</h4>
                      <textarea
                        className="rich-note section-note"
                        value={capture.note || ""}
                        placeholder="Add documentation for this screenshot..."
                        onChange={(event) => handleSectionNoteChange(capture.id, event.target.value)}
                        onBlur={(event) =>
                          handleSectionNoteBlur(capture.id, event.target.value).catch((error) => console.error(error))
                        }
                      />
                    </article>
                  ))
                )}
              </section>
            </article>
          </section>
        </div>
      </div>

      <div
        id="editorModal"
        className={`editor-modal ${editorOpen ? "" : "hidden"}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeEditorModal();
          }
        }}
      >
        <div className="editor-dialog">
          <header className="editor-modal-header">
            <div>
              <h3 id="modalCaptureTitle">{editorCaptureTitle}</h3>
              <p>Annotate in full view and write notes before finalizing.</p>
            </div>
            <button id="modalCloseBtn" className="ghost" type="button" disabled={modalBusy} onClick={() => closeEditorModal()}>
              Close
            </button>
          </header>

          <div className="editor-modal-toolbar">
            <div className="tool-row">
              <button
                id="modalPenBtn"
                className={`tool-btn ${modalTool === TOOL_PEN ? "active" : ""}`}
                type="button"
                disabled={modalBusy || !modalImageReady}
                onClick={() => setModalTool(TOOL_PEN)}
              >
                Pen
              </button>
              <button
                id="modalRectBtn"
                className={`tool-btn ${modalTool === TOOL_RECT ? "active" : ""}`}
                type="button"
                disabled={modalBusy || !modalImageReady}
                onClick={() => setModalTool(TOOL_RECT)}
              >
                Rectangle
              </button>
              <button
                id="modalArrowBtn"
                className={`tool-btn ${modalTool === TOOL_ARROW ? "active" : ""}`}
                type="button"
                disabled={modalBusy || !modalImageReady}
                onClick={() => setModalTool(TOOL_ARROW)}
              >
                Arrow
              </button>
              <button
                id="modalTextBtn"
                className={`tool-btn ${modalTool === TOOL_TEXT ? "active" : ""}`}
                type="button"
                disabled={modalBusy || !modalImageReady}
                onClick={() => setModalTool(TOOL_TEXT)}
              >
                Text
              </button>
            </div>

            <div className="tool-row">
              <label className="modal-field" htmlFor="modalStrokeColorInput">
                <span>Color</span>
                <input
                  id="modalStrokeColorInput"
                  type="color"
                  value={modalStrokeColor}
                  disabled={modalBusy || !modalImageReady}
                  onChange={(event) => setModalStrokeColor(event.target.value)}
                />
              </label>
              <label className="modal-field" htmlFor="modalStrokeWidthInput">
                <span>Size</span>
                <input
                  id="modalStrokeWidthInput"
                  type="range"
                  min="1"
                  max="16"
                  step="1"
                  value={modalStrokeWidth}
                  disabled={modalBusy || !modalImageReady}
                  onChange={(event) => setModalStrokeWidth(Number(event.target.value))}
                />
              </label>
              <button
                id="modalUndoBtn"
                className="ghost tiny"
                type="button"
                disabled={modalBusy || !modalImageReady || !modalHasShapes}
                onClick={undoModalShape}
              >
                Undo
              </button>
              <button
                id="modalClearBtn"
                className="ghost tiny"
                type="button"
                disabled={modalBusy || !modalImageReady || !modalHasShapes}
                onClick={clearModalShapes}
              >
                Clear
              </button>
            </div>
          </div>

          <div id="modalCanvasWrap" className="editor-modal-canvas-wrap" ref={modalCanvasWrapRef}>
            <canvas
              id="modalCanvas"
              ref={modalCanvasRef}
              aria-label="Full screenshot editor"
              style={{ pointerEvents: modalBusy || !modalImageReady ? "none" : "auto" }}
              onPointerDown={onModalPointerDown}
              onPointerMove={onModalPointerMove}
              onPointerUp={onModalPointerUp}
              onPointerCancel={onModalPointerUp}
            />
          </div>

          <label className="modal-note-label" htmlFor="modalNoteInput">
            Documentation Note
          </label>
          <textarea
            id="modalNoteInput"
            className="modal-note-input"
            placeholder="Write documentation for this screen..."
            disabled={modalBusy || !modalImageReady}
            value={editorNote}
            onChange={(event) => setEditorNote(event.target.value)}
          />

          <footer className="editor-modal-footer">
            <button
              id="modalCancelBtn"
              className="ghost"
              type="button"
              disabled={modalBusy}
              onClick={() => closeEditorModal()}
            >
              Cancel
            </button>
            <button
              id="modalSaveBtn"
              className="primary"
              type="button"
              disabled={modalBusy || !modalImageReady}
              onClick={() => saveModalChanges().catch((error) => console.error(error))}
            >
              Save Changes
            </button>
          </footer>
        </div>
      </div>

      <div
        id="templateModal"
        className={`template-modal ${templateModalOpen ? "" : "hidden"}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeTemplateModal();
          }
        }}
      >
        <div className="template-dialog">
          <header className="template-header">
            <div>
              <h3>Choose PDF Design</h3>
              <p>Select a design, preview it, then export your documentation.</p>
            </div>
            <button id="templateCloseBtn" className="ghost" type="button" onClick={closeTemplateModal}>
              Close
            </button>
          </header>

          <div className="template-layout">
            <aside id="templateList" className="template-list" aria-label="PDF template options">
              {PDF_TEMPLATES.map((template) => {
                const isActive = template.id === templateSelectionId;

                return (
                  <button
                    key={template.id}
                    type="button"
                    className={`template-option ${isActive ? "active" : ""}`}
                    onClick={() => setTemplateSelectionId(template.id)}
                  >
                    <div className="template-option-head">
                      <strong>{template.name}</strong>
                    </div>
                    <p>{template.description}</p>
                    <div className={`template-mini-preview mini-${template.id}`}>
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    <p className="template-hint">Base HTML: {template.baseHtmlFile}</p>
                  </button>
                );
              })}
            </aside>

            <section className="template-preview-panel">
              <div className="template-preview-head">
                <h4 id="templatePreviewTitle">{templateForModal.name}</h4>
                <p id="templatePreviewDescription">{templateForModal.description}</p>
                <p className="template-hint">
                  Template Guide: <code>templates/TEMPLATE_GUIDE.md</code>
                </p>
              </div>

              <div className="template-preview-shell">
                <div id="templatePreviewContent">
                  <TemplatePreviewPaper
                    title={docTitle.trim() || "Untitled Documentation"}
                    overview={overview}
                    captures={captures}
                    templateClassName={templateForModal.className}
                  />
                </div>
              </div>
            </section>
          </div>

          <footer className="template-footer">
            <button id="templatePreviewBtn" className="ghost" type="button" onClick={handlePreviewTemplate}>
              Preview On Page
            </button>
            <button id="templateExportBtn" className="primary" type="button" onClick={handleExportWithTemplate}>
              Export Selected PDF
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}

function TemplatePreviewPaper({ title, overview, captures, templateClassName }) {
  return (
    <article className={`paper template-preview-paper ${templateClassName}`}>
      <header className="paper-header">
        <h1>{title}</h1>
        <p>{`Preview generated ${new Date().toLocaleString()}`}</p>
      </header>

      <section className="intro-block">
        <h3>Overview</h3>
        <div className="rich-note preview-note">{overview || "No overview provided yet."}</div>
      </section>

      <section id="sectionsContainer">
        {captures.length === 0 ? (
          <p style={{ color: "#58687a" }}>No captures in workspace yet.</p>
        ) : (
          captures.map((capture) => (
            <article className="section-card" key={`preview-${capture.id}`}>
              <div className="section-header">
                <div className="section-meta">
                  <span className="capture-badge">{captureTypeLabel(capture.captureType)}</span>
                  <span className="page-link">{capture.url || capture.title || "Page"}</span>
                  <span className="time-stamp">{new Date(capture.createdAt).toLocaleString()}</span>
                </div>
              </div>

              <img className="capture-image" src={capture.imageData} alt="Captured page segment" />

              <h4>Documentation Notes</h4>
              <div className="rich-note preview-note">
                {capture.note || "No note written for this screenshot yet."}
              </div>
            </article>
          ))
        )}
      </section>
    </article>
  );
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

    for (let index = 1; index < shape.points.length; index += 1) {
      const point = shape.points[index];
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
