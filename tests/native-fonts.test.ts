import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readText, editText } from '../src/workers/text.ts';
import type { NativeTextEdit } from '../src/lib/types.ts';

const engine = init({ wasmBinary: await readFile('public/pdfium.wasm') }).then((p) => {
  p.PDFiumExt_Init();
  return p;
});
const fontBytes = await readFile('public/fonts/NotoSans-Regular.ttf');
function heap(p: WrappedPdfiumModule) {
  return (p.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}
async function withDocument(bytes: Uint8Array, run: (p: WrappedPdfiumModule, doc: number) => void) {
  const p = await engine,
    ptr = p.pdfium.wasmExports.malloc(bytes.length);
  heap(p).set(bytes, ptr);
  const doc = p.FPDF_LoadMemDocument(ptr, bytes.length, '');
  assert.ok(doc);
  try {
    run(p, doc);
  } finally {
    p.FPDF_CloseDocument(doc);
    p.pdfium.wasmExports.free(ptr);
  }
}
function inspect(p: WrappedPdfiumModule, doc: number) {
  const page = p.FPDF_LoadPage(doc, 0);
  try {
    return readText(p, page);
  } finally {
    p.FPDF_ClosePage(page);
  }
}
function textMatrix(p: WrappedPdfiumModule, doc: number, index: number) {
  const page = p.FPDF_LoadPage(doc, 0),
    ptr = p.pdfium.wasmExports.malloc(24);
  try {
    assert.ok(p.FPDFPageObj_GetMatrix(p.FPDFPage_GetObject(page, index), ptr));
    return Array.from({ length: 6 }, (_, i) => p.pdfium.getValue(ptr + i * 4, 'float'));
  } finally {
    p.pdfium.wasmExports.free(ptr);
    p.FPDF_ClosePage(page);
  }
}
function edit(path: number[], text: string, extras: Partial<NativeTextEdit> = {}): NativeTextEdit {
  return { id: 'test', page: 0, path, text, remove: false, delta: [0, 0], scale: 1, ...extras };
}
async function fixture(fontName: StandardFonts | 'full' | 'subset', text = 'Original text') {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    fontName === 'full' || fontName === 'subset' ? fontBytes : fontName,
    { subset: fontName === 'subset' },
  );
  doc.addPage([600, 800]).drawText(text, {
    font,
    size: 18,
    x: 70,
    y: 620,
    rotate: degrees(12),
    xSkew: degrees(3),
    color: rgb(0.2, 0.3, 0.5),
  });
  return doc.save();
}
function serialized(p: WrappedPdfiumModule, doc: number) {
  const writer = p.PDFiumExt_OpenFileWriter();
  try {
    assert.ok(p.FPDF_SaveAsCopy(doc, writer, 2));
    const size = p.PDFiumExt_GetFileWriterSize(writer),
      ptr = p.pdfium.wasmExports.malloc(size);
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
for (const fontName of [
  StandardFonts.Helvetica,
  StandardFonts.TimesRomanBoldItalic,
  StandardFonts.CourierBold,
  'full',
] as const) {
  test(`native text edit preserves ${fontName}, baseline and transform after saving`, async () => {
    let output: Uint8Array | undefined;
    let originalMatrix: number[];
    await withDocument(await fixture(fontName), (p, doc) => {
      const before = inspect(p, doc)[0];
      originalMatrix = textMatrix(p, doc, before.path[0]);
      assert.equal(before.text, 'Original text');
      editText(p, doc, [edit(before.path, 'A better line')]);
      const after = inspect(p, doc)[0];
      assert.equal(after.text, 'A better line');
      assert.equal(after.fontName, before.fontName);
      assert.equal(after.fontEmbedded, before.fontEmbedded);
      assert.equal(after.size, before.size);
      assert.equal(after.color, before.color);
      output = serialized(p, doc);
    });
    await withDocument(output!, (p, doc) => {
      const result = inspect(p, doc)[0];
      assert.equal(result.text, 'A better line');
      assert.ok(!result.fontName.includes('Noto') || fontName === 'full');
      const page = p.FPDF_LoadPage(doc, 0),
        object = p.FPDFPage_GetObject(page, result.path[0]),
        ptr = p.pdfium.wasmExports.malloc(24);
      try {
        assert.ok(p.FPDFPageObj_GetMatrix(object, ptr));
        assert.ok(Math.abs(p.pdfium.getValue(ptr + 16, 'float') - 70) < 0.01);
        assert.ok(Math.abs(p.pdfium.getValue(ptr + 20, 'float') - 620) < 0.01);
        for (let i = 0; i < 6; i++)
          assert.ok(
            Math.abs(p.pdfium.getValue(ptr + i * 4, 'float') - originalMatrix[i]) < 0.00001,
          );
      } finally {
        p.pdfium.wasmExports.free(ptr);
        p.FPDF_ClosePage(page);
      }
    });
  });
}
test('subset fonts reuse available glyphs and reject missing letters instead of silently substituting', async () => {
  await withDocument(await fixture('subset', 'ABBA'), (p, doc) => {
    const before = inspect(p, doc)[0];
    assert.equal(before.fontEmbedded, true);
    editText(p, doc, [edit(before.path, 'BABA')]);
    assert.equal(inspect(p, doc)[0].text, 'BABA');
    assert.throws(
      () => editText(p, doc, [edit(before.path, 'ZEBRA')]),
      /does not contain all the characters/,
    );
  });
});
test('native replacement supports removing text and retains explicit position/size edits', async () => {
  await withDocument(await fixture(StandardFonts.Helvetica), (p, doc) => {
    const before = inspect(p, doc)[0];
    editText(p, doc, [edit(before.path, 'Moved text', { delta: [20, -30], scale: 2 })]);
    const after = inspect(p, doc)[0];
    assert.equal(after.fontName, before.fontName);
    const page = p.FPDF_LoadPage(doc, 0),
      ptr = p.pdfium.wasmExports.malloc(24);
    try {
      p.FPDFPageObj_GetMatrix(p.FPDFPage_GetObject(page, after.path[0]), ptr);
      assert.equal(p.pdfium.getValue(ptr + 16, 'float'), 90);
      assert.equal(p.pdfium.getValue(ptr + 20, 'float'), 590);
    } finally {
      p.pdfium.wasmExports.free(ptr);
      p.FPDF_ClosePage(page);
    }
    editText(p, doc, [edit(before.path, '')]);
    assert.deepEqual(inspect(p, doc), []);
  });
});
test('nested text refuses an unsafe font-preserving save and explicit replacement removes the original', async () => {
  const inner = await PDFDocument.create();
  const font = await inner.embedFont(StandardFonts.TimesRomanItalic);
  inner.addPage([300, 200]).drawText('Nested text', { font, size: 16, x: 30, y: 90 });
  const outer = await PDFDocument.create();
  const [embedded] = await outer.embedPdf(await inner.save());
  outer.addPage([600, 800]).drawPage(embedded, { x: 90, y: 300, xScale: 1.5, yScale: 1.2 });
  let output: Uint8Array | undefined;
  await withDocument(await outer.save(), (p, doc) => {
    const before = inspect(p, doc)[0];
    assert.ok(before.path.length > 1);
    assert.throws(() => editText(p, doc, [edit(before.path, 'Nested test')]), /nested text/);
    assert.equal(inspect(p, doc)[0].text, 'Nested text');
    editText(p, doc, [edit(before.path, '', { remove: true })]);
    output = serialized(p, doc);
  });
  await withDocument(output!, (p, doc) => assert.deepEqual(inspect(p, doc), []));
});
