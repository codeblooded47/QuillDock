import { useEffect, useMemo, useRef } from "react";
import EditorJS from "@editorjs/editorjs";
import { normalizeEditorData } from "./editorjs-utils.js";

const CAPTURE_MARKER_REGEX = /\[capture-id:([^\]]+)\]/;

function parseCaptureMarker(caption) {
  const rawCaption = String(caption || "");
  const match = CAPTURE_MARKER_REGEX.exec(rawCaption);

  if (!match) {
    return {
      marker: "",
      captureId: null,
      visibleCaption: rawCaption.trim()
    };
  }

  return {
    marker: match[0],
    captureId: match[1],
    visibleCaption: rawCaption.replace(match[0], "").trim()
  };
}

function normalizeImageBlockData(rawData) {
  const data = rawData && typeof rawData === "object" ? rawData : {};
  const file =
    data.file && typeof data.file === "object"
      ? data.file
      : {
          url: ""
        };

  return {
    file: {
      url: typeof file.url === "string" ? file.url : ""
    },
    caption: typeof data.caption === "string" ? data.caption : "",
    withBorder: Boolean(data.withBorder),
    withBackground: Boolean(data.withBackground),
    stretched: Boolean(data.stretched)
  };
}

function createWorkspaceImageTool(onCaptureImageClick) {
  const tryDeleteBlock = (api, block) => {
    if (!api?.blocks || typeof api.blocks.delete !== "function") {
      return false;
    }

    const blockId = block?.id;
    if (blockId && typeof api.blocks.getBlocksCount === "function" && typeof api.blocks.getBlockByIndex === "function") {
      const total = api.blocks.getBlocksCount();
      for (let index = 0; index < total; index += 1) {
        const candidate = api.blocks.getBlockByIndex(index);
        if (candidate?.id === blockId) {
          api.blocks.delete(index);
          return true;
        }
      }
    }

    if (typeof api.blocks.getCurrentBlockIndex === "function") {
      const currentIndex = api.blocks.getCurrentBlockIndex();
      if (Number.isInteger(currentIndex) && currentIndex >= 0) {
        api.blocks.delete(currentIndex);
        return true;
      }
    }

    return false;
  };

  return class WorkspaceImageTool {
    static get toolbox() {
      return {
        title: "Image",
        icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="6.1" cy="7" r="1.2" fill="currentColor"/><path d="M3.5 13l3.4-3.1 2.4 2 2.2-2.1 2.5 3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      };
    }

    static get isReadOnlySupported() {
      return true;
    }

    constructor({ data, readOnly, api, block }) {
      this.data = normalizeImageBlockData(data);
      this.readOnly = Boolean(readOnly);
      this.api = api;
      this.block = block;
      this.imageElement = null;
      this.wrapperElement = null;

      const markerInfo = parseCaptureMarker(this.data.caption);
      this.captureMarker = markerInfo.marker;
      this.captureId = markerInfo.captureId;
      this.visibleCaption = markerInfo.visibleCaption;
    }

    render() {
      const wrapper = document.createElement("figure");
      wrapper.className = "editorjs-image-block";
      this.wrapperElement = wrapper;

      const media = document.createElement("div");
      media.className = "editorjs-image-block__media";

      const image = document.createElement("img");
      image.className = "editorjs-image-block__img";
      image.src = this.data.file.url || "";
      image.alt = this.visibleCaption || "Captured screenshot";
      this.imageElement = image;

      if (this.captureId && typeof onCaptureImageClick === "function") {
        image.classList.add("editorjs-image-block__img--clickable");
        image.title = "Click to edit this screenshot";
        image.addEventListener("click", () => onCaptureImageClick(this.captureId));
      }

      media.append(image);

      const actions = document.createElement("div");
      actions.className = "editorjs-image-block__actions";
      let hasActions = false;

      if (this.captureId && typeof onCaptureImageClick === "function") {
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "editorjs-image-block__edit-btn";
        editButton.textContent = "Edit Screenshot";
        editButton.addEventListener("click", () => onCaptureImageClick(this.captureId));
        actions.append(editButton);
        hasActions = true;
      }

      if (!this.readOnly) {
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "editorjs-image-block__remove-btn";
        removeButton.textContent = "Remove Image";
        removeButton.addEventListener("click", () => {
          const deleted = tryDeleteBlock(this.api, this.block);
          if (deleted) {
            return;
          }

          this.data.file.url = "";
          this.visibleCaption = "";
          if (this.wrapperElement) {
            this.wrapperElement.style.display = "none";
          }
        });
        actions.append(removeButton);
        hasActions = true;
      }

      if (hasActions) {
        media.append(actions);
      }

      wrapper.append(media);

      return wrapper;
    }

    save() {
      const imageUrl = this.imageElement?.src || this.data.file.url || "";

      return {
        file: {
          url: imageUrl
        },
        caption: this.captureMarker || this.data.caption || "",
        withBorder: false,
        withBackground: false,
        stretched: false
      };
    }

    validate(savedData) {
      return Boolean(savedData && savedData.file && savedData.file.url);
    }
  };
}

export default function EditorJsField({
  id,
  initialData,
  placeholder,
  className,
  minHeight = 110,
  onChange,
  onCaptureImageClick,
  allowImageBlocks = true
}) {
  const holderId = useMemo(() => {
    const suffix = Math.random().toString(36).slice(2, 10);
    return `${id}-${suffix}`;
  }, [id]);
  const onCaptureImageClickRef = useRef(onCaptureImageClick);

  useEffect(() => {
    onCaptureImageClickRef.current = onCaptureImageClick;
  }, [onCaptureImageClick]);

  const imageToolClass = useMemo(() => {
    if (!allowImageBlocks) {
      return null;
    }
    return createWorkspaceImageTool((captureId) => {
      if (typeof onCaptureImageClickRef.current === "function") {
        onCaptureImageClickRef.current(captureId);
      }
    });
  }, [allowImageBlocks]);

  const editorRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const startDataRef = useRef(normalizeEditorData(initialData, ""));

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let active = true;

    const editor = new EditorJS({
      holder: holderId,
      data: startDataRef.current,
      placeholder,
      minHeight,
      autofocus: false,
      tools: imageToolClass
        ? {
            image: imageToolClass
          }
        : undefined,
      onReady: () => {
        if (!active) {
          editor.destroy();
          return;
        }

        editorRef.current = editor;
      },
      onChange: async (api) => {
        if (!onChangeRef.current) {
          return;
        }

        const output = await api.saver.save();
        onChangeRef.current(output);
      }
    });

    return () => {
      active = false;
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
  }, [holderId, imageToolClass, minHeight, placeholder]);

  return (
    <div className={className}>
      <div id={holderId} className="editorjs-host" />
    </div>
  );
}
