import type { Output } from './types';
export class CloudError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function cloudResponse(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: init.signal || AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new CloudError(
      response.status,
      data.error || 'Cloud workspace is temporarily unavailable.',
    );
  }
  return response;
}
export async function cloudJson<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await cloudResponse(path, {
    method,
    ...(data === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  return response.json();
}
export async function uploadCloud(file: File | Output, template = false) {
  const body =
    file instanceof File
      ? file
      : new Blob([new Uint8Array(file.bytes)], { type: 'application/pdf' });
  return (
    await cloudResponse('/api/cloud/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'x-file-name': encodeURIComponent(file.name),
        'x-template': String(template),
      },
      body,
    })
  ).json();
}
export function cloudMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Something went wrong. Please retry.';
}
