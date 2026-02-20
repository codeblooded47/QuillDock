import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearCaptures,
  deleteCapture,
  getAllCaptures,
  reorderCaptures,
  updateCapture
} from "../../db.js";
import { loadMeta, saveMeta } from "./storage.js";
import EditorJsField from "./EditorJsField.jsx";
import {
  editorDataToPlainText,
  normalizeEditorData,
  textToEditorData
} from "./editorjs-utils.js";
import {
  DEFAULT_SECTION_TEMPLATE_FILE,
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
const TEMPLATE_LOOP_START = "{{#SECTIONS}}";
const TEMPLATE_LOOP_END = "{{/SECTIONS}}";
const CAPTURE_MARKER_PREFIX = "[capture-id:";
const CAPTURE_MARKER_REGEX = /\[capture-id:([^\]]+)\]/;
const TEMPLATE_VARIABLES = [
  "{{DOCUMENT_TITLE}}",
  "{{GENERATED_AT}}",
  "{{OVERVIEW}}",
  "{{OVERVIEW_TEXT}}",
  "{{SECTION_COUNT}}",
  "{{SECTIONS_HTML}}",
  "{{#SECTIONS}} ... {{/SECTIONS}}",
  "{{INDEX}}",
  "{{CAPTURE_ID}}",
  "{{CAPTURE_TYPE}}",
  "{{CAPTURE_TYPE_RAW}}",
  "{{PAGE_TITLE}}",
  "{{PAGE_URL}}",
  "{{TIMESTAMP}}",
  "{{NOTE}}",
  "{{NOTE_TEXT}}",
  "{{IMAGE_DATA}}"
];

