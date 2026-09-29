import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readText, editText } from '../src/workers/text.ts';
import type { NativeTextEdit } from '../src/lib/types.ts';
import { groupTextLines, textSources } from '../src/lib/textBlocks.ts';
import { inlineLayout } from '../src/lib/inlineLayout.ts';
import { markFromText } from '../src/lib/editorObjects.ts';
import type { SourceFile } from '../src/lib/types.ts';
import { spacedTextFixture } from './fixtures/spaced-text.ts';
import { renderTextLayers } from '../src/workers/textLayers.ts';
import { prepareRecoveryFont, prepareLocalRecoveryFont } from '../src/lib/fontRecovery.ts';
import { localFonts, setLocalFont, removeLocalFont } from '../src/lib/localFonts.ts';
import { caseSubsetFixture } from './fixtures/case-subset.ts';
import { latinModernFixture } from './fixtures/latin-modern.ts';
import { onlineFontFixture } from './fixtures/online-fonts.ts';
import { createSinhalaFont, embedSinhalaFont, drawSinhalaLine } from '../src/lib/sinhala.ts';
import { sinhalaLinesFixture, sinhalaLines, sinhalaColumn } from './fixtures/sinhala-lines.ts';
import { visibleTextSize } from '../src/lib/textMetrics.ts';
import { hiddenBreaksFixture } from './fixtures/hidden-breaks.ts';
import { applyTextEdits } from '../src/lib/textEdits.ts';
import { notoSerifFixture } from './fixtures/noto-serif.ts';
import { createFontInstancer } from '../src/lib/variableFonts.ts';
import { fallbackLinesFixture } from './fixtures/fallback-lines.ts';
import { fallbackFontName } from '../src/workers/fallbackFont.ts';

const engine = init({ wasmBinary: await readFile('public/pdfium.wasm') }).then((p) => {
  p.PDFiumExt_Init();
  return p;
});
const fontBytes = await readFile('public/fonts/NotoSans-Regular.ttf');
test('font fallback replaces only a failing line and preserves its matrix, size, color and other font resources', async () => {
  const bytes = await fallbackLinesFixture();
  const fallback = await prepareRecoveryFont(
    'NotoSerif-Bold',
    await readFile('public/fonts/fallback/NotoSerif-Bold.ttf'),
  );
  let saved: Uint8Array;
  await withDocument(bytes, (p, doc) => {
    const before = inspect(p, doc);
    const changes = [
      edit(before[0].path, 'Menu café', { id: 'failing' }),
      edit(before[1].path, 'MENUM', { id: 'supported' }),
    ];
    assert.throws(
      () => editText(p, doc, changes),
      (error: unknown) =>
        !!error && typeof error === 'object' && 'editId' in error && error.editId === 'failing',
    );
    editText(p, doc, changes, new Map(), new Map([['failing', fallback]]));
    const after = inspect(p, doc);
    assert.equal(after[0].fontName, 'NotoSerif-Bold');
    assert.equal(after[0].text, 'Menu café');
    assert.equal(after[0].size, before[0].size);
    assert.equal(after[0].color, before[0].color);
    assert.deepEqual(after[0].matrix, before[0].matrix);
    assert.equal(after[1].fontName, before[1].fontName);
    assert.equal(after[1].text, 'MENUM');
    assert.deepEqual(after[2], before[2]);
    assert.equal(p.FPDF_GetPageCount(doc), 2);
    saved = serialized(p, doc);
  });
  await withDocument(saved!, (p, doc) => {
    assert.equal(inspect(p, doc)[0].text, 'Menu café');
    const second = p.FPDF_LoadPage(doc, 1);
    const unchanged = readText(p, second)[0];
    assert.equal(unchanged.fontName, 'Georgia-Bold');
    assert.equal(unchanged.text, 'MENU');
    p.FPDF_ClosePage(second);
  });
  await withDocument(bytes, (p, doc) => {
    assert.throws(
      () =>
        editText(
          p,
          doc,
          [edit(inspect(p, doc)[0].path, '中文', { id: 'missing' })],
          new Map(),
          new Map([['missing', fallback]]),
        ),
      /does not contain all the characters/,
    );
  });
  await mkdir('tmp/qa', { recursive: true });
  await writeFile('tmp/qa/fallback-lines-native.pdf', saved!);
});

