import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { NativeText, NativeTextEdit } from '../lib/types';
import { readText, editText } from './text';

let ready: Promise<WrappedPdfiumModule> | undefined;
function engine() {
  return (ready ??= fetch('/pdfium.wasm')
    .then(async (response) => {
      if (!response.ok)
        throw new Error('The PDF engine could not load. Refresh the page and try again.');
      const instance = await init({ wasmBinary: await response.arrayBuffer() });
      instance.PDFiumExt_Init();
      return instance;
    })
    .catch((error) => {
      ready = undefined;
      throw error;
    }));
}
function allocate(p: WrappedPdfiumModule, size: number) {
  const pointer = p.pdfium.wasmExports.malloc(Math.max(size, 1));
  if (!pointer) throw new Error('Not enough browser memory for this PDF.');
  return pointer;
}
function heap(p: WrappedPdfiumModule) {
  return (p.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}
function save(p: WrappedPdfiumModule, doc: number) {
  const writer = p.PDFiumExt_OpenFileWriter();
  try {
    if (!p.FPDF_SaveAsCopy(doc, writer, 2))
      throw new Error('The PDF engine could not save this document.');
    const size = p.PDFiumExt_GetFileWriterSize(writer),
      ptr = allocate(p, size);
    try {
      p.PDFiumExt_GetFileWriterData(writer, ptr, size);
      return heap(p).slice(ptr, ptr + size);
    } finally {
      p.pdfium.wasmExports.free(ptr);
    }
  } finally {
    p.PDFiumExt_CloseFileWriter(writer);
  }
}

self.onmessage = async (event: MessageEvent) => {
  const {
    id,
    action,
    bytes,
    password = '',
    pageIndex = 0,
    removals = [],
    newPassword = '',
    ownerPassword = '',
  } = event.data;
  let p: WrappedPdfiumModule | undefined,
    pointer = 0,
    doc = 0;
  try {
    p = await engine();
    pointer = allocate(p, bytes.length);
    heap(p).set(bytes, pointer);
    doc = p.FPDF_LoadMemDocument(pointer, bytes.length, password);
    if (!doc) {
      if (p.FPDF_GetLastError() === 4) throw new Error('PASSWORD_REQUIRED');
      throw new Error('This file could not be read as a PDF.');
    }
    let result: NativeText[] | Uint8Array | { encrypted: boolean };
    if (action === 'text') {
      const page = p.FPDF_LoadPage(doc, pageIndex);
      if (!page) throw new Error('This page could not be opened.');
      try {
        result = readText(p, page, Boolean(event.data.includeGlyphs));
      } finally {
        p.FPDF_ClosePage(page);
      }
    } else if (action === 'inspect') {
      result = { encrypted: p.EPDF_IsEncrypted(doc) };
    } else {
      if (action === 'edit-text' || action === 'remove-text') {
        const edits: NativeTextEdit[] =
          action === 'edit-text'
            ? event.data.edits
            : removals.map((r: { page: number; path: number[] }) => ({ ...r, remove: true }));
        editText(p, doc, edits);
      } else if (action === 'protect') {
        if (!newPassword) throw new Error('Enter a password before protecting your PDF.');
        if (
          !p.EPDF_SetEncryption(doc, newPassword, ownerPassword || crypto.randomUUID(), 0xfffffffc)
        )
          throw new Error('This PDF could not be encrypted.');
      } else if (action === 'unlock') {
        if (p.EPDF_IsEncrypted(doc) && !p.EPDF_RemoveEncryption(doc))
          throw new Error('The owner password is required to remove this protection.');
      }
      result = save(p, doc);
    }
    if (result instanceof Uint8Array)
      self.postMessage({ id, result }, { transfer: [result.buffer] });
    else self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error ? error.message : 'The PDF engine could not complete this action.',
    });
  } finally {
    if (p && doc) p.FPDF_CloseDocument(doc);
    if (p && pointer) p.pdfium.wasmExports.free(pointer);
  }
};
