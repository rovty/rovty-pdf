import type { NativeText } from './types';
import type { FontChoice } from './fontChoice';

export class NativeOperationError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly editId?: string,
    readonly fontChoice?: FontChoice,
  ) {
    super(message);
  }
}

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function terminate(error: Error) {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}
export function native<T = Uint8Array>(
  action: string,
  bytes: Uint8Array,
  options: Record<string, unknown> = {},
): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('../workers/native.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event) => {
      const item = pending.get(event.data.id);
      if (!item) return;
      pending.delete(event.data.id);
      clearTimeout(item.timer);
      if (event.data.error)
        item.reject(
          new NativeOperationError(
            event.data.error,
            event.data.errorCode,
            event.data.editId,
            event.data.fontChoice,
          ),
        );
      else item.resolve(event.data.result);
    };
    worker.onerror = () =>
      terminate(new Error('The PDF engine stopped. Your original file is safe. Please try again.'));
  }
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => terminate(new Error('This PDF took too long to process. Try a smaller document.')),
      120000,
    );
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    worker!.postMessage({ id, action, bytes, ...options });
  });
}
// Reuse extraction for selection/caret/highlight consumers of the same snapshot.
// Weak keys release the cache with the PDF; documents never enter persistent storage.
const textCache = new WeakMap<Uint8Array, Map<string, Promise<NativeText[]>>>();
export function nativeText(bytes: Uint8Array, pageIndex: number, includeGlyphs = false) {
  let pages = textCache.get(bytes);
  if (!pages) textCache.set(bytes, (pages = new Map()));
  const key = `${pageIndex}:${includeGlyphs}`;
  let result = pages.get(key) || (!includeGlyphs ? pages.get(`${pageIndex}:true`) : undefined);
  if (!result) {
    result = native<NativeText[]>('text', bytes, { pageIndex, includeGlyphs }).catch((error) => {
      pages.delete(key);
      throw error;
    });
    pages.set(key, result);
  }
  return result;
}
export const cancelNative = () => terminate(new Error('Processing canceled.'));
