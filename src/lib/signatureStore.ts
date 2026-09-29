const DATABASE = 'rovty-pdf-local';
const STORE = 'signatures';
export const MAX_SAVED_SIGNATURES = 20;
export interface SavedSignature {
  id: string;
  name: string;
  image: Blob;
  width: number;
  height: number;
  updatedAt: number;
}
function storageError() {
  return new Error(
    'Signature storage is unavailable or full in this browser. You can turn off “Save on this device” and still use the signature.',
  );
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(storageError());
      request.onblocked = () => reject(storageError());
    } catch {
      reject(storageError());
    }
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, setResult: (value: T) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch {
      db.close();
      reject(storageError());
      return;
    }
    let result: T;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(storageError());
    };
    try {
      action(tx.objectStore(STORE), (value) => {
        result = value;
      });
    } catch (error) {
      tx.abort();
      db.close();
      reject(error);
    }
  });
}
export function listSignatures() {
  return transaction<SavedSignature[]>('readonly', (store, done) => {
    store.getAll().onsuccess = (event) =>
      done(
        (event.target as IDBRequest<SavedSignature[]>).result.sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
      );
  });
}
export async function saveSignature(input: {
  url: string;
  width: number;
  height: number;
  name: string;
}) {
  if (!input.url.startsWith('data:image/png;base64,'))
    throw new Error('Only a prepared PNG signature can be saved.');
  const bytes = Uint8Array.from(atob(input.url.split(',')[1]), (char) => char.charCodeAt(0));
  if (bytes.length > 2 * 1024 * 1024)
    throw new Error(
      'This signature is too large to save. Use a smaller image, or turn off “Save on this device”.',
    );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const item: SavedSignature = {
    id: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    name: input.name.trim().slice(0, 80) || 'My signature',
    image: new Blob([bytes], { type: 'image/png' }),
    width: input.width,
    height: input.height,
    updatedAt: Date.now(),
  };
  const existing = await listSignatures();
  if (existing.length >= MAX_SAVED_SIGNATURES && !existing.some((value) => value.id === item.id))
    throw new Error('You have 20 saved signatures. Delete one before saving another.');
  return transaction<void>('readwrite', (store, done) => {
    // Check again inside the write transaction to handle multiple open tabs.
    store.getAllKeys().onsuccess = (event) => {
      const keys = (event.target as IDBRequest<IDBValidKey[]>).result;
      if (keys.length >= MAX_SAVED_SIGNATURES && !keys.includes(item.id)) {
        store.transaction.abort();
        return;
      }
      store.put(item);
      done();
    };
  });
}
export const deleteSignature = (id: string) =>
  transaction<void>('readwrite', (store, done) => {
    store.delete(id);
    done();
  });
export const clearSignatures = () =>
  transaction<void>('readwrite', (store, done) => {
    store.clear();
    done();
  });
export function signatureDataUrl(image: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(
        new Error('This saved signature could not be read. Delete it and upload another copy.'),
      );
    reader.readAsDataURL(image);
  });
}
