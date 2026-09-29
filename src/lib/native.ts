import type { NativeText } from './types';

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
      if (event.data.error) item.reject(new Error(event.data.error));
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
export const nativeText = (bytes: Uint8Array, pageIndex: number) =>
  native<NativeText[]>('text', bytes, { pageIndex });
export const cancelNative = () => terminate(new Error('Processing canceled.'));
