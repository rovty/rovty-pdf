export type ScanPoint = { x: number; y: number };
export type ScanQuad = [ScanPoint, ScanPoint, ScanPoint, ScanPoint];
export type ScanMode = 'document' | 'receipt' | 'id' | 'whiteboard' | 'photo';
export type ScanFilter = 'original' | 'color' | 'gray' | 'bw';
export const scanModes: { id: ScanMode; name: string; icon: string; hint: string }[] = [
  { id: 'document', name: 'Document', icon: 'File', hint: 'Letters, forms, notes and invoices' },
  {
    id: 'receipt',
    name: 'Receipt',
    icon: 'ReceiptText',
    hint: 'Keep the full length of your receipt',
  },
  { id: 'id', name: 'ID card', icon: 'ContactRound', hint: 'Capture the front, then the back' },
  {
    id: 'whiteboard',
    name: 'Whiteboard',
    icon: 'Presentation',
    hint: 'Straighten the board and brighten the background',
  },
  { id: 'photo', name: 'Photo', icon: 'Images', hint: 'Keep the original colors and framing' },
];
export const scanFilters: { id: ScanFilter; name: string }[] = [
  { id: 'color', name: 'Clean color' },
  { id: 'bw', name: 'Black & white' },
  { id: 'gray', name: 'Grayscale' },
  { id: 'original', name: 'Original' },
];
export type ScanSettings = {
  filter: ScanFilter;
  brightness: number;
  contrast: number;
  rotation: number;
};
export type ScanPage = ScanSettings & {
  id: string;
  name: string;
  source: Blob;
  sourceUrl: string;
  thumbnail: string;
  thumbnailKey?: string;
  width: number;
  height: number;
  quad: ScanQuad;
  detected: boolean;
};
export function scanAppearanceKey(page: ScanPage) {
  return JSON.stringify([
    page.id,
    page.quad,
    page.filter,
    page.brightness,
    page.contrast,
    page.rotation,
  ]);
}
export type ScanPaper = 'a4' | 'letter' | 'fit';
export type ScanExportOptions = {
  name: string;
  paper: ScanPaper;
  quality: 'standard' | 'high';
  idLayout: boolean;
  margin: number;
};
export const fullQuad = (): ScanQuad => [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
export function quadArea(quad: ScanQuad) {
  return (
    Math.abs(
      quad.reduce((sum, p, i) => sum + p.x * quad[(i + 1) % 4].y - quad[(i + 1) % 4].x * p.y, 0),
    ) / 2
  );
}
export function validQuad(points: ScanQuad) {
  if (
    points.length !== 4 ||
    points.some(
      (p) =>
        !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1,
    )
  )
    return false;
  if (quadArea(points) < 0.015) return false;
  return points.every((p, i) => {
    const next = points[(i + 1) % 4],
      after = points[(i + 2) % 4];
    return (next.x - p.x) * (after.y - next.y) - (next.y - p.y) * (after.x - next.x) > 0.0001;
  });
}
export function orderQuad(points: ScanPoint[]): ScanQuad {
  const center = {
    x: points.reduce((s, p) => s + p.x, 0) / 4,
    y: points.reduce((s, p) => s + p.y, 0) / 4,
  };
  const ordered = [...points].sort(
    (a, b) =>
      Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );
  const start = ordered.reduce(
    (best, p, i) => (p.x + p.y < ordered[best].x + ordered[best].y ? i : best),
    0,
  );
  return [...ordered.slice(start), ...ordered.slice(0, start)] as ScanQuad;
}
export function scanPageLayout(
  width: number,
  height: number,
  options: Pick<ScanExportOptions, 'paper' | 'margin'>,
) {
  const size =
    options.paper === 'a4'
      ? [595.28, 841.89]
      : options.paper === 'letter'
        ? [612, 792]
        : [(width * 72) / 200, (height * 72) / 200];
  if (options.paper !== 'fit' && width > height) size.reverse();
  const margin = options.paper === 'fit' ? 0 : options.margin;
  const scale = Math.min((size[0] - margin * 2) / width, (size[1] - margin * 2) / height);
  return {
    width: size[0],
    height: size[1],
    x: (size[0] - width * scale) / 2,
    y: (size[1] - height * scale) / 2,
    drawnWidth: width * scale,
    drawnHeight: height * scale,
  };
}