export default function App() {
  const [captures, setCaptures] = useState([]);
  const [docTitle, setDocTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [workspaceBlocks, setWorkspaceBlocks] = useState(() => ({ blocks: [] }));
  const [hiddenCaptureIds, setHiddenCaptureIds] = useState(() => []);
  const [workspaceEditorRevision, setWorkspaceEditorRevision] = useState(0);
  const [overviewBlocks, setOverviewBlocks] = useState(() => textToEditorData(""));
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(Date.now());

  const [dragCaptureId, setDragCaptureId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [dropPosition, setDropPosition] = useState("after");

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateSelectionId, setTemplateSelectionId] = useState(DEFAULT_TEMPLATE_ID);
  const [templateOverrides, setTemplateOverrides] = useState({});
  const [templateDocumentInput, setTemplateDocumentInput] = useState("");
  const [templateSectionInput, setTemplateSectionInput] = useState("");
  const [templateDefaultDocument, setTemplateDefaultDocument] = useState("");
  const [templateDefaultSection, setTemplateDefaultSection] = useState("");
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templatePreviewError, setTemplatePreviewError] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCaptureId, setEditorCaptureId] = useState(null);
  const [editorCaptureTitle, setEditorCaptureTitle] = useState("Edit Screenshot");
  const [editorNote, setEditorNote] = useState("");
  const [editorNoteBlocks, setEditorNoteBlocks] = useState(() => textToEditorData(""));
  const [editorNoteEditorRevision, setEditorNoteEditorRevision] = useState(0);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalTool, setModalTool] = useState(TOOL_PEN);
  const [modalStrokeColor, setModalStrokeColor] = useState("#ff0000");
  const [modalStrokeWidth, setModalStrokeWidth] = useState(3);
  const [modalImageReady, setModalImageReady] = useState(false);
  const [shapeVersion, setShapeVersion] = useState(0);

  const capturesRef = useRef([]);
  const workspaceBlocksRef = useRef({ blocks: [] });
  const hiddenCaptureIdsRef = useRef([]);
  const metaSaveTimerRef = useRef(null);
  const noteSaveTimersRef = useRef(new Map());
  const dirtyNoteIdsRef = useRef(new Set());
  const templateSourceCacheRef = useRef(new Map());

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
  const exportCaptures = useMemo(
    () => buildExportCapturesFromWorkspace(captures, workspaceBlocks, hiddenCaptureIds),
    [captures, hiddenCaptureIds, workspaceBlocks]
  );
  const templatePreviewResult = useMemo(() => {
    if (!templateDocumentInput.trim()) {
      return { html: "", error: "" };
    }

    try {
      const html = renderDocumentationTemplate({
        documentTemplate: templateDocumentInput,
        sectionTemplate: templateSectionInput,
        title: docTitle.trim() || "Untitled Documentation",
        overview,
        captures: exportCaptures
      });

      return { html, error: "" };
    } catch (error) {
      return {
        html: "",
        error: error?.message || "Failed to render preview HTML. Check your template variables."
      };
    }
  }, [docTitle, exportCaptures, overview, templateDocumentInput, templateSectionInput]);

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
      const normalizedWorkspaceBlocks = normalizeEditorData(overrides.workspaceBlocks ?? workspaceBlocks, "");
      const meta = {
        title: (overrides.title ?? docTitle).trim(),
        overview: (overrides.overview ?? overview).trim(),
        overviewBlocks: normalizeEditorData(overrides.overviewBlocks ?? overviewBlocks),
        workspaceBlocks: serializeWorkspaceBlocks(normalizedWorkspaceBlocks),
        hiddenCaptureIds: normalizeHiddenCaptureIds(
          overrides.hiddenCaptureIds ?? hiddenCaptureIds,
          capturesRef.current
        ),
        templateId: normalizeTemplateId(overrides.templateId ?? selectedTemplateId),
        templateOverrides: overrides.templateOverrides ?? templateOverrides
      };

      await saveMeta(meta);
      touchDocument();
    },
    [
      docTitle,
      hiddenCaptureIds,
      overview,
      overviewBlocks,
      selectedTemplateId,
      templateOverrides,
      touchDocument,
      workspaceBlocks
    ]
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

  const getTemplateDefaults = useCallback(async (templateId) => {
    const normalizedTemplateId = normalizeTemplateId(templateId);

    if (templateSourceCacheRef.current.has(normalizedTemplateId)) {
      return templateSourceCacheRef.current.get(normalizedTemplateId);
    }

    const template = getTemplateById(normalizedTemplateId);
    const [documentTemplate, sectionTemplate] = await Promise.all([
      loadTemplateText(template.baseHtmlFile),
      loadTemplateText(template.sectionHtmlFile || DEFAULT_SECTION_TEMPLATE_FILE)
    ]);

    const defaults = { documentTemplate, sectionTemplate };
    templateSourceCacheRef.current.set(normalizedTemplateId, defaults);
    return defaults;
  }, []);

  const syncTemplateEditorFromSelection = useCallback(
    async (templateId, shouldStoreDefaults = false) => {
      const normalizedTemplateId = normalizeTemplateId(templateId);
      setTemplateLoading(true);
      setTemplatePreviewError("");

      try {
        const defaults = await getTemplateDefaults(normalizedTemplateId);
        const override = templateOverrides[normalizedTemplateId] || {};

        setTemplateDocumentInput(override.documentTemplate ?? defaults.documentTemplate);
        setTemplateSectionInput(override.sectionTemplate ?? defaults.sectionTemplate);

        if (shouldStoreDefaults) {
          setTemplateDefaultDocument(defaults.documentTemplate);
          setTemplateDefaultSection(defaults.sectionTemplate);
        }
      } catch (error) {
        console.error(error);
        setTemplatePreviewError(error?.message || "Failed to load template files.");
      } finally {
        setTemplateLoading(false);
      }
    },
    [getTemplateDefaults, templateOverrides]
  );

  const refreshCaptures = useCallback(async () => {
    const loadedCaptures = await getAllCaptures();
    const nextCaptures = loadedCaptures.map((capture) => normalizeCaptureForEditor(capture));
    const nextHiddenCaptureIds = normalizeHiddenCaptureIds(hiddenCaptureIdsRef.current, nextCaptures);
    const nextWorkspaceBlocks = syncWorkspaceBlocksWithCaptures({
      workspaceBlocks: workspaceBlocksRef.current,
      captures: nextCaptures,
      overview,
      hiddenCaptureIds: nextHiddenCaptureIds
    });

    capturesRef.current = nextCaptures;
    workspaceBlocksRef.current = nextWorkspaceBlocks;
    hiddenCaptureIdsRef.current = nextHiddenCaptureIds;
    setCaptures(nextCaptures);
    setHiddenCaptureIds(nextHiddenCaptureIds);
    setWorkspaceBlocks(nextWorkspaceBlocks);
    setWorkspaceEditorRevision((current) => current + 1);
    touchDocument();
    return nextCaptures;
  }, [overview, touchDocument]);

  const scheduleNoteSave = useCallback(
    (captureId, note, noteBlocks) => {
      const pendingTimer = noteSaveTimersRef.current.get(captureId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
      }

      dirtyNoteIdsRef.current.add(captureId);
      const normalizedNoteBlocks = normalizeEditorData(noteBlocks, note);

      const timerId = setTimeout(() => {
        updateCapture(captureId, { note: note.trim(), noteBlocks: normalizedNoteBlocks })
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

        await updateCapture(captureId, {
          note: (capture.note || "").trim(),
          noteBlocks: normalizeEditorData(capture.noteBlocks, capture.note || "")
        });
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
      setEditorNoteBlocks(textToEditorData(""));
      setEditorNoteEditorRevision((current) => current + 1);
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
      setEditorNoteBlocks(normalizeEditorData(capture.noteBlocks, capture.note || ""));
      setEditorNoteEditorRevision((current) => current + 1);
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
        const normalizedOverviewBlocks = normalizeEditorData(meta.overviewBlocks, meta.overview || "");
        let normalizedCaptures = loadedCaptures.map((capture) => normalizeCaptureForEditor(capture));
        const normalizedHiddenCaptureIds = normalizeHiddenCaptureIds(meta.hiddenCaptureIds, normalizedCaptures);
        const initialWorkspaceBlocks = syncWorkspaceBlocksWithCaptures({
          workspaceBlocks: normalizeEditorData(meta.workspaceBlocks, ""),
          captures: normalizedCaptures,
          overview: meta.overview || "",
          hiddenCaptureIds: normalizedHiddenCaptureIds
        });
        const extractedWorkspace = extractWorkspaceSummaryAndNotes(initialWorkspaceBlocks);
        normalizedCaptures = mergeCaptureNotesFromWorkspace(normalizedCaptures, extractedWorkspace.captureNotes);

        setDocTitle(meta.title || "");
        setOverview(extractedWorkspace.overviewText || editorDataToPlainText(normalizedOverviewBlocks));
        setOverviewBlocks(normalizedOverviewBlocks);
        setWorkspaceBlocks(initialWorkspaceBlocks);
        setHiddenCaptureIds(normalizedHiddenCaptureIds);
        setWorkspaceEditorRevision((current) => current + 1);
        setSelectedTemplateId(normalizedTemplateId);
        setTemplateSelectionId(normalizedTemplateId);
        setTemplateOverrides(meta.templateOverrides || {});

        capturesRef.current = normalizedCaptures;
        workspaceBlocksRef.current = initialWorkspaceBlocks;
        hiddenCaptureIdsRef.current = normalizedHiddenCaptureIds;
        setCaptures(normalizedCaptures);
        touchDocument();

        const url = new URL(window.location.href);
        const pendingEditCaptureId = url.searchParams.get("editCaptureId");

        if (pendingEditCaptureId) {
          await openEditorModal(pendingEditCaptureId, normalizedCaptures);
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
    workspaceBlocksRef.current = workspaceBlocks;
  }, [workspaceBlocks]);

  useEffect(() => {
    hiddenCaptureIdsRef.current = hiddenCaptureIds;
  }, [hiddenCaptureIds]);

  useEffect(() => {
    const shouldLockScroll = editorOpen || templateModalOpen;
    document.body.classList.toggle("modal-open", shouldLockScroll);

    return () => {
      document.body.classList.remove("modal-open");
    };
  }, [editorOpen, templateModalOpen]);

  useEffect(() => {
    if (!templateModalOpen) {
      return;
    }

    syncTemplateEditorFromSelection(templateSelectionId, true).catch((error) => {
      console.error(error);
      setTemplateLoading(false);
      setTemplatePreviewError(error?.message || "Failed to initialize template editor.");
    });
  }, [syncTemplateEditorFromSelection, templateModalOpen, templateSelectionId]);

  useEffect(() => {
    if (!templatePreviewError) {
      return;
    }

    setTemplatePreviewError("");
  }, [templateDocumentInput, templatePreviewError, templateSectionInput]);

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

  useEffect(() => {
    const flushBeforeLeave = () => {
      if (metaSaveTimerRef.current) {
        clearTimeout(metaSaveTimerRef.current);
        metaSaveTimerRef.current = null;
      }

      persistMetaNow({
        workspaceBlocks: workspaceBlocksRef.current,
        hiddenCaptureIds: hiddenCaptureIdsRef.current
      }).catch((error) => console.error(error));

      saveAllCurrentNotes().catch((error) => console.error(error));
    };

    window.addEventListener("pagehide", flushBeforeLeave);
    window.addEventListener("beforeunload", flushBeforeLeave);

    return () => {
      window.removeEventListener("pagehide", flushBeforeLeave);
      window.removeEventListener("beforeunload", flushBeforeLeave);
    };
  }, [persistMetaNow, saveAllCurrentNotes]);

  const handleDocTitleChange = (event) => {
    const value = event.target.value;
    setDocTitle(value);
    scheduleMetaSave({ title: value });
  };

  const handleWorkspaceEditorChange = (data) => {
    const normalizedData = normalizeEditorData(data, "");
    const extracted = extractWorkspaceSummaryAndNotes(normalizedData);
    const attachedCaptureIds = collectAttachedCaptureIds(normalizedData);
    const nextHiddenCaptureIds = buildHiddenCaptureIds({
      captures: capturesRef.current,
      attachedCaptureIds,
      existingHiddenCaptureIds: hiddenCaptureIdsRef.current
    });

    setWorkspaceBlocks(normalizedData);
    workspaceBlocksRef.current = normalizedData;
    setHiddenCaptureIds(nextHiddenCaptureIds);
    hiddenCaptureIdsRef.current = nextHiddenCaptureIds;

    setOverview(extracted.overviewText);
    setOverviewBlocks(textToEditorData(extracted.overviewText));

    setCaptures((current) => {
      const next = current.map((capture) => {
        const noteFromWorkspace = extracted.captureNotes.get(capture.id);
        if (typeof noteFromWorkspace !== "string") {
          return capture;
        }

        const normalizedNote = noteFromWorkspace.trim();
        if (normalizedNote === (capture.note || "").trim()) {
          return capture;
        }

        const normalizedBlocks = textToEditorData(normalizedNote);
        scheduleNoteSave(capture.id, normalizedNote, normalizedBlocks);

        return {
          ...capture,
          note: normalizedNote,
          noteBlocks: normalizedBlocks
        };
      });

      capturesRef.current = next;
      return next;
    });

    scheduleMetaSave({
      overview: extracted.overviewText,
      overviewBlocks: textToEditorData(extracted.overviewText),
      workspaceBlocks: normalizedData,
      hiddenCaptureIds: nextHiddenCaptureIds
    });
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
    setHiddenCaptureIds([]);
    hiddenCaptureIdsRef.current = [];
    const emptyWorkspace = buildInitialWorkspaceBlocks("");
    const emptyOverviewBlocks = textToEditorData("");
    setOverview("");
    setOverviewBlocks(emptyOverviewBlocks);
    setWorkspaceBlocks(emptyWorkspace);
    workspaceBlocksRef.current = emptyWorkspace;
    setWorkspaceEditorRevision((current) => current + 1);
    await persistMetaNow({
      overview: "",
      overviewBlocks: emptyOverviewBlocks,
      workspaceBlocks: emptyWorkspace,
      hiddenCaptureIds: []
    });
    touchDocument();
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
    openEditorModal(captureId).catch((error) => console.error(error));
  };

  const handleExportClick = async () => {
    const currentWorkspace = normalizeEditorData(workspaceBlocksRef.current, "");
    const attachedCaptureIds = collectAttachedCaptureIds(currentWorkspace);
    const nextHiddenCaptureIds = buildHiddenCaptureIds({
      captures: capturesRef.current,
      attachedCaptureIds,
      existingHiddenCaptureIds: hiddenCaptureIdsRef.current
    });

    setHiddenCaptureIds(nextHiddenCaptureIds);
    hiddenCaptureIdsRef.current = nextHiddenCaptureIds;

    await persistMetaNow({
      workspaceBlocks: currentWorkspace,
      hiddenCaptureIds: nextHiddenCaptureIds
    });
    await saveAllCurrentNotes();

    setTemplateSelectionId(selectedTemplateId);
    setTemplateModalOpen(true);
  };

  const closeTemplateModal = () => {
    setTemplateModalOpen(false);
  };

  const buildTemplateOverridesPayload = useCallback(() => {
    const normalizedTemplateId = normalizeTemplateId(templateSelectionId);
    return {
      ...templateOverrides,
      [normalizedTemplateId]: {
        documentTemplate: templateDocumentInput,
        sectionTemplate: templateSectionInput
      }
    };
  }, [templateDocumentInput, templateOverrides, templateSectionInput, templateSelectionId]);

  const saveCurrentTemplateOverrides = useCallback(async () => {
    const normalizedTemplateId = normalizeTemplateId(templateSelectionId);
    const nextTemplateOverrides = buildTemplateOverridesPayload();
    setTemplateOverrides(nextTemplateOverrides);
    setSelectedTemplateId(normalizedTemplateId);

    await persistMetaNow({
      templateId: normalizedTemplateId,
      templateOverrides: nextTemplateOverrides
    });

    return { normalizedTemplateId, nextTemplateOverrides };
  }, [buildTemplateOverridesPayload, persistMetaNow, templateSelectionId]);

  const handleResetTemplateEdits = async () => {
    const normalizedTemplateId = normalizeTemplateId(templateSelectionId);
    const defaults = await getTemplateDefaults(normalizedTemplateId);

    setTemplateDocumentInput(defaults.documentTemplate);
    setTemplateSectionInput(defaults.sectionTemplate);
    setTemplateDefaultDocument(defaults.documentTemplate);
    setTemplateDefaultSection(defaults.sectionTemplate);

    const nextTemplateOverrides = { ...templateOverrides };
    delete nextTemplateOverrides[normalizedTemplateId];

    setTemplateOverrides(nextTemplateOverrides);

    await persistMetaNow({
      templateOverrides: nextTemplateOverrides
    });
  };

  const handleSaveTemplateEdits = async () => {
    await saveCurrentTemplateOverrides();
  };

  const handlePreviewTemplate = async () => {
    await saveCurrentTemplateOverrides();
    closeTemplateModal();
  };

  const handleExportWithTemplate = async () => {
    await saveCurrentTemplateOverrides();
    closeTemplateModal();
    await nextFrame();

    const { html, error } = templatePreviewResult;
    if (error || !html.trim()) {
      window.alert(error || "Template output is empty. Fix template syntax before export.");
      return;
    }

    try {
      await printHtmlWithHiddenIframe(html);
    } catch (printError) {
      console.error(printError);
      window.alert("PDF export failed. Please try again.");
    }
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

  const handleModalNoteEditorChange = (data) => {
    const normalizedData = normalizeEditorData(data, "");
    setEditorNoteBlocks(normalizedData);
    setEditorNote(editorDataToPlainText(normalizedData));
  };

  const saveModalChanges = async () => {
    if (!editorCaptureId || !modalImageReady || modalBusy) {
      return;
    }

    setModalBusy(true);

    try {
      const normalizedModalNoteBlocks = normalizeEditorData(editorNoteBlocks, editorNote);
      const modalNoteText = editorDataToPlainText(normalizedModalNoteBlocks);
      const updates = {
        note: modalNoteText.trim(),
        noteBlocks: normalizedModalNoteBlocks
      };

      if (modalShapesRef.current.length > 0) {
        updates.imageData = await renderModalAnnotatedImageData();
      }

      await updateCapture(editorCaptureId, updates);

      closeEditorModal(true);
      await refreshCaptures();
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

              <section className="workspace-editor-wrap">
                <EditorJsField
                  key={`workspace-editor-${workspaceEditorRevision}`}
                  id="workspaceEditor"
                  className="workspace-editor editorjs-surface"
                  initialData={workspaceBlocks}
                  placeholder="Start documenting this flow. New screenshots are added as image blocks."
                  minHeight={720}
                  onCaptureImageClick={(captureId) => {
                    openEditorModal(captureId).catch((error) => console.error(error));
                  }}
                  onChange={handleWorkspaceEditorChange}
                />
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
          <EditorJsField
            key={`modal-note-${editorCaptureId || "none"}-${editorNoteEditorRevision}`}
            id="modalNoteInput"
            className="modal-note-input editorjs-surface modal-editor-note"
            initialData={editorNoteBlocks}
            placeholder="Write documentation for this screen..."
            minHeight={130}
            allowImageBlocks={false}
            onChange={handleModalNoteEditorChange}
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
                <p className="template-hint">
                  Loop support: <code>{TEMPLATE_LOOP_START}</code> ... <code>{TEMPLATE_LOOP_END}</code>
                </p>
              </div>

              <div className="template-preview-shell">
                <div id="templatePreviewContent">
                  {templateLoading ? (
                    <p className="template-hint">Loading template files...</p>
                  ) : (
                    <iframe
                      title="Template HTML Preview"
                      className="template-preview-frame"
                      srcDoc={templatePreviewResult.html}
                    />
                  )}
                </div>
              </div>

              {templatePreviewError || templatePreviewResult.error ? (
                <div className="template-render-error">
                  {templatePreviewError || templatePreviewResult.error}
                </div>
              ) : null}

              <div className="template-editor-grid">
                <label className="template-editor-card" htmlFor="templateDocumentInput">
                  <span>Document HTML Template</span>
                  <textarea
                    id="templateDocumentInput"
                    className="template-editor-textarea"
                    value={templateDocumentInput}
                    onChange={(event) => setTemplateDocumentInput(event.target.value)}
                    spellCheck={false}
                  />
                </label>

                <label className="template-editor-card" htmlFor="templateSectionInput">
                  <span>Section HTML Template (for each capture)</span>
                  <textarea
                    id="templateSectionInput"
                    className="template-editor-textarea"
                    value={templateSectionInput}
                    onChange={(event) => setTemplateSectionInput(event.target.value)}
                    spellCheck={false}
                  />
                </label>
              </div>

              <div className="template-variable-row">
                {TEMPLATE_VARIABLES.map((variableToken) => (
                  <span key={variableToken} className="template-variable-chip">
                    {variableToken}
                  </span>
                ))}
              </div>

              <div className="template-meta-row">
                <span className="template-hint">
                  Source document: <code>{templateForModal.baseHtmlFile}</code>
                </span>
                <span className="template-hint">
                  Source section: <code>{templateForModal.sectionHtmlFile || DEFAULT_SECTION_TEMPLATE_FILE}</code>
                </span>
                <span className="template-hint">
                  Default document length: {templateDefaultDocument.length} chars
                </span>
                <span className="template-hint">
                  Default section length: {templateDefaultSection.length} chars
                </span>
              </div>
            </section>
          </div>

          <footer className="template-footer">
            <button
              className="ghost"
              type="button"
              disabled={templateLoading}
              onClick={() => handleResetTemplateEdits().catch((error) => console.error(error))}
            >
              Reset To Example
            </button>
            <button
              className="ghost"
              type="button"
              disabled={templateLoading}
              onClick={() => handleSaveTemplateEdits().catch((error) => console.error(error))}
            >
              Save Template
            </button>
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

async function loadTemplateText(templatePath) {
  const response = await fetch(templatePath);
  if (!response.ok) {
    throw new Error(`Failed to load template file: ${templatePath}`);
  }

  return response.text();
}

function normalizeCaptureForEditor(capture) {
  const noteBlocks = normalizeEditorData(capture.noteBlocks, capture.note || "");
  return {
    ...capture,
    note: editorDataToPlainText(noteBlocks),
    noteBlocks
  };
}

function normalizeHiddenCaptureIds(rawHiddenCaptureIds, captures = []) {
  const allowedIds = new Set(captures.map((capture) => capture.id));
  const rawList = Array.isArray(rawHiddenCaptureIds) ? rawHiddenCaptureIds : [];
  const hiddenSet = new Set();

  for (const rawId of rawList) {
    const captureId = String(rawId || "").trim();
    if (!captureId) {
      continue;
    }

    if (allowedIds.size > 0 && !allowedIds.has(captureId)) {
      continue;
    }

    hiddenSet.add(captureId);
  }

  return Array.from(hiddenSet);
}

function collectAttachedCaptureIds(workspaceBlocks) {
  const normalizedWorkspaceData = normalizeEditorData(workspaceBlocks, "");
  const attachedIds = new Set();

  for (const block of normalizedWorkspaceData.blocks || []) {
    if (block?.type !== "image") {
      continue;
    }

    const captureId = parseCaptureIdFromCaption(block?.data?.caption || "");
    if (captureId) {
      attachedIds.add(captureId);
    }
  }

  return attachedIds;
}

function buildHiddenCaptureIds({ captures, attachedCaptureIds, existingHiddenCaptureIds }) {
  const hiddenSet = new Set(normalizeHiddenCaptureIds(existingHiddenCaptureIds, captures));

  for (const capture of captures) {
    if (attachedCaptureIds.has(capture.id)) {
      hiddenSet.delete(capture.id);
      continue;
    }

    hiddenSet.add(capture.id);
  }

  return Array.from(hiddenSet);
}

function serializeWorkspaceBlocks(workspaceBlocks) {
  const normalizedWorkspaceData = normalizeEditorData(workspaceBlocks, "");
  const blocks = (normalizedWorkspaceData.blocks || []).map((block) => {
    const nextBlock = {
      ...block,
      data: { ...(block.data || {}) }
    };

    if (nextBlock.type === "image") {
      const captureId = parseCaptureIdFromCaption(nextBlock.data?.caption || "");
      if (captureId) {
        nextBlock.data.file = {
          ...((nextBlock.data && nextBlock.data.file) || {}),
          url: ""
        };
      }
    }

    return nextBlock;
  });

  return {
    ...normalizedWorkspaceData,
    blocks
  };
}

function buildExportCapturesFromWorkspace(captures, workspaceBlocks, hiddenCaptureIds) {
  const hiddenSet = new Set(normalizeHiddenCaptureIds(hiddenCaptureIds, captures));
  const captureMap = new Map(captures.map((capture) => [capture.id, capture]));
  const normalizedWorkspaceData = normalizeEditorData(workspaceBlocks, "");
  const orderedIds = [];
  const seenIds = new Set();

  for (const block of normalizedWorkspaceData.blocks || []) {
    if (block?.type !== "image") {
      continue;
    }

    const captureId = parseCaptureIdFromCaption(block?.data?.caption || "");
    if (!captureId || seenIds.has(captureId) || hiddenSet.has(captureId)) {
      continue;
    }

    if (!captureMap.has(captureId)) {
      continue;
    }

    orderedIds.push(captureId);
    seenIds.add(captureId);
  }

  for (const capture of captures) {
    if (hiddenSet.has(capture.id) || seenIds.has(capture.id)) {
      continue;
    }

    orderedIds.push(capture.id);
    seenIds.add(capture.id);
  }

  return orderedIds
    .map((captureId) => captureMap.get(captureId))
    .filter(Boolean);
}

function buildInitialWorkspaceBlocks(overview) {
  const baseBlocks = [
    {
      type: "paragraph",
      data: {
        text: "<b>Overview</b>"
      }
    },
    {
      type: "paragraph",
      data: {
        text: escapeHtml(overview || "").replace(/\n/g, "<br />")
      }
    }
  ];

  return { blocks: baseBlocks };
}

function createCaptureMarker(captureId) {
  return `${CAPTURE_MARKER_PREFIX}${captureId}]`;
}

function parseCaptureIdFromCaption(caption) {
  const rawCaption = String(caption || "");
  const match = CAPTURE_MARKER_REGEX.exec(rawCaption);
  return match?.[1] || null;
}

function buildCaptureImageCaption(capture, existingCaption = "") {
  const marker = createCaptureMarker(capture.id);
  const titlePart = (capture.title || "").trim();
  const cleanedCaption = String(existingCaption || "").replace(CAPTURE_MARKER_REGEX, "").trim();
  const suffix = cleanedCaption || titlePart;
  return suffix ? `${marker} ${suffix}` : marker;
}

function buildCaptureEditorBlocks(capture) {
  const metadata = [
    captureTypeLabel(capture.captureType),
    capture.url || capture.title || "Page",
    formatDateTime(capture.createdAt)
  ]
    .map((value) => escapeHtml(value || ""))
    .join(" • ");

  return [
    {
      type: "paragraph",
      data: {
        text: `<b>${metadata}</b>`
      }
    },
    {
      type: "image",
      data: {
        file: { url: capture.imageData || "" },
        caption: buildCaptureImageCaption(capture),
        withBorder: false,
        withBackground: false,
        stretched: false
      }
    },
    {
      type: "paragraph",
      data: {
        text: escapeHtml(capture.note || "").replace(/\n/g, "<br />")
      }
    }
  ];
}

function syncWorkspaceBlocksWithCaptures({ workspaceBlocks, captures, overview, hiddenCaptureIds = [] }) {
  const normalizedWorkspaceData = normalizeEditorData(workspaceBlocks, "");
  const hiddenSet = new Set(normalizeHiddenCaptureIds(hiddenCaptureIds, captures));
  const baseBlocks = Array.isArray(normalizedWorkspaceData.blocks)
    ? normalizedWorkspaceData.blocks.map((block) => {
        const nextBlock = { ...block, data: { ...(block.data || {}) } };
        if (nextBlock.data.file && typeof nextBlock.data.file === "object") {
          nextBlock.data.file = { ...nextBlock.data.file };
        }
        return nextBlock;
      })
    : [];

  const capturesById = new Map(captures.map((capture) => [capture.id, capture]));
  const attachedCaptureIds = new Set();
  const keptBlocks = [];

  for (const block of baseBlocks) {
    if (block.type === "image") {
      const captureId = parseCaptureIdFromCaption(block.data?.caption || "");

      if (captureId) {
        const capture = capturesById.get(captureId);
        if (!capture) {
          continue;
        }

        if (hiddenSet.has(captureId)) {
          continue;
        }

        attachedCaptureIds.add(captureId);
        keptBlocks.push({
          ...block,
          data: {
            ...(block.data || {}),
            file: {
              ...((block.data && block.data.file) || {}),
              url: capture.imageData || ""
            },
            caption: buildCaptureImageCaption(capture, block.data?.caption || "")
          }
        });
        continue;
      }
    }

    keptBlocks.push(block);
  }

  let nextBlocks = keptBlocks;

  if (nextBlocks.length === 0) {
    nextBlocks = buildInitialWorkspaceBlocks(overview || "").blocks;
  }

  for (const capture of captures) {
    if (attachedCaptureIds.has(capture.id) || hiddenSet.has(capture.id)) {
      continue;
    }

    nextBlocks.push(...buildCaptureEditorBlocks(capture));
  }

  return {
    ...normalizedWorkspaceData,
    blocks: nextBlocks
  };
}

function extractWorkspaceSummaryAndNotes(workspaceBlocks) {
  const normalizedWorkspaceData = normalizeEditorData(workspaceBlocks, "");
  const blocks = Array.isArray(normalizedWorkspaceData.blocks) ? normalizedWorkspaceData.blocks : [];
  const captureNotes = new Map();

  let firstCaptureImageIndex = blocks.length;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const isCaptureImage = block.type === "image" && Boolean(parseCaptureIdFromCaption(block.data?.caption || ""));
    if (isCaptureImage) {
      firstCaptureImageIndex = index;
      break;
    }
  }

  const overviewTextParts = [];
  for (let index = 0; index < firstCaptureImageIndex; index += 1) {
    const text = editorDataToPlainText({ blocks: [blocks[index]] });
    if (text) {
      overviewTextParts.push(text);
    }
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type !== "image") {
      continue;
    }

    const captureId = parseCaptureIdFromCaption(block.data?.caption || "");
    if (!captureId) {
      continue;
    }

    const noteParts = [];
    for (let nextIndex = index + 1; nextIndex < blocks.length; nextIndex += 1) {
      const nextBlock = blocks[nextIndex];

      if (nextBlock.type === "image" && parseCaptureIdFromCaption(nextBlock.data?.caption || "")) {
        break;
      }

      const candidateText = editorDataToPlainText({ blocks: [nextBlock] });
      if (candidateText) {
        noteParts.push(candidateText);
      }
    }

    captureNotes.set(captureId, noteParts.join("\n\n").trim());
  }

  const combinedOverviewText = overviewTextParts.join("\n\n").trim();
  return {
    overviewText: combinedOverviewText,
    captureNotes
  };
}

function mergeCaptureNotesFromWorkspace(captures, captureNotes) {
  if (!captureNotes || captureNotes.size === 0) {
    return captures;
  }

  return captures.map((capture) => {
    if (!captureNotes.has(capture.id)) {
      return capture;
    }

    const nextNote = String(captureNotes.get(capture.id) || "").trim();
    return {
      ...capture,
      note: nextNote,
      noteBlocks: textToEditorData(nextNote)
    };
  });
}

function printHtmlWithHiddenIframe(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");

    const cleanup = () => {
      iframe.remove();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Failed to open in-page print frame."));
    };

    iframe.onload = () => {
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) {
        onError();
        return;
      }

      let completed = false;
      const finalize = () => {
        if (completed) {
          return;
        }
        completed = true;
        cleanup();
        resolve();
      };

      frameWindow.addEventListener("afterprint", finalize, { once: true });

      window.setTimeout(() => {
        finalize();
      }, 1800);

      window.setTimeout(() => {
        try {
          frameWindow.focus();
          frameWindow.print();
        } catch (error) {
          cleanup();
          reject(error);
        }
      }, 120);
    };

    iframe.onerror = onError;
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      onError();
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();
  });
}

function renderDocumentationTemplate({ documentTemplate, sectionTemplate, title, overview, captures }) {
  if (!documentTemplate || !documentTemplate.trim()) {
    throw new Error("Document template is empty.");
  }

  const generatedAt = formatDateTime(Date.now());
  const globalVariables = {
    DOCUMENT_TITLE: escapeHtml(title || "Untitled Documentation"),
    GENERATED_AT: escapeHtml(generatedAt),
    OVERVIEW: textToHtml(overview || ""),
    OVERVIEW_TEXT: escapeHtml(overview || ""),
    SECTION_COUNT: String(captures.length)
  };

  const sectionVariables = captures.map((capture, index) =>
    buildSectionTemplateVariables(capture, index, globalVariables)
  );

  const safeSectionTemplate = sectionTemplate?.trim()
    ? sectionTemplate
    : `<article class=\"section\"><h4>Section {{INDEX}}</h4><img class=\"section-image\" src=\"{{IMAGE_DATA}}\" alt=\"Capture {{INDEX}}\" /><div class=\"section-note\">{{NOTE}}</div></article>`;

  const sectionsHtml = sectionVariables
    .map((item) => replaceTemplateTokens(safeSectionTemplate, item))
    .join("\n");

  const documentWithLoop = documentTemplate.replace(
    /{{#SECTIONS}}([\s\S]*?){{\/SECTIONS}}/g,
    (_, loopTemplate) =>
      sectionVariables.map((item) => replaceTemplateTokens(loopTemplate, item)).join("\n")
  );

  const renderedHtml = replaceTemplateTokens(documentWithLoop, {
    ...globalVariables,
    SECTIONS_HTML: sectionsHtml
  });

  return injectExportSafetyStyles(renderedHtml);
}

function injectExportSafetyStyles(html) {
  const safetyStyle = `
<style id="quilldock-export-safety">
  * { box-sizing: border-box; }
  html,
  body {
    width: 100%;
    max-width: 100%;
    margin: 0 !important;
    padding: 0 !important;
  }
  img {
    display: block;
    max-width: 100% !important;
    height: auto !important;
  }
  .section,
  .section-card,
  article {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .section-image,
  .capture-image,
  .section img,
  article img {
    margin: 10px 0;
    width: 100% !important;
    max-width: 100% !important;
    object-fit: contain !important;
    object-position: top left !important;
  }
  .section-url,
  .page-link {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  @page {
    size: auto;
    margin: 0;
  }
  @media print {
    html,
    body {
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .paper,
    .doc,
    .letter,
    .template-preview-paper,
    main,
    article {
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }

    .section-image,
    .capture-image,
    .section img,
    article img {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      max-height: none !important;
      margin: 10px 0 !important;
      object-fit: contain !important;
      object-position: top left !important;
    }
  }
</style>`;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${safetyStyle}</head>`);
  }

  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${safetyStyle}`);
  }

  return `<!doctype html><html><head>${safetyStyle}</head><body>${html}</body></html>`;
}

function buildSectionTemplateVariables(capture, index, globalVariables) {
  return {
    ...globalVariables,
    INDEX: String(index + 1),
    CAPTURE_ID: escapeHtml(capture.id || ""),
    CAPTURE_TYPE: escapeHtml(captureTypeLabel(capture.captureType)),
    CAPTURE_TYPE_RAW: escapeHtml(capture.captureType || ""),
    PAGE_TITLE: escapeHtml(capture.title || ""),
    PAGE_URL: escapeHtml(capture.url || ""),
    TIMESTAMP: escapeHtml(formatDateTime(capture.createdAt)),
    UPDATED_AT: escapeHtml(formatDateTime(capture.updatedAt || capture.createdAt)),
    NOTE: textToHtml(capture.note || ""),
    NOTE_TEXT: escapeHtml(capture.note || ""),
    IMAGE_DATA: capture.imageData || ""
  };
}

function replaceTemplateTokens(templateText, variables) {
  return templateText.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_, key) => variables[key] ?? "");
}

function escapeHtml(value) {
  const text = String(value ?? "");
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function formatDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }

  return new Date(timestamp).toLocaleString();
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
