import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFName,
  PDFString,
  rgb,
  degrees,
  BlendMode,
  StandardFonts,
  type PDFFont,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { zip } from 'fflate';
import { native } from './native';
import { applyTextEdits, usesOriginalFont } from './textEdits';
import { drawHighlight } from './highlightExport';
import { addFormFields, removeChangedLinks, safeLink, unchangedLink } from './editorObjects';
import { openPdf, renderPage, canvasBytes } from './pdf';
import { inversePoint, outputName, parseRange } from './utils';
import type {
  SourceFile,
  PageRef,
  Mark,
  EditState,
  Output,
  ProcessOptions,
  ToolId,
  FormField,
} from './types';

const pdfMime = 'application/pdf';
const fontData = new Map<string, Promise<ArrayBuffer>>();
async function fontFor(doc: PDFDocument, mark?: Mark): Promise<PDFFont> {
  if (mark?.fontFamily === 'serif')
    return doc.embedFont(
      mark.bold
        ? mark.italic
          ? StandardFonts.TimesRomanBoldItalic
          : StandardFonts.TimesRomanBold
        : mark.italic
          ? StandardFonts.TimesRomanItalic
          : StandardFonts.TimesRoman,
    );
  if (mark?.fontFamily === 'mono')
    return doc.embedFont(
      mark.bold
        ? mark.italic
          ? StandardFonts.CourierBoldOblique
          : StandardFonts.CourierBold
        : mark.italic
          ? StandardFonts.CourierOblique
          : StandardFonts.Courier,
    );
  doc.registerFontkit(fontkit);
  const variant = mark?.bold
    ? mark.italic
      ? 'BoldItalic'
      : 'Bold'
    : mark?.italic
      ? 'Italic'
      : 'Regular';
  if (!fontData.has(variant))
    fontData.set(
      variant,
      fetch(`/fonts/NotoSans-${variant}.ttf`)
        .then((r) => {
          if (!r.ok) throw new Error('The editing font could not be loaded.');
          return r.arrayBuffer();
        })
        .catch((error) => {
          fontData.delete(variant);
          throw error;
        }),
    );
  return doc.embedFont(await fontData.get(variant)!, { subset: true });
}
function color(value: string) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#171719';
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
}
export async function readFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes),
    form = doc.getForm();
  return form.getFields().flatMap((field) => {
    const common = {
      name: field.getName(),
      readOnly: field.isReadOnly(),
      widgets: field.acroField.getWidgets().flatMap((widget, index) => {
        const page = doc.getPages().findIndex((page) =>
          page.node
            .Annots()
            ?.asArray()
            .some((ref) => doc.context.lookup(ref) === widget.dict),
        );
        const { x, y, width, height } = widget.getRectangle();
        return page < 0
          ? []
          : [
              {
                page,
                bounds: [x, y, x + width, y + height] as [number, number, number, number],
                ...(field instanceof PDFRadioGroup ? { option: field.getOptions()[index] } : {}),
              },
            ];
      }),
    };
    if (field instanceof PDFTextField)
      return [
        {
          ...common,
          type: 'text',
          value: field.getText() || '',
          multiline: field.isMultiline(),
        } as FormField,
      ];
    if (field instanceof PDFCheckBox)
      return [{ ...common, type: 'checkbox', value: field.isChecked() } as FormField];
    if (field instanceof PDFDropdown || field instanceof PDFOptionList)
      return [
        {
          ...common,
          type: 'select',
          value: field.getSelected(),
          options: field.getOptions(),
        } as FormField,
      ];
    if (field instanceof PDFRadioGroup)
      return [
        {
          ...common,
          type: 'radio',
          value: field.getSelected() || '',
          options: field.getOptions(),
        } as FormField,
      ];
    return [];
  });
}
async function writeFields(doc: PDFDocument, values: EditState['fields'], flatten = false) {
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field || field.isReadOnly()) continue;
    if (field instanceof PDFTextField) field.setText(String(value));
    else if (field instanceof PDFCheckBox) value ? field.check() : field.uncheck();
    else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      if (Array.isArray(value) ? value.length : value) field.select(value as string | string[]);
      else field.clear();
    } else if (field instanceof PDFRadioGroup) value ? field.select(String(value)) : field.clear();
  }
  if (form.getFields().length) {
    form.updateFieldAppearances(await fontFor(doc));
    if (flatten) {
      form.flatten();
      // pdf-lib can leave references to the widget objects it deleted while
      // flattening. Remove only dangling annotation references before copying
      // or saving pages; valid links and other annotations are retained.
      for (const page of doc.getPages()) {
        const annotations = page.node.Annots();
        if (!annotations) continue;
        for (let i = annotations.size() - 1; i >= 0; i--)
          if (!doc.context.lookup(annotations.get(i))) annotations.remove(i);
      }
    }
  }
}
export async function previewFields(bytes: Uint8Array, values: EditState['fields']) {
  if (!Object.keys(values).length) return bytes;
  const doc = await PDFDocument.load(bytes);
  await writeFields(doc, values);
  return doc.save();
}
async function addMarks(doc: PDFDocument, source: SourceFile, marks: Mark[]) {
  const fonts = new Map<string, PDFFont>();
  for (const mark of marks) {
    if (mark.deleted || mark.kind === 'form' || (mark.kind === 'link' && unchangedLink(mark)))
      continue;
    const page = doc.getPage(mark.page),
      info = source.pages[mark.page];
    const point = (x: number, y: number) => inversePoint(info.transform, x, y);
    const [x, y] = point(mark.x, mark.y + mark.height),
      rotation = degrees(info.rotation);
    if (mark.kind === 'text') {
      if (usesOriginalFont(mark)) continue;
      const key = `${mark.fontFamily || 'noto'}-${!!mark.bold}-${!!mark.italic}`;
      if (!fonts.has(key)) fonts.set(key, await fontFor(doc, mark));
      const font = fonts.get(key)!;
      for (const [i, line] of (mark.text || '').split('\n').entries()) {
        const [tx, ty] = point(mark.x, mark.y + mark.fontSize * 0.9 + i * mark.fontSize * 1.2);
        page.drawText(line, {
          x: tx,
          y: ty,
          font,
          size: mark.fontSize,
          color: color(mark.color),
          rotate: rotation,
          opacity: mark.opacity,
        });
        for (const offset of [mark.underline ? 1.03 : null, mark.strike ? 0.56 : null]) {
          if (offset === null) continue;
          const start = point(mark.x, mark.y + mark.fontSize * (offset + i * 1.2));
          const end = point(
            mark.x + font.widthOfTextAtSize(line, mark.fontSize),
            mark.y + mark.fontSize * (offset + i * 1.2),
          );
          page.drawLine({
            start: { x: start[0], y: start[1] },
            end: { x: end[0], y: end[1] },
            thickness: Math.max(0.6, mark.fontSize / 18),
            color: color(mark.color),
            opacity: mark.opacity,
          });
        }
      }
    } else if (mark.kind === 'highlight') {
      drawHighlight(page, mark, info);
    } else if (mark.kind === 'image' && mark.dataUrl) {
      const image = mark.dataUrl.startsWith('data:image/jpeg')
        ? await doc.embedJpg(mark.dataUrl)
        : await doc.embedPng(mark.dataUrl);
      page.drawImage(image, {
        x,
        y,
        width: mark.width,
        height: mark.height,
        rotate: rotation,
        opacity: mark.opacity,
      });
    } else if (mark.kind === 'pen' || mark.kind === 'line') {
      const points = mark.points?.length
        ? mark.points
        : [
            [0, 0],
            [mark.width, mark.height],
          ];
      for (let i = 1; i < points.length; i++) {
        const start = point(mark.x + points[i - 1][0], mark.y + points[i - 1][1]),
          end = point(mark.x + points[i][0], mark.y + points[i][1]);
        page.drawLine({
          start: { x: start[0], y: start[1] },
          end: { x: end[0], y: end[1] },
          thickness: mark.strokeWidth,
          color: color(mark.color),
          opacity: mark.opacity,
        });
      }
    } else if (mark.kind === 'ellipse') {
      const [cx, cy] = point(mark.x + mark.width / 2, mark.y + mark.height / 2);
      page.drawEllipse({
        x: cx,
        y: cy,
        xScale: mark.width / 2,
        yScale: mark.height / 2,
        rotate: rotation,
        borderWidth: mark.strokeWidth,
        borderColor: color(mark.color),
        color: mark.fillColor ? color(mark.fillColor) : undefined,
        opacity: mark.opacity,
      });
    } else if (mark.kind === 'link') {
      if (!mark.url && !mark.destinationPage) continue;
      if (
        mark.destinationPage &&
        (!Number.isInteger(mark.destinationPage) ||
          mark.destinationPage < 1 ||
          mark.destinationPage > doc.getPageCount())
      )
        throw new Error('Choose a destination page in this document.');
      const a = point(mark.x, mark.y),
        b = point(mark.x + mark.width, mark.y + mark.height);
      const annotation = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[0], b[0]),
          Math.max(a[1], b[1]),
        ],
        Border: [0, 0, 0],
        ...(mark.destinationPage
          ? { Dest: [doc.getPage(mark.destinationPage - 1).ref, PDFName.of('Fit')] }
          : { A: { Type: 'Action', S: 'URI', URI: PDFString.of(safeLink(mark.url!)) } }),
      });
      page.node.addAnnot(doc.context.register(annotation));
    } else {
      const fill = mark.kind === 'cover' || mark.kind === 'redact';
      page.drawRectangle({
        x,
        y,
        width: mark.width,
        height: mark.height,
        rotate: rotation,
        color: fill
          ? color(
              mark.kind === 'cover' ? '#ffffff' : mark.kind === 'redact' ? '#000000' : mark.color,
            )
          : mark.fillColor
            ? color(mark.fillColor)
            : undefined,
        borderWidth: fill ? 0 : mark.strokeWidth,
        borderColor: fill ? undefined : color(mark.color),
        opacity: mark.kind === 'cover' || mark.kind === 'redact' ? 1 : mark.opacity,
        blendMode: BlendMode.Normal,
      });
    }
  }
}
export async function previewEditor(source: SourceFile, edit: EditState) {
  const bytes = await applyTextEdits(source, edit.marks);
  if (
    !edit.marks.some((m) => (m.kind === 'text' && !usesOriginalFont(m)) || m.kind === 'form') &&
    !Object.keys(edit.fields).length
  )
    return bytes;
  const doc = await PDFDocument.load(bytes);
  addFormFields(
    doc,
    source,
    edit.marks,
    edit.marks.some((m) => m.kind === 'form') ? await fontFor(doc) : undefined,
  );
  await writeFields(doc, edit.fields);
  await addMarks(
    doc,
    source,
    edit.marks.filter((m) => m.kind === 'text'),
  );
  return doc.save();
}
export async function editPdf(
  source: SourceFile,
  edit: EditState,
  flatten: boolean,
  progress: (v: number) => void,
  signal?: AbortSignal,
): Promise<Output> {
  let bytes = await applyTextEdits(source, edit.marks);
  const overlayMarks = edit.marks.filter((mark) => !usesOriginalFont(mark));
  const doc = await PDFDocument.load(bytes);
  removeChangedLinks(doc, edit.marks);
  addFormFields(
    doc,
    source,
    edit.marks,
    edit.marks.some((m) => m.kind === 'form') ? await fontFor(doc) : undefined,
  );
  await writeFields(doc, edit.fields, flatten || edit.marks.some((m) => m.kind === 'redact'));
  if (edit.marks.some((m) => m.kind === 'redact')) {
    // Render all content first, then apply redactions last so later additions cannot expose it.
    await addMarks(
      doc,
      source,
      overlayMarks.filter((m) => m.kind !== 'redact'),
    );
    await addMarks(
      doc,
      source,
      overlayMarks.filter((m) => m.kind === 'redact'),
    );
    bytes = await doc.save();
    const result = await rasterPdf({ ...source, bytes }, [], false, 150, 0.92, progress, signal);
    return {
      name: outputName(source.name, 'redacted'),
      bytes: result,
      mime: pdfMime,
      note: 'Redactions are burned into the page images. Original text, forms, links and metadata are not included.',
    };
  }
  await addMarks(doc, source, overlayMarks);
  return { name: outputName(source.name, 'edited'), bytes: await doc.save(), mime: pdfMime };
}
async function drawOnCanvas(
  canvas: HTMLCanvasElement,
  marks: Mark[],
  width: number,
  height: number,
) {
  await document.fonts.load('16px "Noto PDF"');
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.scale(canvas.width / width, canvas.height / height);
  for (const m of marks) {
    ctx.save();
    ctx.globalAlpha = m.opacity;
    ctx.fillStyle = m.color;
    ctx.strokeStyle = m.color;
    ctx.lineWidth = m.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (m.kind === 'text') {
      ctx.font = `${m.fontSize}px "Noto PDF"`;
      (m.text || '')
        .split('\n')
        .forEach((line, i) =>
          ctx.fillText(line, m.x, m.y + m.fontSize * 0.9 + i * m.fontSize * 1.2),
        );
    } else if (m.kind === 'image' && m.dataUrl) {
      const image = new Image();
      image.src = m.dataUrl;
      await image.decode();
      ctx.drawImage(image, m.x, m.y, m.width, m.height);
    } else if (m.kind === 'rectangle') ctx.strokeRect(m.x, m.y, m.width, m.height);
    else if (m.kind === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        m.x + m.width / 2,
        m.y + m.height / 2,
        m.width / 2,
        m.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    } else if (m.kind === 'pen' || m.kind === 'line') {
      const points = m.points?.length
        ? m.points
        : [
            [0, 0],
            [m.width, m.height],
          ];
      ctx.beginPath();
      points.forEach((pt, i) =>
        i ? ctx.lineTo(m.x + pt[0], m.y + pt[1]) : ctx.moveTo(m.x + pt[0], m.y + pt[1]),
      );
      ctx.stroke();
    } else if (m.kind !== 'link') {
      if (m.kind === 'redact' || m.kind === 'cover') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = m.kind === 'redact' ? '#000000' : '#ffffff';
      }
      if (m.kind === 'highlight') ctx.globalCompositeOperation = 'multiply';
      ctx.fillRect(m.x, m.y, m.width, m.height);
    }
    ctx.restore();
  }
  ctx.restore();
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Processing canceled.');
}
export async function rasterPdf(
  source: SourceFile,
  marks: Mark[],
  gray: boolean,
  dpi: number,
  quality: number,
  progress: (n: number) => void,
  signal?: AbortSignal,
) {
  const input = await openPdf(source.bytes),
    output = await PDFDocument.create();
  try {
    for (let i = 0; i < input.numPages; i++) {
      aborted(signal);
      const canvas = await renderPage(input, i, dpi / 72);
      if (gray) {
        const ctx = canvas.getContext('2d')!,
          pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let j = 0; j < pixels.data.length; j += 4) {
          const value = Math.round(
            pixels.data[j] * 0.2126 + pixels.data[j + 1] * 0.7152 + pixels.data[j + 2] * 0.0722,
          );
          pixels.data[j] = pixels.data[j + 1] = pixels.data[j + 2] = value;
        }
        ctx.putImageData(pixels, 0, 0);
      }
      await drawOnCanvas(
        canvas,
        marks.filter((m) => m.page === i),
        source.pages[i].width,
        source.pages[i].height,
      );
      const image = await output.embedJpg(await canvasBytes(canvas, 'jpg', quality)),
        info = source.pages[i];
      output
        .addPage([info.width, info.height])
        .drawImage(image, { x: 0, y: 0, width: info.width, height: info.height });
      canvas.width = canvas.height = 1;
      progress((i + 1) / input.numPages);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return output.save();
  } finally {
    await input.loadingTask.destroy();
  }
}
async function zipFiles(files: Record<string, Uint8Array>) {
  return new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 1 }, (error, result) => (error ? reject(error) : resolve(result))),
  );
}
export async function reorderPdf(files: SourceFile[], refs: PageRef[]): Promise<Uint8Array> {
  if (!refs.length) throw new Error('Keep at least one page in the document.');
  const output = await PDFDocument.create(),
    loaded = new Map<string, PDFDocument>();
  for (const source of files) {
    const doc = await PDFDocument.load(source.bytes);
    if (doc.getForm().getFields().length) await writeFields(doc, {}, true);
    loaded.set(source.id, doc);
  }
  for (const ref of refs) {
    const source = loaded.get(ref.fileId);
    if (!source) throw new Error('A source document is missing.');
    const [page] = await output.copyPages(source, [ref.index]);
    page.setRotation(degrees((page.getRotation().angle + ref.rotation + 360) % 360));
    output.addPage(page);
  }
  return output.save();
}
export async function imagesToPdf(
  images: File[],
  options: ProcessOptions,
  progress: (n: number) => void,
  signal?: AbortSignal,
): Promise<Output> {
  const output = await PDFDocument.create();
  for (const [index, file] of images.entries()) {
    aborted(signal);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type))
      throw new Error(`${file.name}: choose a JPG, PNG or WebP image.`);
    if (file.size > 40 * 1024 * 1024)
      throw new Error(`${file.name} is too large. Choose an image smaller than 40 MB.`);
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 40_000_000) {
      bitmap.close();
      throw new Error(`${file.name} is larger than 40 megapixels. Resize it before adding it.`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = await output.embedPng(await canvasBytes(canvas, 'png'));
    let [w, h] =
      options.imageSize === 'fit'
        ? [image.width * 0.75 + options.margins * 2, image.height * 0.75 + options.margins * 2]
        : options.imageSize === 'letter'
          ? [612, 792]
          : [595.28, 841.89];
    if (options.imageSize !== 'fit' && options.orientation === 'landscape') [w, h] = [h, w];
    const factor = Math.min(
        (w - options.margins * 2) / image.width,
        (h - options.margins * 2) / image.height,
      ),
      width = image.width * factor,
      height = image.height * factor;
    output
      .addPage([w, h])
      .drawImage(image, { x: (w - width) / 2, y: (h - height) / 2, width, height });
    canvas.width = canvas.height = 1;
    progress((index + 1) / images.length);
  }
  return { name: 'rovty-images.pdf', bytes: await output.save(), mime: pdfMime };
}
export async function processPdf(
  tool: ToolId,
  files: SourceFile[],
  refs: PageRef[],
  options: ProcessOptions,
  progress: (n: number) => void,
  signal?: AbortSignal,
): Promise<Output> {
  const source = files[0];
  if (!source) throw new Error('Choose a PDF first.');
  if (!Number.isInteger(options.every) || options.every < 1 || options.every > 1000)
    throw new Error('Pages per PDF must be between 1 and 1,000.');
  if (!Number.isFinite(options.dpi) || options.dpi < 36 || options.dpi > 300)
    throw new Error('Choose a resolution between 36 and 300 DPI.');
  if (!Number.isFinite(options.quality) || options.quality < 0.1 || options.quality > 1)
    throw new Error('Choose a valid image quality.');
  if (!Number.isFinite(options.margins) || options.margins < 0 || options.margins > 200)
    throw new Error('Choose a margin between 0 and 200 points.');
  const name = (suffix: string, extension = 'pdf') => outputName(source.name, suffix, extension);
  const output = (bytes: Uint8Array, suffix = tool, note?: string): Output => ({
    name: name(suffix),
    bytes,
    mime: pdfMime,
    note,
  });
  if (['merge', 'organize', 'rotate'].includes(tool))
    return output(
      await reorderPdf(files, refs),
      tool,
      'Any interactive form fields are flattened to preserve their visible values.',
    );
  if (tool === 'protect')
    return output(
      await native('protect', source.bytes, {
        newPassword: options.password,
        ownerPassword: options.ownerPassword,
      }),
    );
  if (tool === 'unlock' || tool === 'repair') return output(await native(tool, source.bytes));
  if (tool === 'compress' || tool === 'grayscale') {
    const bytes = await rasterPdf(
      source,
      [],
      tool === 'grayscale',
      options.dpi,
      options.quality,
      progress,
      signal,
    );
    if (tool === 'compress' && bytes.length >= source.bytes.length)
      return output(
        source.bytes,
        tool,
        'This file was already compact. The original PDF is provided because raster compression did not reduce its size.',
      );
    return output(
      bytes,
      tool,
      'Pages are saved as images. Selectable text, interactive fields and links are flattened.',
    );
  }
  if (tool === 'pdf-to-images' || tool === 'text') {
    const selected = parseRange(options.range, source.pages.length),
      doc = await openPdf(source.bytes);
    try {
      if (tool === 'text') {
        const pages: string[] = [];
        for (const [n, index] of selected.entries()) {
          aborted(signal);
          const page = await doc.getPage(index + 1),
            content = await page.getTextContent();
          pages.push(
            content.items
              .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
              .join('')
              .trim(),
          );
          progress((n + 1) / selected.length);
        }
        if (!pages.some((text) => text.trim()))
          throw new Error(
            'No selectable text was found. This may be a scanned PDF; OCR is not included in this browser tool.',
          );
        return {
          name: name('text', 'txt'),
          mime: 'text/plain;charset=utf-8',
          bytes: new TextEncoder().encode(pages.join('\n\n\f\n\n')),
        };
      }
      if (selected.length > 100)
        throw new Error(
          'Export up to 100 pages at a time to fit browser memory. Use page ranges for larger PDFs.',
        );
      const images: Record<string, Uint8Array> = {};
      for (const [n, index] of selected.entries()) {
        aborted(signal);
        const canvas = await renderPage(doc, index, options.dpi / 72);
        images[`page-${String(index + 1).padStart(3, '0')}.${options.format}`] = await canvasBytes(
          canvas,
          options.format,
          options.quality,
        );
        canvas.width = canvas.height = 1;
        progress((n + 1) / selected.length);
      }
      return {
        name: name('images', 'zip'),
        mime: 'application/zip',
        bytes: await zipFiles(images),
      };
    } finally {
      await doc.loadingTask.destroy();
    }
  }
  if (tool === 'split') {
    let groups: number[][] = [];
    if (options.splitMode === 'pages')
      groups = Array.from({ length: source.pages.length }, (_, i) => [i]);
    else if (options.splitMode === 'every') {
      for (let i = 0; i < source.pages.length; i += options.every)
        groups.push(
          Array.from({ length: Math.min(options.every, source.pages.length - i) }, (_, n) => i + n),
        );
    } else {
      if (!options.range.trim())
        throw new Error('Enter ranges separated by commas, such as 1-3, 4-6.');
      groups = options.range
        .split(',')
        .map((group) => parseRange(group, source.pages.length, false));
    }
    if (groups.length > 200)
      throw new Error('Split up to 200 output files at a time. Try splitting every few pages.');
    const parts: Record<string, Uint8Array> = {};
    for (const [n, indices] of groups.entries()) {
      aborted(signal);
      parts[name(`part-${String(n + 1).padStart(3, '0')}`)] = await reorderPdf(
        files,
        indices.map((index) => ({ id: String(index), fileId: source.id, index, rotation: 0 })),
      );
      progress((n + 1) / groups.length);
    }
    return {
      name: name('split', 'zip'),
      mime: 'application/zip',
      bytes: await zipFiles(parts),
      note: 'Interactive form fields are flattened to preserve their visible values.',
    };
  }
  const selected = parseRange(options.range, source.pages.length, tool !== 'delete');
  if (tool === 'extract' || tool === 'delete') {
    const indices =
      tool === 'extract'
        ? selected
        : source.pages.map((_, i) => i).filter((i) => !selected.includes(i));
    return output(
      await reorderPdf(
        files,
        indices.map((index) => ({ id: String(index), fileId: source.id, index, rotation: 0 })),
      ),
      tool,
      'Interactive form fields are flattened to preserve their visible values.',
    );
  }
  const doc = await PDFDocument.load(source.bytes);
  if (tool === 'flatten') await writeFields(doc, {}, true);
  if (tool === 'metadata') {
    doc.setTitle(options.title);
    doc.setAuthor(options.author);
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setCreator('');
    doc.setProducer('');
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (info && 'delete' in info) {
      for (const key of ['CreationDate', 'ModDate'])
        (info as import('pdf-lib').PDFDict).delete(PDFName.of(key));
    }
    doc.catalog.delete(PDFName.of('Metadata'));
  }
  if (tool === 'watermark' || tool === 'page-numbers') {
    const marks: Mark[] = [],
      font = await fontFor(doc);
    for (const [n, index] of selected.entries()) {
      const info = source.pages[index],
        text = tool === 'watermark' ? options.text : String(options.start + n),
        size = tool === 'page-numbers' ? Math.min(options.fontSize, 24) : options.fontSize;
      if (!text.trim()) throw new Error('Enter watermark text.');
      const textWidth = font.widthOfTextAtSize(text, size);
      if (textWidth > info.width - 24)
        throw new Error('The text is wider than the page. Reduce its font size.');
      const y =
        options.position === 'top'
          ? 24
          : options.position === 'bottom'
            ? info.height - size - 24
            : info.height / 2 - size / 2;
      marks.push({
        id: `number-${index}`,
        kind: 'text',
        page: index,
        x: (info.width - textWidth) / 2,
        y,
        width: textWidth,
        height: size * 1.2,
        text,
        fontSize: size,
        color: options.color,
        opacity: tool === 'page-numbers' ? 1 : options.opacity,
        strokeWidth: 0,
      });
    }
    await addMarks(doc, source, marks);
  }
  if (tool === 'crop') {
    for (const index of selected) {
      const info = source.pages[index],
        margin = options.margins;
      if (margin * 2 >= Math.min(info.width, info.height) - 20)
        throw new Error('The margin is too large for this document.');
      const a = inversePoint(info.transform, margin, margin),
        b = inversePoint(info.transform, info.width - margin, info.height - margin);
      doc
        .getPage(index)
        .setCropBox(
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.abs(b[0] - a[0]),
          Math.abs(b[1] - a[1]),
        );
    }
  }
  return output(await doc.save());
}