test('fallback font selection preserves serif and bold/italic choices without pretending to shape Sinhala', async () => {
  assert.equal(fallbackFontName('Georgia-BoldItalic', 'Menu'), 'NotoSerif-BoldItalic');
  assert.equal(fallbackFontName('NotoSerif-Bold', 'Menu'), 'NotoSerif-Bold');
  assert.equal(fallbackFontName('Arial-Italic', 'Menu'), 'NotoSans-Italic');
  assert.equal(fallbackFontName('IskoolaPota', 'සිංහල'), undefined);
  for (const style of ['Regular', 'Bold', 'Italic', 'BoldItalic']) {
    const font = await prepareRecoveryFont(
      `NotoSerif-${style}`,
      await readFile(`public/fonts/fallback/NotoSerif-${style}.ttf`),
      'Noto Serif',
    );
    assert.ok(font.pdf.length);
  }
});
test('variable Noto Serif Bold restores uppercase/lowercase and accented characters with the original outlines', async (t) => {
  const variable = await readFile('tests/fixtures/online-fonts/NotoSerif-Variable.ttf');
  const wasm = await readFile('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm');
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, '/font-instance.wasm');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return new Response(wasm);
  });
  const make = await createFontInstancer(wasm);
  const parsed = fontkit.create(make(variable, { wght: 700, wdth: 100 }));
  assert.deepEqual((parsed as typeof parsed & { variationAxes: object }).variationAxes, {});
  assert.deepEqual(
    parsed.characterSet,
    fontkit.create(variable).characterSet,
    'complete Unicode coverage survives pinning',
  );
  const recovered = await prepareRecoveryFont('NotoSerif-Bold', variable, 'Noto Serif');
  const regular = await prepareRecoveryFont('NotoSerif-Regular', variable, 'Noto Serif');
  for (const original of ['MENU', 'menu'] as const) {
    const bytes = await notoSerifFixture(original);
    await withDocument(bytes, (p, doc) => {
      assert.throws(
        () => editText(p, doc, [edit(inspect(p, doc)[0].path, 'Menu menu MENU café')]),
        /does not contain all the characters/,
      );
    });
    await withDocument(bytes, (p, doc) => {
      assert.throws(
        () =>
          editText(
            p,
            doc,
            [edit(inspect(p, doc)[0].path, 'Menu menu MENU café')],
            new Map([['NotoSerif-Bold', regular]]),
          ),
        /could not be verified/,
        'regular is not accepted for bold',
      );
    });
    let saved: Uint8Array;
    await withDocument(bytes, (p, doc) => {
      const before = inspect(p, doc)[0];
      editText(
        p,
        doc,
        [edit(before.path, 'Menu menu MENU café')],
        new Map([['NotoSerif-Bold', recovered]]),
      );
      const after = inspect(p, doc)[0];
      assert.equal(after.fontName, before.fontName);
      assert.equal(after.size, before.size);
      assert.deepEqual(after.matrix, before.matrix);
      saved = serialized(p, doc);
    });
    await withDocument(saved!, (p, doc) => {
      const before = inspect(p, doc)[0];
      assert.equal(before.text, 'Menu menu MENU café');
      editText(p, doc, [edit(before.path, 'More LETTERS Éé')]);
      assert.equal(inspect(p, doc)[0].text, 'More LETTERS Éé');
    });
    await mkdir('tmp/qa', { recursive: true });
    await writeFile(
      `tmp/qa/noto-serif-variable-${original === 'MENU' ? 'upper' : 'lower'}.pdf`,
      saved!,
    );
  }
});
for (const text of ['abba', 'ABBA']) {
  test(`${text} subset permits existing letters and recovers new letters and case from a local font`, async () => {
    const bytes = await caseSubsetFixture(text);
    const recovered = await prepareLocalRecoveryFont(
      'ABCDEF+NotoSans-Bold',
      await readFile('public/fonts/NotoSans-Bold.ttf'),
    );
    for (const addition of ['z', 'Z', ' Zebra zebra']) {
      await withDocument(bytes, (p, doc) => {
        const before = inspect(p, doc)[0];
        editText(p, doc, [edit(before.path, text + text[0])]);
        assert.equal(inspect(p, doc)[0].text, text + text[0]);
      });
      await withDocument(bytes, (p, doc) => {
        assert.throws(
          () => editText(p, doc, [edit(inspect(p, doc)[0].path, text + addition)]),
          /different case may be missing/,
        );
      });
      let output: Uint8Array;
      await withDocument(bytes, (p, doc) => {
        const before = inspect(p, doc)[0];
        editText(
          p,
          doc,
          [edit(before.path, text + addition)],
          new Map([[recovered.name, recovered]]),
        );
        const after = inspect(p, doc)[0];
        assert.equal(after.fontName, before.fontName);
        assert.equal(after.size, before.size);
        assert.deepEqual(after.matrix, before.matrix);
        output = serialized(p, doc);
      });
      await withDocument(output!, (p, doc) => {
        assert.equal(inspect(p, doc)[0].text, text + addition);
        // Export is self-contained and remains editable without the local font store.
        editText(p, doc, [edit(inspect(p, doc)[0].path, 'Another WORD')]);
        assert.equal(inspect(p, doc)[0].text, 'Another WORD');
      });
    }
  });
}

