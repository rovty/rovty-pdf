import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { init } from '@embedpdf/pdfium';
import { PDFDocument } from 'pdf-lib';
import { highlightGeometry } from '../src/lib/highlights.ts';
import { drawHighlight } from '../src/lib/highlightExport.ts';
import type { Mark, PageInfo } from '../src/lib/types.ts';

test('text highlights preserve partial ranges and separate lines while clipping and merging fragments', () => {
  assert.deepEqual(
    highlightGeometry(
      [
        { x: 30, y: 20, width: 20, height: 10 },
        { x: 50, y: 20, width: 30, height: 10 },
        { x: 30, y: 20, width: 20, height: 10 },
        { x: 10, y: 40, width: 25, height: 10 },
        { x: -5, y: 60, width: 10, height: 10 },
        { x: 200, y: 20, width: 10, height: 10 },
      ],
      100,
      100,
    ),
    {
      x: 0,
      y: 20,
      width: 80,
      height: 50,
      highlightRects: [
        { x: 30, y: 0, width: 50, height: 10 },
        { x: 10, y: 20, width: 25, height: 10 },
        { x: 0, y: 40, width: 5, height: 10 },
      ],
    },
  );
  assert.equal(highlightGeometry([], 100, 100), undefined);
});

test('highlight export keeps text gaps clear and renders freehand joints with uniform opacity', async () => {
  const document = await PDFDocument.create(),
    page = document.addPage([300, 400]);
  const info: PageInfo = { width: 300, height: 400, rotation: 0, transform: [1, 0, 0, -1, 0, 400] };
  const base: Mark = {
    id: 'h',
    page: 0,
    kind: 'highlight',
    x: 20,
    y: 20,
    width: 100,
    height: 30,
    color: '#ffcc00',
    opacity: 0.4,
    fontSize: 18,
    strokeWidth: 20,
  };
  drawHighlight(
    page,
    {
      ...base,
      highlightMode: 'text',
      highlightRects: [
        { x: 20, y: 0, width: 40, height: 12 },
        { x: 0, y: 20, width: 30, height: 12 },
      ],
    },
    info,
  );
  drawHighlight(
    page,
    {
      ...base,
      x: 40,
      y: 120,
      width: 160,
      height: 80,
      highlightMode: 'freehand',
      points: [
        [0, 0],
        [80, 80],
        [160, 0],
      ],
    },
    info,
  );
  const bytes = await document.save();
  const p = await init({ wasmBinary: await readFile('public/pdfium.wasm') });
  p.PDFiumExt_Init();
  const ptr = p.pdfium.wasmExports.malloc(bytes.length);
  const heap = () => (p.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  heap().set(bytes, ptr);
  const doc = p.FPDF_LoadMemDocument(ptr, bytes.length, ''),
    sheet = p.FPDF_LoadPage(doc, 0);
  const bitmap = p.FPDFBitmap_Create(300, 400, 1);
  try {
    p.FPDFBitmap_FillRect(bitmap, 0, 0, 300, 400, 0xffffffff);
    p.FPDF_RenderPageBitmap(bitmap, sheet, 0, 0, 300, 400, 0, 0);
    const start = p.FPDFBitmap_GetBuffer(bitmap),
      stride = p.FPDFBitmap_GetStride(bitmap);
    const pixel = (x: number, y: number) => [
      ...heap().slice(start + y * stride + x * 4, start + y * stride + x * 4 + 3),
    ];
    assert.deepEqual(pixel(25, 25), [255, 255, 255], 'unselected beginning of line is untouched');
    assert.ok(pixel(50, 25)[0] < 200, 'selected text portion is highlighted');
    assert.deepEqual(pixel(50, 36), [255, 255, 255], 'space between selected lines is untouched');
    assert.deepEqual(
      pixel(120, 140),
      [255, 255, 255],
      'freehand stroke does not fill its enclosing rectangle',
    );
    assert.deepEqual(
      pixel(80, 160),
      pixel(120, 200),
      'bend has the same opacity as a straight segment',
    );
    assert.ok(pixel(120, 200)[0] < 200);
  } finally {
    p.FPDFBitmap_Destroy(bitmap);
    p.FPDF_ClosePage(sheet);
    p.FPDF_CloseDocument(doc);
    p.pdfium.wasmExports.free(ptr);
  }
});
