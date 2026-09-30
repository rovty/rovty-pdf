export type ToolId =
  | 'edit'
  | 'scan'
  | 'sign'
  | 'fill'
  | 'merge'
  | 'split'
  | 'organize'
  | 'extract'
  | 'delete'
  | 'rotate'
  | 'compress'
  | 'images-to-pdf'
  | 'pdf-to-images'
  | 'text'
  | 'watermark'
  | 'page-numbers'
  | 'crop'
  | 'protect'
  | 'unlock'
  | 'redact'
  | 'grayscale'
  | 'flatten'
  | 'metadata'
  | 'repair';
export type Category = 'All tools' | 'Edit & sign' | 'Organize' | 'Convert' | 'Secure';
export interface Tool {
  id: ToolId;
  name: string;
  description: string;
  category: Category;
  icon: string;
  accent: string;
  detail: string;
  action: string;
  multiple?: boolean;
  editor?: boolean;
}
export interface PageInfo {
  width: number;
  height: number;
  rotation: number;
  transform: number[];
}
export interface SourceFile {
  id: string;
  name: string;
  bytes: Uint8Array;
  size: number;
  pages: PageInfo[];
}
export interface PageRef {
  id: string;
  fileId: string;
  index: number;
  rotation: number;
}
export type MarkKind =
  | 'text'
  | 'image'
  | 'highlight'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'cover'
  | 'redact'
  | 'link'
  | 'form';
export interface Mark {
  id: string;
  page: number;
  kind: MarkKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fontSize: number;
  text?: string;
  dataUrl?: string;
  points?: number[][];
  highlightMode?: 'text' | 'freehand';
  highlightRects?: HighlightRect[];
  strokeWidth: number;
  opacity: number;
  sourcePath?: number[];
  originalText?: NativeText;
  sourceOrigin?: [number, number];
  fontMode?: 'original' | 'noto';
  fontFallback?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: 'noto' | 'serif' | 'mono' | 'sinhala';
  fillColor?: string;
  url?: string;
  destinationPage?: number;
  sourceLink?: number;
  originalLink?: {
    url?: string;
    destinationPage?: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  deleted?: boolean;
  formType?: 'text' | 'multiline' | 'checkbox' | 'select' | 'radio';
  fieldName?: string;
  fieldValue?: string;
  fieldOptions?: string[];
  checked?: boolean;
}
export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface NativeText {
  path: number[];
  text: string;
  bounds: [number, number, number, number];
  size: number;
  color: string;
  fontName: string;
  fontEmbedded: boolean;
  opacity: number;
  matrix?: number[];
  fontResource?: number;
  advance?: number;
  spaceWidth?: number;
  runs?: NativeText[];
  glyphs?: {
    index: number;
    text: string;
    bounds: [number, number, number, number];
    origin: [number, number];
    end: [number, number];
  }[];
}
export interface TextLayers {
  width: number;
  height: number;
  background: Uint8ClampedArray;
  foreground: Uint8ClampedArray;
}
export interface NativeTextEdit {
  id: string;
  page: number;
  path: number[];
  text: string;
  remove: boolean;
  delta: [number, number];
  scale: number;
  color?: string;
  opacity?: number;
  block?: NativeText;
  preserveText?: boolean;
  allowFallback?: boolean;
  fallbackFont?: string;
  preferredFallback?: string;
}
export interface FontFallback {
  id: string;
  page: number;
  originalFont: string;
  replacementFont: string;
}
export interface NativeTextResult {
  bytes: Uint8Array;
  fallbacks: FontFallback[];
}
export interface EditState {
  marks: Mark[];
  fields: Record<string, string | boolean | string[]>;
  // Original page indices in display/export order. Marks retain their source page.
  pageOrder?: number[];
}
export interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'select' | 'radio';
  value: string | boolean | string[];
  options?: string[];
  readOnly: boolean;
  multiline?: boolean;
  widgets?: { page: number; bounds: [number, number, number, number]; option?: string }[];
}
export interface Output {
  name: string;
  bytes: Uint8Array;
  mime: string;
  note?: string;
}
export interface ProcessOptions {
  range: string;
  splitMode: 'pages' | 'ranges' | 'every';
  every: number;
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  position: 'center' | 'top' | 'bottom';
  start: number;
  dpi: number;
  quality: number;
  format: 'jpg' | 'png';
  password: string;
  ownerPassword: string;
  margins: number;
  flattenForms: boolean;
  imageSize: 'fit' | 'a4' | 'letter';
  orientation: 'portrait' | 'landscape';
  title: string;
  author: string;
}
export const defaultOptions: ProcessOptions = {
  range: '',
  splitMode: 'pages',
  every: 1,
  text: 'CONFIDENTIAL',
  fontSize: 36,
  color: '#888888',
  opacity: 0.25,
  position: 'center',
  start: 1,
  dpi: 120,
  quality: 0.72,
  format: 'jpg',
  password: '',
  ownerPassword: '',
  margins: 20,
  flattenForms: false,
  imageSize: 'a4',
  orientation: 'portrait',
  title: '',
  author: '',
};
export const uid = () => crypto.randomUUID();