test('local fonts reject wrong styles and invalid files and stay scoped to the open PDF', async () => {
  const bytes = await readFile('public/fonts/NotoSans-Bold.ttf');
  await assert.rejects(
    prepareLocalRecoveryFont('Georgia-Bold', bytes),
    /matching Georgia-Bold font/,
  );
  await assert.rejects(
    prepareLocalRecoveryFont('NotoSans-Regular', bytes),
    /matching NotoSans-Regular font/,
  );
  await assert.rejects(prepareLocalRecoveryFont('NotoSans-Bold', new Uint8Array(3)), /TTF or OTF/);
  await assert.rejects(
    prepareLocalRecoveryFont('NotoSans-Bold', new Uint8Array(20)),
    /static TTF or OTF/,
  );
  await assert.rejects(
    prepareLocalRecoveryFont('NotoSans-Bold', new Uint8Array(13 * 1024 * 1024)),
    /up to 12 MB/,
  );
  const source = { id: 'same-id', name: 'same.pdf', bytes: new Uint8Array(), size: 0, pages: [] };
  const otherSource = { ...source };
  const font = await prepareLocalRecoveryFont('NotoSans-Bold', bytes);
  setLocalFont(source, font);
  assert.deepEqual(localFonts(source), [font]);
  assert.deepEqual(localFonts(otherSource), []);
  removeLocalFont(source, 'ABCDEF+NotoSans-Bold');
  assert.deepEqual(localFonts(source), []);
});

test('hidden CR/LF mappings do not turn a selected English line into a multiline edit', async () => {
  const bytes = await hiddenBreaksFixture();
  let mark: ReturnType<typeof markFromText>;
  const source: SourceFile = {
    id: 'hidden-breaks',
    bytes,
    size: bytes.length,
    name: 'hidden-breaks.pdf',
    pages: [{ width: 600, height: 800, rotation: 0, transform: [1, 0, 0, -1, 0, 800] }],
  };
  let saved: Uint8Array | undefined;
  await withDocument(bytes, (p, doc) => {
    const page = p.FPDF_LoadPage(doc, 0),
      textPage = p.FPDFText_LoadPage(page);
    assert.ok(
      Array.from({ length: p.FPDFText_CountChars(textPage) }, (_, i) =>
        p.FPDFText_GetUnicode(textPage, i),
      ).includes(13),
      'fixture really contains mapped line breaks',
    );
    p.FPDFText_ClosePage(textPage);
    p.FPDF_ClosePage(page);
    const before = inspect(p, doc),
      lines = groupTextLines(before);
    assert.deepEqual(
      lines.map((line) => line.text),
      ['English line keeps spaces.', 'Next line.'],
    );
    const line = lines[0];
    mark = markFromText(source, 0, line);
    editText(p, doc, [edit(line.path, line.text)]);
    assert.deepEqual(inspect(p, doc), before);
    editText(p, doc, [edit(line.path, line.text, { delta: [10, -50] })]);
    saved = serialized(p, doc);
  });
  assert.strictEqual(
    await applyTextEdits(source, [mark!]),
    bytes,
    'selecting returns source bytes without starting a rewrite',
  );
  await withDocument(saved!, (p, doc) => {
    const moved = groupTextLines(inspect(p, doc)).find((line) => line.text.startsWith('English'))!;
    assert.deepEqual(moved.matrix, [1, 0, 0, 1, 70, 630]);
    assert.throws(
      () => editText(p, doc, [edit(moved.path, 'Edited line keeps spaces.')]),
      /does not contain all the characters/,
      'broken space encoding must not export missing-glyph squares',
    );
  });
});

