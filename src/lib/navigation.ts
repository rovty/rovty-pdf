import type { MouseEvent } from 'react';

// Preserve new-tab, download, and modified-click behavior on real links.
export function followLink(event: MouseEvent<HTMLAnchorElement>, navigate: (path: string) => void) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.currentTarget.target ||
    event.currentTarget.hasAttribute('download')
  )
    return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href') || '/');
}
