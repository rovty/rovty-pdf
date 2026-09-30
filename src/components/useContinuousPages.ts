import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Keep page shells in document order, but only rasterize pages near the viewport. */
export function useContinuousPages(
  viewport: RefObject<HTMLDivElement | null>,
  order: number[],
  current: number,
  onActive: (page: number) => void,
  interacting: boolean,
  selected: boolean,
) {
  const stages = useRef(new Map<number, HTMLDivElement>());
  const [nearby, setNearby] = useState<Set<number>>(() => new Set([current]));
  const state = useRef({ current, onActive, interacting, selected });
  const navigationScroll = useRef<number | undefined>(undefined);
  state.current = { current, onActive, interacting, selected };
  const jumpTo = useCallback(
    (index: number) => {
      const view = viewport.current,
        stage = stages.current.get(index);
      if (!view || !stage) return;
      const padding = parseFloat(getComputedStyle(view).paddingTop) || 0;
      view.scrollTop +=
        stage.getBoundingClientRect().top - view.getBoundingClientRect().top - padding;
      navigationScroll.current = view.scrollTop;
      setNearby((previous) => new Set([...previous, index]));
    },
    [viewport],
  );

  useLayoutEffect(() => {
    // Reordering must keep the same source page in view, including undo/redo.
    jumpTo(state.current.current);
  }, [order, jumpTo]);

  useEffect(() => {
    const view = viewport.current;
    if (!view) return;
    let frame = 0;
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.sourcePage);
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        setNearby(new Set(visible));
        scroll();
      },
      { root: view, rootMargin: '700px 0px' },
    );
    for (const stage of stages.current.values()) observer.observe(stage);
    const scroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (state.current.interacting) return;
        // A short last page may not reach the viewport center. Keep an explicit
        // thumbnail/page-number destination until the user scrolls away.
        if (navigationScroll.current !== undefined) {
          if (Math.abs(view.scrollTop - navigationScroll.current) < 1) return;
          navigationScroll.current = undefined;
        }
        const rect = view.getBoundingClientRect();
        const editing = stages.current.get(state.current.current)?.getBoundingClientRect();
        if (
          state.current.selected &&
          editing &&
          editing.bottom > rect.top &&
          editing.top < rect.bottom
        )
          return;
        const center = rect.top + view.clientHeight / 2;
        let closest = state.current.current,
          distance = Infinity;
        // The observer's candidates include a margin for fast trackpad scrolling.
        for (const index of visible) {
          const bounds = stages.current.get(index)?.getBoundingClientRect();
          if (!bounds || bounds.bottom <= rect.top || bounds.top >= rect.bottom) continue;
          const next = Math.max(bounds.top - center, center - bounds.bottom, 0);
          if (next < distance) {
            closest = index;
            distance = next;
          }
        }
        if (closest !== state.current.current) state.current.onActive(closest);
      });
    };
    view.addEventListener('scroll', scroll, { passive: true });
    return () => {
      observer.disconnect();
      view.removeEventListener('scroll', scroll);
      cancelAnimationFrame(frame);
    };
  }, [viewport, order]);
  return { stages, nearby, jumpTo };
}