test('genuinely new multiline text still requires a multiline-capable replacement', async () => {
  await withDocument(await fixture(StandardFonts.Helvetica), (p, doc) => {
    const before = inspect(p, doc);
    assert.throws(
      () => editText(p, doc, [edit(before[0].path, 'First\nSecond')]),
      /one line at a time/,
    );
    assert.deepEqual(inspect(p, doc), before);
  });
});
test('Sinhala stored at size 1 selects at its visible size and retains source glyphs when resized', async () => {
  const bytes = await sinhalaLinesFixture(true, true);
  let saved: Uint8Array | undefined;
  await withDocument(bytes, (p, doc) => {
    const before = inspect(p, doc),
      lines = groupTextLines(before);
    assert.deepEqual(
      lines.map((line) => line.text),
      [sinhalaLines[0], sinhalaColumn, sinhalaLines[1]],
    );
    const line = lines[0];
    assert.equal(line.size, 1, 'fixture stores Tf=1 and scales it with its text matrix');
    assert.equal(visibleTextSize(line), 20);
    const source: SourceFile = {
      id: 'unit-size',
      bytes,
      name: 'unit-size.pdf',
      size: bytes.length,
      pages: [{ width: 800, height: 800, rotation: 0, transform: [1, 0, 0, -1, 0, 800] }],
    };
    const mark = markFromText(source, 0, line);
    assert.equal(mark.fontSize, 20);
    editText(p, doc, [
      edit(line.path, line.text, { block: line, scale: mark.fontSize / visibleTextSize(line) }),
    ]);
    assert.deepEqual(inspect(p, doc), before, 'selection does not magnify or shrink the PDF');
    editText(p, doc, [edit(line.path, line.text, { block: line, scale: 1.5 })]);
    saved = serialized(p, doc);
  });
  await withDocument(saved!, (p, doc) => {
    const line = groupTextLines(inspect(p, doc)).find((line) => line.text === sinhalaLines[0])!;
    assert.equal(visibleTextSize(line), 30);
    assert.ok(textSources(line).length > 15);
  });
});
for (const fragmented of [true, false]) {
  test(`Sinhala ${fragmented ? 'word fragments' : 'whole-line spans'} select full lines and preserve/remove every glyph`, async () => {
    const bytes = await sinhalaLinesFixture(fragmented);
    const expected = [sinhalaLines[0], sinhalaColumn, sinhalaLines[1]];
    let saved: Uint8Array | undefined, moved: Uint8Array | undefined;
    await withDocument(bytes, (p, doc) => {
      const before = inspect(p, doc);
      const lines = groupTextLines(before);
      assert.deepEqual(
        lines.map((line) => line.text),
        expected,
      );
      const line = lines[0];
      assert.ok(line.bounds[2] - line.bounds[0] > 250, 'selection covers the full line');
      const sources = textSources(line);
      assert.ok(sources.length > 15, 'includes positioned glyphs suppressed by ActualText');
      assert.ok(sources.some((run) => run.text === ''));
      assert.equal(new Set(sources.map((run) => run.path.join('.'))).size, sources.length);
      editText(p, doc, [edit(line.path, line.text, { block: line })]);
      assert.deepEqual(inspect(p, doc), before, 'selecting a line changes no glyphs');
      saved = serialized(p, doc);
      editText(p, doc, [edit(line.path, line.text, { block: line, delta: [15, -100] })]);
      const allAfter = inspect(p, doc).flatMap(textSources);
      for (const source of before.flatMap(textSources)) {
        const after = allAfter.find((run) => run.path.join('.') === source.path.join('.'))!;
        assert.ok(after, 'every original glyph survives moving');
        const selected = sources.some((run) => run.path.join('.') === source.path.join('.'));
        assert.ok(Math.abs(after.matrix![4] - source.matrix![4] - (selected ? 15 : 0)) < 0.001);
        assert.ok(Math.abs(after.matrix![5] - source.matrix![5] - (selected ? -100 : 0)) < 0.001);
      }
      moved = serialized(p, doc);
    });
    await withDocument(saved!, (p, doc) => {
      const lines = groupTextLines(inspect(p, doc));
      assert.deepEqual(
        lines.map((line) => line.text),
        expected,
      );
      const sources = textSources(lines[0]);
      const page = p.FPDF_LoadPage(doc, 0),
        count = p.FPDFPage_CountObjects(page);
      p.FPDF_ClosePage(page);
      editText(p, doc, [edit(lines[0].path, '', { block: lines[0], remove: true })]);
      assert.deepEqual(
        groupTextLines(inspect(p, doc)).map((line) => line.text),
        expected.slice(1),
      );
      const afterPage = p.FPDF_LoadPage(doc, 0);
      assert.equal(
        p.FPDFPage_CountObjects(afterPage),
        count - sources.length,
        'no original glyph objects remain',
      );
      p.FPDF_ClosePage(afterPage);
    });
    await withDocument(moved!, (p, doc) => {
      assert.deepEqual(
        groupTextLines(inspect(p, doc)).map((line) => line.text),
        [sinhalaColumn, sinhalaLines[1], sinhalaLines[0]],
      );
    });
    await mkdir('tmp/qa', { recursive: true });
    await writeFile(`tmp/qa/sinhala-lines-${fragmented ? 'words' : 'span'}.pdf`, saved!);
    await writeFile(`tmp/qa/sinhala-lines-${fragmented ? 'words' : 'span'}-moved.pdf`, moved!);
  });
}
test('full Sinhala fonts still require shaping when words change, while unchanged text remains movable', async () => {
  const data = await createSinhalaFont(
    await readFile('public/fonts/sinhala/NotoSerifSinhala-Regular.ttf'),
  );
  const doc = await PDFDocument.create(),
    font = await embedSinhalaFont(doc, data);
  drawSinhalaLine(doc.addPage([600, 800]), font, data, 'ක', {
    x: 70,
    y: 620,
    size: 24,
    rotation: 0,
    color: rgb(0, 0, 0),
    opacity: 1,
  });
  const bytes = await doc.save();
  await withDocument(bytes, (p, doc) => {
    const original = inspect(p, doc)[0];
    assert.equal(original.text, 'ක');
    assert.throws(() => editText(p, doc, [edit(original.path, 'කක')]), /Sinhala letter shaping/);
  });
  await withDocument(bytes, (p, doc) => {
    const original = inspect(p, doc)[0];
    editText(p, doc, [{ ...edit(original.path, original.text), delta: [10, 0] }]);
    assert.equal(inspect(p, doc)[0].text, 'ක');
  });
});
for (const name of ['Aileron-Regular', 'Poppins-Regular'] as const) {
  test(`online ${name} candidate preserves glyphs and embeds missing characters`, async () => {
    const extension = name.startsWith('Aileron') ? 'otf' : 'ttf';
    const bytes = await readFile(`tests/fixtures/online-fonts/${name}.${extension}`);
    const recovered = await prepareRecoveryFont(
      name,
      bytes,
      name.split('-')[0],
      name.startsWith('Poppins'),
    );
    let output: Uint8Array | undefined;
    await withDocument(await onlineFontFixture(name), (p, doc) => {
      const original = inspect(p, doc)[0];
      assert.equal(original.fontEmbedded, true);
      editText(p, doc, [edit(original.path, 'ABBA Zebra café 2026')], new Map([[name, recovered]]));
      output = serialized(p, doc);
    });
    await withDocument(output!, (p, doc) => {
      const result = inspect(p, doc)[0];
      assert.equal(result.text, 'ABBA Zebra café 2026');
      assert.equal(result.fontName, name);
      assert.equal(result.fontEmbedded, true);
      assert.deepEqual(result.matrix, [1, 0, 0, 1, 70, 620]);
      assert.equal(p.FPDF_GetPageCount(doc), 1);
    });
    await mkdir('tmp/qa', { recursive: true });
    await writeFile(`tmp/qa/online-${name}.pdf`, output!);
  });
}
for (const variant of [
  'lmroman17-regular',
  'lmroman10-bolditalic',
  'lmsans10-regular',
  'lmmono10-regular',
]) {
  test(`complete ${variant} recovers missing subset characters and preserves saved typography`, async () => {
    const bytes = await readFile(`public/fonts/latin-modern/v2.005/${variant}.otf`);
    const name = fontkit.create(bytes).postscriptName;
    assert.ok(name);
    const recovery = await prepareRecoveryFont(name, bytes);
    const source = await latinModernFixture(variant, true);
    let output: Uint8Array | undefined;
    let baseline: number[];
    await withDocument(source, (p, doc) => {
      const before = inspect(p, doc)[0];
      assert.equal(before.fontEmbedded, true, 'fixture really embeds the subset font');
      baseline = textMatrix(p, doc, before.path[0]);
      assert.throws(
        () => editText(p, doc, [edit(before.path, 'ABBA Zebra café 2026')]),
        /does not contain all the characters/,
      );
    });
    await withDocument(source, (p, doc) => {
      const before = inspect(p, doc)[0];
      editText(p, doc, [edit(before.path, 'ABBA Zebra café 2026')], new Map([[name, recovery]]));
      assert.equal(p.FPDF_GetPageCount(doc), 1, 'temporary font donor pages are removed');
      const after = inspect(p, doc)[0];
      assert.equal(after.text, 'ABBA Zebra café 2026');
      assert.equal(after.fontName, name);
      assert.equal(after.color, before.color);
      assert.equal(after.size, before.size);
      assert.equal(after.fontEmbedded, true);
      output = serialized(p, doc);
    });
    await withDocument(output!, (p, doc) => {
      const after = inspect(p, doc)[0];
      assert.equal(after.text, 'ABBA Zebra café 2026');
      assert.equal(after.fontName, name);
      assert.equal(p.FPDF_GetPageCount(doc), 1);
      for (const [i, value] of textMatrix(p, doc, after.path[0]).entries())
        assert.ok(
          Math.abs(value - baseline[i]) < 0.00001,
          'original transform and baseline survive saving',
        );
    });
    await mkdir('tmp/qa', { recursive: true });
    await writeFile(`tmp/qa/recovered-${variant}.pdf`, output!);
  });
}

