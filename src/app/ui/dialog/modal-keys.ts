const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/** Can the user reach `el` with Tab: not hidden, and not inside a closed <details> (its summary excepted). */
function reachable(el: HTMLElement, panel: HTMLElement): boolean {
  if (el.closest('[hidden]')) return false;
  for (let d = el.closest('details'); d && panel.contains(d); d = d.parentElement?.closest('details') ?? null) {
    const isOwnSummary = el.tagName === 'SUMMARY' && el.parentElement === d;
    if (!d.open && !isOwnSummary) return false;
  }
  return true;
}

/**
 * Makes `panel` behave as a modal dialog: focus moves to the panel, Tab and Shift+Tab wrap inside it, and Escape
 * calls `onClose`. The panel itself takes focus, not its first field: a field focused while the opening Enter key is
 * still being handled receives that key and submits its form, and on phones a focused field pops up the keyboard.
 * The keys are handled on the panel, so an overlay drawn outside it (the photo crop) keeps its own keys.
 * Returns the cleanup, which also gives focus back to whatever opened the panel.
 */
export function trapModal(panel: HTMLElement, onClose: () => void): () => void {
  const opener = document.activeElement as (HTMLElement | SVGElement) | null;
  const controls = () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => reachable(el, panel));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = controls();
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !list.includes(active as HTMLElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || active === panel)) {
      e.preventDefault();
      first.focus();
    }
  };

  panel.addEventListener('keydown', onKey);
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
  panel.focus();

  return () => {
    panel.removeEventListener('keydown', onKey);
    if (opener?.isConnected && opener !== document.body) opener.focus();
  };
}
