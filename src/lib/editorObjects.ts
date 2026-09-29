import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRadioGroup,
  PDFString,
  degrees,
  rgb,
  type PDFFont,
} from 'pdf-lib';
import type { Mark, NativeText, SourceFile } from './types';
import { uid } from './types';
import { inversePoint, transformPoint } from './utils';

export function markFromText(source: SourceFile, page: number, item: NativeText): Mark {
  const transform = source.pages[page].transform;
  const a = transformPoint(transform, item.bounds[0], item.bounds[1]);
  const b = transformPoint(transform, item.bounds[2], item.bounds[3]);
  const x = Math.min(a[0], b[0]),
    y = Math.min(a[1], b[1]);
  return {
    id: uid(),
    kind: 'text',
    page,
    x,
    y,
    width: Math.abs(b[0] - a[0]) + 12,
    height: Math.max(item.size * 1.3, Math.abs(b[1] - a[1])),
    fontSize: item.size || 16,
    text: item.text,
    color: item.color,
    opacity: item.opacity,
    strokeWidth: 1,
    sourcePath: item.path,
    originalText: item,
    sourceOrigin: [x, y],
    fontMode: 'original',
  };
}

export function safeLink(url: string) {
  let value: URL;
  try {
    value = new URL(url);
  } catch {
    throw new Error('Enter a complete link beginning with https://, http:// or mailto:.');
  }
  if (!['https:', 'http:', 'mailto:'].includes(value.protocol))
    throw new Error('Links must begin with https://, http:// or mailto:.');
  return value.href;
}

export async function readLinks(source: SourceFile): Promise<Mark[]> {
  const doc = await PDFDocument.load(source.bytes);
  const links: Mark[] = [];
  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots();
    if (!annots) return;
    annots.asArray().forEach((ref, index) => {
      const item = doc.context.lookup(ref);
      if (!(item instanceof PDFDict) || item.get(PDFName.of('Subtype')) !== PDFName.of('Link'))
        return;
      const rect = item.lookupMaybe(PDFName.of('Rect'), PDFArray);
      if (!rect || rect.size() !== 4) return;
      const values = rect.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0));
      const a = transformPoint(source.pages[pageIndex].transform, values[0], values[1]);
      const b = transformPoint(source.pages[pageIndex].transform, values[2], values[3]);
      const action = item.lookupMaybe(PDFName.of('A'), PDFDict);
      const uri = action?.lookup(PDFName.of('URI'));
      const destination = item.lookup(PDFName.of('Dest')) || action?.lookup(PDFName.of('D'));
      const destinationIndex =
        destination instanceof PDFArray
          ? doc.getPages().findIndex((p) => p.ref.toString() === destination.get(0)?.toString())
          : -1;
      const link: Mark = {
        id: `link-${pageIndex}-${index}`,
        kind: 'link',
        sourceLink: index,
        page: pageIndex,
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        width: Math.abs(b[0] - a[0]),
        height: Math.abs(b[1] - a[1]),
        color: '#3564b0',
        opacity: 1,
        strokeWidth: 1,
        fontSize: 12,
        url: uri && 'decodeText' in uri ? (uri as PDFString).decodeText() : '',
        ...(destinationIndex >= 0 ? { destinationPage: destinationIndex + 1 } : {}),
      };
      link.originalLink = {
        url: link.url,
        destinationPage: link.destinationPage,
        x: link.x,
        y: link.y,
        width: link.width,
        height: link.height,
      };
      links.push(link);
    });
  });
  return links;
}

export function removeChangedLinks(doc: PDFDocument, marks: Mark[]) {
  // Source indices are stable only before any annotations are added or removed.
  for (const [pageIndex, page] of doc.getPages().entries()) {
    const indices = new Set(
      marks
        .filter((m) => m.page === pageIndex && m.sourceLink !== undefined && !unchangedLink(m))
        .map((m) => m.sourceLink),
    );
    const annots = page.node.Annots();
    if (annots) for (let i = annots.size() - 1; i >= 0; i--) if (indices.has(i)) annots.remove(i);
  }
}

export function unchangedLink(mark: Mark) {
  return (
    !mark.deleted &&
    !!mark.originalLink &&
    (['url', 'destinationPage', 'x', 'y', 'width', 'height'] as const).every(
      (key) => mark[key] === mark.originalLink![key],
    )
  );
}

export function addFormFields(doc: PDFDocument, source: SourceFile, marks: Mark[], font?: PDFFont) {
  const form = doc.getForm();
  const radios = new Map<string, PDFRadioGroup>();
  const checked = new Set<string>();
  for (const mark of marks.filter((m) => m.kind === 'form' && !m.deleted)) {
    const name = mark.fieldName?.trim();
    if (!name) throw new Error('Give every form field a name.');
    const info = source.pages[mark.page];
    const [x, y] = inversePoint(info.transform, mark.x, mark.y + mark.height);
    const options = {
      x,
      y,
      width: mark.width,
      height: mark.height,
      rotate: degrees(info.rotation),
      borderWidth: 1,
      borderColor: rgb(0.38, 0.43, 0.52),
      backgroundColor: rgb(1, 1, 1),
      textColor: rgb(0.08, 0.08, 0.09),
      font,
    };
    const page = doc.getPage(mark.page);
    if (mark.formType === 'radio') {
      let group = radios.get(name);
      if (!group) {
        if (form.getFieldMaybe(name))
          throw new Error(`The field name “${name}” is already used. Choose a unique name.`);
        group = form.createRadioGroup(name);
        radios.set(name, group);
      }
      const option = mark.fieldValue?.trim() || 'Option';
      if (group.getOptions().includes(option))
        throw new Error(`Use a different choice value for each button in “${name}”.`);
      group.addOptionToPage(option, page, options);
      if (mark.checked) {
        if (checked.has(name)) throw new Error(`Select only one default choice for “${name}”.`);
        group.select(option);
        checked.add(name);
      }
      continue;
    }
    if (form.getFieldMaybe(name))
      throw new Error(`The field name “${name}” is already used. Choose a unique name.`);
    if (mark.formType === 'checkbox') {
      const field = form.createCheckBox(name);
      field.addToPage(page, options);
      if (mark.checked) field.check();
    } else if (mark.formType === 'select') {
      const field = form.createDropdown(name);
      const choices = [...new Set((mark.fieldOptions || []).map((v) => v.trim()).filter(Boolean))];
      if (!choices.length) throw new Error(`Add at least one option to “${name}”.`);
      field.setOptions(choices);
      if (mark.fieldValue) {
        if (!choices.includes(mark.fieldValue))
          throw new Error(`The default value for “${name}” must match one of its options.`);
        field.select(mark.fieldValue);
      }
      field.addToPage(page, options);
      field.setFontSize(mark.fontSize);
    } else {
      const field = form.createTextField(name);
      if (mark.formType === 'multiline') field.enableMultiline();
      field.addToPage(page, options);
      field.setFontSize(mark.fontSize);
      field.setText(mark.fieldValue || '');
    }
  }
}