test('font recovery rejects different character shapes and unsupported characters', async () => {
  const bytes = await readFile('public/fonts/latin-modern/v2.005/lmroman17-regular.otf');
  const name = 'LMRoman17-Regular';
  const recovered = await prepareRecoveryFont(name, bytes);
  const wrong = await prepareRecoveryFont(
    'LMRoman12-Regular',
    await readFile('public/fonts/latin-modern/v2.005/lmroman12-regular.otf'),
  );
  const source = await latinModernFixture();
  await withDocument(source, (p, doc) => {
    assert.throws(
      () => editText(p, doc, [edit(inspect(p, doc)[0].path, 'Zebra')], new Map([[name, wrong]])),
      /could not be verified/,
    );
    assert.equal(p.FPDF_GetPageCount(doc), 1);
  });
  await withDocument(source, (p, doc) => {
    assert.throws(
      () => editText(p, doc, [edit(inspect(p, doc)[0].path, '中文')], new Map([[name, recovered]])),
      /does not contain all the characters/,
    );
    assert.equal(p.FPDF_GetPageCount(doc), 1);
  });
});

test('font recovery keeps object order, multiple pages and explicit formatting changes', async () => {
  const document = await PDFDocument.create();
  const names = ['LMRoman17-Regular', 'LMRoman10-BoldItalic'];
  const variants = ['lmroman17-regular', 'lmroman10-bolditalic'];
  const recoveries = new Map();
  for (const [i, variant] of variants.entries()) {
    const source = await PDFDocument.load(await latinModernFixture(variant));
    const [page] = await document.copyPages(source, [0]);
    document.addPage(page);
    // This later paint operation must stay above the recovered text.
    page.drawRectangle({ x: 70, y: 619, width: 12, height: 28, color: rgb(1, 1, 1) });
    recoveries.set(
      names[i],
      await prepareRecoveryFont(
        names[i],
        await readFile(`public/fonts/latin-modern/v2.005/${variant}.otf`),
      ),
    );
  }
  let output: Uint8Array | undefined;
  await withDocument(await document.save(), (p, doc) => {
    const page = p.FPDF_LoadPage(doc, 0);
    const extra = p.FPDFPageObj_NewTextObj(doc, 'Helvetica', 12);
    const label = p.pdfium.wasmExports.malloc(4);
    p.pdfium.setValue(label, 88, 'i16');
    p.pdfium.setValue(label + 2, 0, 'i16');
    assert.ok(p.FPDFText_SetText(extra, label));
    p.pdfium.wasmExports.free(label);
    // Inserting then removing an earlier object exercises shifted indices.
    assert.ok(p.FPDFPage_InsertObjectAtIndex(page, extra, 0));
    assert.ok(p.FPDFPage_GenerateContent(page));
    p.FPDF_ClosePage(page);
    editText(
      p,
      doc,
      [
        edit([0], '', { remove: true }),
        edit([1], 'Zebra 2026', { delta: [20, -30], scale: 1.5, color: '#336699', opacity: 0.75 }),
        edit([0], 'Better text', { page: 1 }),
      ],
      recoveries,
    );
    assert.equal(p.FPDF_GetPageCount(doc), 2);
    output = serialized(p, doc);
  });
  await withDocument(output!, (p, doc) => {
    for (let index = 0; index < 2; index++) {
      const page = p.FPDF_LoadPage(doc, index);
      try {
        assert.equal(p.FPDFPage_CountObjects(page), 2);
        assert.equal(p.FPDFPageObj_GetType(p.FPDFPage_GetObject(page, 0)), 1);
        assert.equal(p.FPDFPageObj_GetType(p.FPDFPage_GetObject(page, 1)), 2);
        const [text] = readText(p, page);
        assert.equal(text.fontName, names[index]);
        assert.equal(text.text, index ? 'Better text' : 'Zebra 2026');
        if (!index) {
          assert.equal(text.color, '#336699');
          assert.ok(Math.abs(text.opacity - 0.75) < 0.01);
          assert.deepEqual(text.matrix, [1.5, 0, 0, 1.5, 90, 590]);
        }
      } finally {
        p.FPDF_ClosePage(page);
      }
    }
  });
});
test('moving text layers isolate the exact glyphs and preserve colored backgrounds and page objects', async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRomanBoldItalic);
  const sheet = document.addPage([600, 800]);
  sheet.drawRectangle({ x: 40, y: 645, width: 330, height: 75, color: rgb(0.8, 0.9, 1) });
  sheet.drawText('Move this line.', { x: 60, y: 680, size: 24, font });
  sheet.drawText('Keep this line.', { x: 60, y: 620, size: 24, font });
  const bytes = await document.save();
  await withDocument(bytes, (p, doc) => {
    const page = p.FPDF_LoadPage(doc, 0);
    try {
      const before = readText(p, page);
      const source: SourceFile = {
        id: 'move',
        name: 'move.pdf',
        bytes,
        size: bytes.length,
        pages: [{ width: 600, height: 800, rotation: 0, transform: [1, 0, 0, -1, 0, 800] }],
      };
      const layers = renderTextLayers(
        p,
        page,
        markFromText(source, 0, before[0]),
        source.pages[0],
        1,
      );
      assert.equal(layers.width, 600);
      assert.equal(layers.height, 800);
      let ink = 0;
      for (let y = 90; y < 125; y++)
        for (let x = 50; x < 225; x++) {
          const at = (y * 600 + x) * 4;
          if (layers.foreground[at + 3]) ink++;
          assert.ok(
            layers.background[at] >= 200,
            'original line is removed from the colored background',
          );
          assert.equal(layers.background[at + 2], 255);
        }
      assert.ok(ink > 200, 'transparent foreground contains the selected glyphs');
      for (let y = 160; y < 185; y++)
        for (let x = 50; x < 225; x++)
          assert.equal(
            layers.foreground[(y * 600 + x) * 4 + 3],
            0,
            'neighboring text stays in the background',
          );
      assert.deepEqual(readText(p, page), before, 'previewing never changes source text objects');
      const again = renderTextLayers(
        p,
        page,
        markFromText(source, 0, before[0]),
        source.pages[0],
        1,
      );
      assert.deepEqual(
        again,
        layers,
        'all original object visibility is restored after previewing',
      );
    } finally {
      p.FPDF_ClosePage(page);
    }
  });
});
test('positioned word gaps survive extraction, cursor layout, no-op editing and saved edits', async () => {
  const bytes = await spacedTextFixture();
  let output: Uint8Array | undefined;
  await withDocument(bytes, (p, doc) => {
    const page = p.FPDF_LoadPage(doc, 0);
    let items;
    try {
      items = readText(p, page, true);
    } finally {
      p.FPDF_ClosePage(page);
    }
    const lines = groupTextLines(items);
    assert.deepEqual(
      lines.map((line) => line.text),
      ['Related line keeps spaces.', 'A separate column.', 'Next  line stays separate.'],
    );
    const line = lines[0];
    const source: SourceFile = {
      id: 'spacing',
      name: 'spacing.pdf',
      bytes,
      size: bytes.length,
      pages: [{ width: 600, height: 800, rotation: 0, transform: [1, 0, 0, -1, 0, 800] }],
    };
    const layout = inlineLayout(items, markFromText(source, 0, line), source.pages[0]);
    assert.equal(layout.exact, true);
    assert.equal(layout.stops.length, line.text.length + 1);
    for (const index of [7, 12, 18]) {
      assert.equal(line.text[index], ' ');
      assert.ok(Math.abs(layout.stops[index + 1].x - layout.stops[index].x - 4.5) < 0.01);
    }
    editText(p, doc, [edit(line.path, line.text, { block: line })]);
    assert.deepEqual(
      inspect(p, doc),
      items.map(({ glyphs: _, ...item }) => item),
      'selecting a line leaves its original kerning and word positioning intact',
    );
    editText(p, doc, [edit(line.path, 'Related line keeps  edited spaces.', { block: line })]);
    output = serialized(p, doc);
  });
  await withDocument(output!, (p, doc) => {
    const lines = groupTextLines(inspect(p, doc));
    assert.deepEqual(
      lines.map((line) => line.text),
      ['Related line keeps  edited spaces.', 'A separate column.', 'Next  line stays separate.'],
    );
    assert.equal(lines[0].fontName, 'Times-Roman');
  });
});
test('inline editing uses actual PDF character origins for cursor and rotated selection geometry', async () => {
  const bytes = await fixture(StandardFonts.TimesRomanBoldItalic, 'Wide Wi text');
  await withDocument(bytes, (p, doc) => {
    const page = p.FPDF_LoadPage(doc, 0);
    try {
      const [item] = readText(p, page, true);
      assert.equal(item.glyphs?.length, item.text.length);
      assert.ok(Math.abs(item.glyphs![0].origin[0] - 70) < 0.01);
      assert.ok(Math.abs(item.glyphs![0].origin[1] - 620) < 0.01);
      const source: SourceFile = {
        id: 'test',
        bytes,
        name: 'test.pdf',
        size: bytes.length,
        pages: [{ width: 600, height: 800, rotation: 0, transform: [1, 0, 0, -1, 0, 800] }],
      };
      const layout = inlineLayout([item], markFromText(source, 0, item), source.pages[0]);
      assert.equal(layout.exact, true);
      assert.equal(layout.stops.length, item.text.length + 1);
      assert.ok(Math.abs(layout.stops[0].x - 70) < 0.01);
      assert.ok(Math.abs(layout.stops[0].y - 180) < 0.01);
      assert.ok(Math.abs(layout.stops[0].nx) > 0.1, 'cursor rotates with the PDF baseline');
      assert.ok(
        layout.stops[1].x - layout.stops[0].x > layout.stops[2].x - layout.stops[1].x,
        'wide W and narrow i retain their actual advances',
      );
    } finally {
      p.FPDF_ClosePage(page);
    }
  });
});
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

