import { openDB } from "idb";

const DB_NAME = "drone-logbook";
const DB_VERSION = 1;
const STORE = "entries";
const LEGACY_KEY = "drone-flight-log-entries";

let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("sourceId", "sourceId");
      },
    });
  }
  return dbPromise;
}

let lastId = 0;

// Ids are millisecond timestamps as strings (matches entries created before
// IndexedDB); bumped when called twice in the same millisecond.
export function newId() {
  let t = Date.now();
  if (t <= lastId) t = lastId + 1;
  lastId = t;
  return String(t);
}

// One-time import of entries saved by the old localStorage version. The live
// key is cleared afterwards so this never re-runs, but the raw payload is kept
// under a backup key in case anything goes wrong.
export async function migrateFromLocalStorage() {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return 0;
  let legacy;
  try {
    legacy = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(legacy)) return 0;
  const db = await getDB();
  const tx = db.transaction(STORE, "readwrite");
  let migrated = 0;
  for (const entry of legacy) {
    if (!entry?.id) continue;
    const existing = await tx.store.get(entry.id);
    if (!existing) {
      await tx.store.put(entry);
      migrated++;
    }
  }
  await tx.done;
  localStorage.setItem(`${LEGACY_KEY}-pre-idb-backup`, raw);
  localStorage.removeItem(LEGACY_KEY);
  return migrated;
}

export async function getAllEntries() {
  const db = await getDB();
  const all = await db.getAll(STORE);
  return all.sort(
    (a, b) =>
      (b.date || "").localeCompare(a.date || "") ||
      (Number(b.id) || 0) - (Number(a.id) || 0)
  );
}

export async function putEntry(entry) {
  const db = await getDB();
  await db.put(STORE, entry);
}

export async function deleteEntryById(id) {
  const db = await getDB();
  await db.delete(STORE, id);
}

// Adds entries that aren't already present. An entry is a duplicate if its id
// or its sourceId matches an existing one (or one accepted earlier in the same
// batch). Returns { added, skipped }.
export async function mergeEntries(incoming) {
  const db = await getDB();
  const tx = db.transaction(STORE, "readwrite");
  const existing = await tx.store.getAll();
  const ids = new Set(existing.map((e) => e.id));
  const sourceIds = new Set(existing.filter((e) => e.sourceId).map((e) => e.sourceId));
  let added = 0;
  let skipped = 0;
  for (const entry of incoming) {
    if (!entry || typeof entry !== "object" || !entry.id) {
      skipped++;
      continue;
    }
    if (ids.has(entry.id) || (entry.sourceId && sourceIds.has(entry.sourceId))) {
      skipped++;
      continue;
    }
    await tx.store.put(entry);
    ids.add(entry.id);
    if (entry.sourceId) sourceIds.add(entry.sourceId);
    added++;
  }
  await tx.done;
  return { added, skipped };
}
