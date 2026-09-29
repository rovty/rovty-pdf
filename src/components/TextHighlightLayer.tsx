import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import type { HighlightRect, PageInfo } from '../lib/types';

export interface TextHighlightHandle {
  apply: () => void;
}

export default forwardRef<
  TextHighlightHandle,
  {
    doc: PDFDocumentProxy;
    page: number;
    info: PageInfo;
    scale: number;
    color: string;
    onHighlight: (rects: HighlightRect[]) => void;
    onSelectionChange: (selected: boolean) => void;
    onError: (message: string) => void;
  }
>(function TextHighlightLayer(
  { doc, page, info, scale, color, onHighlight, onSelectionChange, onError },
  ref,
) {
  const root = useRef<HTMLDivElement>(null),
    layer = useRef<HTMLDivElement>(null);
  const pointer = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false),
    [empty, setEmpty] = useState(false);
  const ownsSelection = useCallback(() => {
    const selection = window.getSelection();
    return selection &&
      !selection.isCollapsed &&
      selection.toString().trim() &&
      layer.current?.contains(selection.anchorNode) &&
      layer.current.contains(selection.focusNode)
      ? selection
      : undefined;
  }, []);
  const apply = useCallback(() => {
    const selection = ownsSelection(),
      container = layer.current,
      pageBox = root.current?.getBoundingClientRect();
    if (!selection || !container || !pageBox) return;
    const rects: HighlightRect[] = [];
    // A range's parent rectangles may cover whole spans. Clip each text node
    // to the actual selected offsets to retain partial-word selections.
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      const nodes = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
        if (!range.intersectsNode(node)) continue;
        const part = document.createRange();
        part.selectNodeContents(node);
        if (node === range.startContainer) part.setStart(node, range.startOffset);
        if (node === range.endContainer) part.setEnd(node, range.endOffset);
        if (part.collapsed || !part.toString()) continue;
        for (const box of part.getClientRects())
          rects.push({
            x: ((box.left - pageBox.left) * info.width) / pageBox.width,
            y: ((box.top - pageBox.top) * info.height) / pageBox.height,
            width: (box.width * info.width) / pageBox.width,
            height: (box.height * info.height) / pageBox.height,
          });
      }
    }
    selection.removeAllRanges();
    onSelectionChange(false);
    if (rects.length) onHighlight(rects);
  }, [ownsSelection, info, onHighlight, onSelectionChange]);
  useImperativeHandle(ref, () => ({ apply }), [apply]);
  useEffect(() => {
    let active = true,
      textLayer: TextLayer | undefined;
    const container = layer.current!;
    setReady(false);
    setEmpty(false);
    container.replaceChildren();
    void doc
      .getPage(page + 1)
      .then(async (pdfPage) => {
        if (!active) return;
        const viewport = pdfPage.getViewport({ scale });
        const content = await pdfPage.getTextContent();
        if (!active) return;
        const factor = viewport.scale * pdfPage.userUnit;
        container.style.setProperty('--total-scale-factor', String(factor));
        textLayer = new TextLayer({ textContentSource: content, container, viewport });
        await textLayer.render();
        if (active) {
          setEmpty(!textLayer.textContentItemsStr.some((text) => text.trim()));
          setReady(true);
        }
      })
      .catch((error) => {
        if (active && error?.name !== 'AbortException')
          onError('Text selection could not load. Try Freehand highlighting for this page.');
      });
    return () => {
      active = false;
      textLayer?.cancel();
      if (ownsSelection()) window.getSelection()?.removeAllRanges();
      onSelectionChange(false);
    };
  }, [doc, page, scale, onError, onSelectionChange, ownsSelection]);
  useEffect(() => {
    const change = () => onSelectionChange(!!ownsSelection());
    const finish = () => {
      if (pointer.current === 'mouse' || pointer.current === 'pen') apply();
      pointer.current = undefined;
    };
    const cancel = () => {
      pointer.current = undefined;
    };
    const keydown = (event: KeyboardEvent) => {
      if (!ownsSelection()) return;
      if (event.key === 'Escape') {
        window.getSelection()?.removeAllRanges();
        onSelectionChange(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        apply();
      }
    };
    document.addEventListener('selectionchange', change);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('selectionchange', change);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', keydown);
    };
  }, [apply, onSelectionChange, ownsSelection]);
  return (
    <div
      ref={root}
      className="text-highlight-root"
      data-ready={ready}
      style={{ '--selection-color': `${color}88` } as CSSProperties}
    >
      <div
        ref={layer}
        className="pdf-highlight-text-layer"
        aria-label="Select text to highlight"
        onPointerDown={(event) => {
          if (event.button === 0) pointer.current = event.pointerType;
        }}
      />
      {ready && empty && (
        <p className="highlight-empty">
          No selectable text on this page. Choose Freehand to highlight it.
        </p>
      )}
    </div>
  );
});