async function fragmentedFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([600, 800]);
  const letters: { text: string; x: number; y: number }[] = [];
  for (const [text, y] of [
    ['The first editable line.', 680],
    ['The second stays separate.', 650],
  ] as const) {
    let x = 60;
    for (const char of text) {
      if (char !== ' ') letters.push({ text: char, x, y });
      x += font.widthOfTextAtSize(char, 18);
    }
  }
  // Deliberately write the PDF in reverse order: visual selection must not
  // depend on the order an authoring program writes its drawing commands.
  for (const item of letters.reverse()) page.drawText(item.text, { ...item, size: 18, font });
  page.drawText('A separate column.', { x: 390, y: 680, size: 18, font });
  return doc.save();
}

test('fragmented PDF letters select as lines and edited export removes all old fragments', async () => {
  let output: Uint8Array | undefined;
  await withDocument(await fragmentedFixture(), (p, doc) => {
    const lines = groupTextLines(inspect(p, doc));
    assert.deepEqual(
      lines.map((line) => line.text),
      ['The first editable line.', 'A separate column.', 'The second stays separate.'],
    );
    const line = lines[0];
    assert.ok(line.runs!.length > 10);
    editText(p, doc, [edit(line.path, 'The first line is fixed.', { block: line })]);
    const after = groupTextLines(inspect(p, doc));
    assert.deepEqual(
      after.map((line) => line.text),
      ['The first line is fixed.', 'A separate column.', 'The second stays separate.'],
    );
    assert.equal(after[0].fontName, line.fontName);
    assert.equal(after[0].size, line.size);
    assert.deepEqual(after[0].matrix, line.matrix);
    assert.equal(textSources(after[0]).length, 1);
    output = serialized(p, doc);
  });
  await withDocument(output!, (p, doc) => {
    assert.deepEqual(
      groupTextLines(inspect(p, doc)).map((line) => line.text),
      ['The first line is fixed.', 'A separate column.', 'The second stays separate.'],
    );
  });
});

