// Minimal promise wrapper around IndexedDB.
// Stores: sessions, slides (indexed by sessionId), blobs (fallback video storage).

const DB_NAME = 'tactical-analysis';
const DB_VERSION = 1;

export type StoreName = 'sessions' | 'slides' | 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('slides')) {
        const s = db.createObjectStore('slides', { keyPath: 'id' });
        s.createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Database is open in another tab with an older version. Close other tabs and reload.'));
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

function result<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  return result(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return result(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function getAllByIndex<T>(store: StoreName, index: string, key: string): Promise<T[]> {
  const db = await open();
  return result(db.transaction(store).objectStore(store).index(index).getAll(key)) as Promise<T[]>;
}

/** Put and delete across stores in one atomic transaction. */
export async function write(ops: { put?: [StoreName, unknown][]; del?: [StoreName, string][] }): Promise<void> {
  const stores = new Set<StoreName>([...(ops.put ?? []).map((o) => o[0]), ...(ops.del ?? []).map((o) => o[0])]);
  if (!stores.size) return;
  const db = await open();
  const tx = db.transaction([...stores], 'readwrite');
  for (const [s, v] of ops.put ?? []) tx.objectStore(s).put(v);
  for (const [s, k] of ops.del ?? []) tx.objectStore(s).delete(k);
  await done(tx);
}

export const put = (store: StoreName, value: unknown) => write({ put: [[store, value]] });
export const del = (store: StoreName, key: string) => write({ del: [[store, key]] });
