import type { ScanQuad, ScanSettings } from './scannerTypes';
export type ScanResult = {
  blob: Blob;
  thumbnail?: Blob;
  width: number;
  height: number;
  quad: ScanQuad;
  detected: boolean;
  sharpness?: number;
  light?: number;
};
export type ScanRequest = {
  action: 'prepare' | 'detect' | 'render';
  blob: Blob;
  quad?: ScanQuad;
  settings?: ScanSettings;
  maxEdge?: number;
};
export class ScannerClient {
  private worker?: Worker;
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: ScanResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  run(request: ScanRequest) {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/scanner.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = ({ data }) => {
        if (data.fatal) {
          this.close(data.error);
          return;
        }
        const task = this.pending.get(data.id);
        if (!task) return;
        clearTimeout(task.timer);
        this.pending.delete(data.id);
        if (data.error) task.reject(new Error(data.error));
        else task.resolve(data.result);
      };
      this.worker.onerror = () =>
        this.close('The scanner could not load. Check your connection and try again.');
    }
    const id = ++this.next;
    return new Promise<ScanResult>((resolve, reject) => {
      const timer = setTimeout(
        () => this.close('This scan took too long. Try a smaller image or reopen the scanner.'),
        90000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, ...request });
    });
  }
  close(message = 'Scanning stopped.') {
    this.worker?.terminate();
    this.worker = undefined;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(message));
    }
    this.pending.clear();
  }
}
