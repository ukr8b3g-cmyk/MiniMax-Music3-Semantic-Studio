const DB_NAME = "m3ss-vst3-library";
const DB_VERSION = 1;
const STORE = "presets";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("IndexedDB is unavailable in this browser."));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Could not open VST3 preset database."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("plugin_key", "plugin_key", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function transaction(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let value;
    try { value = run(store); } catch (error) { db.close(); reject(error); return; }
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onerror = () => { const error = tx.error || new Error("VST3 preset database transaction failed."); db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error || new Error("VST3 preset database transaction was aborted."); db.close(); reject(error); };
  }));
}

export function vst3PluginKey(path, pluginName = "") {
  return `${String(path || "").trim().toLowerCase()}::${String(pluginName || "").trim().toLowerCase()}`;
}

export async function listVst3Presets(pluginKey) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const index = tx.objectStore(STORE).index("plugin_key");
      const request = index.getAll(IDBKeyRange.only(String(pluginKey || "")));
      request.onerror = () => reject(request.error || new Error("Could not read VST3 presets."));
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? request.result : [];
        rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")) || Number(b.updated_at || 0) - Number(a.updated_at || 0));
        resolve(rows);
      };
    });
  } finally {
    db.close();
  }
}

export async function saveVst3Preset(record) {
  const now = Date.now();
  const row = {
    ...record,
    id: String(record?.id || globalThis.crypto?.randomUUID?.() || `preset-${now}-${Math.random().toString(16).slice(2)}`),
    plugin_key: String(record?.plugin_key || ""),
    name: String(record?.name || "Preset").trim() || "Preset",
    created_at: Number(record?.created_at) || now,
    updated_at: now,
  };
  await transaction("readwrite", (store) => store.put(row));
  return row;
}

export async function deleteVst3Preset(id) {
  await transaction("readwrite", (store) => store.delete(String(id || "")));
}