test('selecting an unchanged fragmented line preserves every letter and position', async () => {
  await withDocument(await fragmentedFixture(), (p, doc) => {
    const before = inspect(p, doc);
    const line = groupTextLines(before)[0];
    editText(p, doc, [edit(line.path, line.text, { block: line })]);
    const after = inspect(p, doc);
    assert.equal(after.length, before.length);
    for (const [index, item] of before.entries()) {
      assert.equal(after[index].text, item.text);
      assert.deepEqual(after[index].matrix, item.matrix);
      assert.deepEqual(after[index].bounds, item.bounds);
    }
  });
});

test('moving a fragmented line keeps every original font and inter-letter position', async () => {
  await withDocument(await fragmentedFixture(), (p, doc) => {
    const before = inspect(p, doc);
    const line = groupTextLines(before)[0];
    editText(p, doc, [edit(line.path, line.text, { block: line, delta: [35, -90] })]);
    const moved = new Set(textSources(line).map((item) => item.path.join('.')));
    for (const after of inspect(p, doc)) {
      const original = before.find((item) => item.path.join('.') === after.path.join('.'))!;
      assert.equal(after.text, original.text);
      assert.equal(after.fontName, original.fontName);
      const delta = moved.has(after.path.join('.')) ? [35, -90] : [0, 0];
      assert.ok(Math.abs(after.matrix![4] - original.matrix![4] - delta[0]) < 0.001);
      assert.ok(Math.abs(after.matrix![5] - original.matrix![5] - delta[1]) < 0.001);
    }
  });
});

test('explicit font replacement removes the entire selected line but keeps nearby lines', async () => {
  let output: Uint8Array | undefined;
  await withDocument(await fragmentedFixture(), (p, doc) => {
    const line = groupTextLines(inspect(p, doc))[0];
    editText(p, doc, [edit(line.path, 'Replacement overlay', { block: line, remove: true })]);
    output = serialized(p, doc);
  });
  await withDocument(output!, (p, doc) => {
    assert.deepEqual(
      groupTextLines(inspect(p, doc)).map((line) => line.text),
      ['A separate column.', 'The second stays separate.'],
    );
  });
});

test('text-heavy pages fail before returning partial line selections', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  for (let row = 0; row < 101; row++)
    page.drawText('x'.repeat(1000), { x: 20, y: 780 - row * 7, size: 1, font });
  await withDocument(await doc.save(), (p, document) => {
    assert.throws(() => inspect(p, document), /too much text to edit safely/);
  });
});
