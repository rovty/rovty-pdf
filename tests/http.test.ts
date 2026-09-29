import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytes, body, HttpError } from '../worker/http';

const isStatus = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.status === status;
const request = (stream: ReadableStream<Uint8Array>, signal?: AbortSignal) =>
  new Request('https://pdf.test/api/cloud/files', {
    method: 'POST',
    body: stream,
    duplex: 'half',
    signal,
  } as RequestInit);

test('cloud request reader rejects invalid lengths and bounds streamed uploads', async () => {
  for (const length of ['-1', 'Infinity', '12oops']) {
    await assert.rejects(
      bytes(
        new Request('https://pdf.test', {
          method: 'POST',
          body: 'test',
          headers: { 'Content-Length': length },
        }),
        10,
      ),
      isStatus(400),
    );
  }
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(8));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(bytes(request(stream), 10), isStatus(413));
  assert.equal(cancelled, true);
});

test('stalled uploads time out and cancellation cannot block the error response', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
      return new Promise(() => {});
    },
  });
  await assert.rejects(bytes(request(stream), 100, 10), isStatus(408));
  assert.equal(cancelled, true);
});

test('client cancellation interrupts body reading; valid bounded JSON still works', async () => {
  const controller = new AbortController();
  const pending = bytes(request(new ReadableStream<Uint8Array>(), controller.signal), 100, 1000);
  controller.abort();
  await assert.rejects(pending, isStatus(408));
  assert.deepEqual(
    await body(new Request('https://pdf.test', { method: 'POST', body: '{"label":"Notes"}' })),
    { label: 'Notes' },
  );
  await assert.rejects(
    body(new Request('https://pdf.test', { method: 'POST', body: '[]' })),
    isStatus(400),
  );
});
