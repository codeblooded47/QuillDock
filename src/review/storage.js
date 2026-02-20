const STORAGE_KEY = "website_doc_meta";
const FALLBACK_KEY = "quilldock_meta";

function hasChromeStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadMeta() {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || {};
  }

  try {
    const raw = window.localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error(error);
    return {};
  }
}

export async function saveMeta(meta) {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: meta
    });
    return;
  }

  window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(meta));
}
