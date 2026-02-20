export function normalizeEditorData(rawData, fallbackText = "") {
  if (rawData && typeof rawData === "object" && Array.isArray(rawData.blocks)) {
    return {
      ...rawData,
      blocks: rawData.blocks.map((block) => ({
        ...block,
        data: { ...(block.data || {}) }
      }))
    };
  }

  if (typeof rawData === "string" && rawData.trim()) {
    try {
      const parsed = JSON.parse(rawData);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.blocks)) {
        return normalizeEditorData(parsed, fallbackText);
      }
    } catch {
      return textToEditorData(rawData);
    }
  }

  return textToEditorData(fallbackText);
}

export function textToEditorData(text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return { blocks: [] };
  }

  const blocks = normalizedText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: "paragraph",
      data: {
        text: escapeHtml(paragraph)
      }
    }));

  return { blocks };
}

export function editorDataToPlainText(rawData) {
  const data = normalizeEditorData(rawData, "");
  const lines = [];

  for (const block of data.blocks || []) {
    const value = getBlockPlainText(block);
    if (value) {
      lines.push(value.trim());
    }
  }

  return lines.join("\n\n").trim();
}

function getBlockPlainText(block) {
  if (!block || typeof block !== "object") {
    return "";
  }

  const type = block.type;
  const blockData = block.data || {};

  if (type === "paragraph" || type === "header" || type === "quote") {
    return stripHtml(blockData.text || "");
  }

  if (type === "list") {
    return flattenListItems(blockData.items || []).join("\n");
  }

  if (type === "checklist") {
    const items = Array.isArray(blockData.items) ? blockData.items : [];
    return items
      .map((item) => stripHtml(item?.text || ""))
      .filter(Boolean)
      .join("\n");
  }

  if (type === "code") {
    return String(blockData.code || "").trim();
  }

  if (type === "delimiter") {
    return "---";
  }

  if (blockData.text) {
    return stripHtml(blockData.text);
  }

  return "";
}

function flattenListItems(items) {
  const output = [];

  const walk = (value) => {
    if (typeof value === "string") {
      const text = stripHtml(value);
      if (text) {
        output.push(text);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    if (typeof value.content === "string") {
      const text = stripHtml(value.content);
      if (text) {
        output.push(text);
      }
    }

    if (Array.isArray(value.items)) {
      value.items.forEach((item) => walk(item));
    }
  };

  items.forEach((item) => walk(item));
  return output;
}

function stripHtml(text) {
  const value = String(text || "");

  if (typeof window !== "undefined" && typeof window.DOMParser === "function") {
    const parser = new window.DOMParser();
    const parsed = parser.parseFromString(`<body>${value}</body>`, "text/html");
    return parsed.body.textContent?.replace(/\s+/g, " ").trim() || "";
  }

  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
