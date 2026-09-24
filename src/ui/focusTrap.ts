/**
 * useFocusTrap — dialog focus management for modals, drawers and sheets.
 *
 *  - on activate: remembers the opener (document.activeElement) and moves focus into the container
 *    (`[data-autofocus]` if present and enabled, else the first tabbable element, else the container);
 *    focus that a child already placed inside the container (autoFocus, its own effect) is left alone
 *  - while active: Tab / Shift+Tab cycle inside the container
 *  - on deactivate: returns focus to `returnFocus()` (if given) or the opener — but only when focus was
 *    lost with the dialog (it is on <body>), so an explicit focus() by the app is never overridden
 */
import { useEffect, useRef, type RefObject } from 'react';

const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Visible, keyboard-reachable elements inside `root`, in DOM order. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
  );
}

/** Active traps, innermost last: only the top one handles Tab (nested dialogs). */
const stack: HTMLElement[] = [];

export interface FocusTrapOptions {
  /** Where focus goes when the trap is released (default: the element focused before it activated). */
  returnFocus?: () => HTMLElement | null | undefined;
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, options: FocusTrapOptions = {}): void {
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!root.contains(document.activeElement)) {
      const preferred = root.querySelector<HTMLElement>('[data-autofocus]:not([disabled])');
      const target = preferred ?? tabbables(root)[0] ?? root;
      if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }

    stack.push(root);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || stack[stack.length - 1] !== root) return;
      const list = tabbables(root);
      if (list.length === 0) {
        e.preventDefault();
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
        root.focus({ preventScroll: true });
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const cur = document.activeElement;
      if (!root.contains(cur)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (cur === first || cur === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = stack.lastIndexOf(root);
      if (i >= 0) stack.splice(i, 1);
      const back = opts.current.returnFocus?.() ?? opener;
      // Runs after the dialog left the DOM: only restore if focus was lost with it.
      const lost = (): boolean => !document.activeElement || document.activeElement === document.body || root.contains(document.activeElement);
      if (back && back.isConnected && lost()) back.focus();
    };
  }, [active, ref]);
}
