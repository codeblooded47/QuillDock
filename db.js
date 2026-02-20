const DB_NAME = "website_doc_capture_db";
const DB_VERSION = 1;
const CAPTURE_STORE = "captures";

let dbPromise;

function openDb() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CAPTURE_STORE)) {
        const store = db.createObjectStore(CAPTURE_STORE, { keyPath: "id" });
        store.createIndex("order", "order", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function normalizeCapture(record) {
  return {
    id: record.id,
    url: record.url,
    title: record.title,
    imageData: record.imageData,
    note: record.note || "",
    noteBlocks: record.noteBlocks || null,
    captureType: record.captureType,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    order: record.order
  };
}

export async function createCapture({ url, title, imageData, captureType, note = "" }) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURE_STORE, "readwrite");
    const store = tx.objectStore(CAPTURE_STORE);

    const now = Date.now();
    const capture = {
      id: crypto.randomUUID(),
      url,
      title,
      imageData,
      note,
      captureType,
      createdAt: now,
      updatedAt: now,
      order: now
    };

    const request = store.add(capture);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(normalizeCapture(capture));
  });
}

export async function getCapture(id) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURE_STORE, "readonly");
    const store = tx.objectStore(CAPTURE_STORE);
    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result ? normalizeCapture(request.result) : null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getAllCaptures() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURE_STORE, "readonly");
    const store = tx.objectStore(CAPTURE_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const sorted = request.result
        .map(normalizeCapture)
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
      resolve(sorted);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function updateCapture(id, updates) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURE_STORE, "readwrite");
    const store = tx.objectStore(CAPTURE_STORE);
    const getRequest = store.get(id);

    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const current = getRequest.result;
      if (!current) {
        reject(new Error(`Capture with id ${id} not found.`));
        return;
      }

      const next = {
        ...current,
        ...updates,
        updatedAt: Date.now()
      };

      const putRequest = store.put(next);
      putRequest.onsuccess = () => resolve(normalizeCapture(next));
      putRequest.onerror = () => reject(putRequest.error);
    };
  });
}

export async function deleteCapture(id) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURE_STORE, "readwrite");
    const store = tx.objectStore(CAPTURE_STORE);
    const request = store.delete(id);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

export async function clearCaptures() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURE_STORE, "readwrite");
    const store = tx.objectStore(CAPTURE_STORE);
    const request = store.clear();

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

export async function reorderCaptures(orderedIds) {
  const captures = await getAllCaptures();
  const byId = new Map(captures.map((capture) => [capture.id, capture]));

  const updates = orderedIds
    .map((id, index) => {
      const capture = byId.get(id);
      if (!capture) {
        return null;
      }

      return {
        ...capture,
        order: Date.now() + index,
        updatedAt: Date.now()
      };
    })
    .filter(Boolean);

  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURE_STORE, "readwrite");
    const store = tx.objectStore(CAPTURE_STORE);

    updates.forEach((capture) => {
      store.put(capture);
    });

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
