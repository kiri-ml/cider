const DB_NAME = "cider-production-db";
const DB_VERSION = 1;
const STORE = "blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const request = run(store);
    let value: T | undefined;
    if (request) {
      request.onsuccess = () => { value = request.result; };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    }
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await tx("readwrite", (store) => store.put(blob, key));
}

export async function putBlobs(entries: readonly { key: string; blob: Blob }[]): Promise<void> {
  if (entries.length === 0) return;
  await tx("readwrite", (store) => {
    for (const entry of entries) store.put(entry.blob, entry.key);
  });
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await tx<Blob>("readonly", (store) => store.get(key))) ?? undefined;
}

export async function deleteBlob(key: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(key));
}

export async function clearBlobs(): Promise<void> {
  await tx("readwrite", (store) => store.clear());
}
