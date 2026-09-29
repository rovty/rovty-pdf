import { useEffect, useState } from 'react';

export function useNavigationDrawer(open: boolean, setOpen: (open: boolean) => void) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = matchMedia('(max-width: 760px)');
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [setOpen]);
  useEffect(() => {
    if (!mobile || !open) return;
    const panel = document.getElementById('product-navigation')!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const targets = () =>
      Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')).filter(
        (item) => item.getClientRects().length,
      );
    targets()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== 'Tab') return;
      const items = targets(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      previous?.focus({ preventScroll: true });
    };
  }, [mobile, open, setOpen]);
  return mobile;
}
