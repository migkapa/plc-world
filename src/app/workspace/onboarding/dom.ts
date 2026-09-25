/**
 * DOM helpers for the coach marks and callouts: find what a step points at (only visible elements count), and drive
 * the ladder editor's operand box the way a player would ("Show me"). The workspace components expose stable hooks
 * for this: `data-testid` on the panels, `data-control` on pad controls, `data-rung-row` on rungs, `data-el` on
 * instructions, `aria-label="XIC — …"` on palette buttons and `.ld-pop input[aria-label="XIC Bit"]` on the operand box.
 */

/** Visible on screen (laid out, non-empty, not scrolled completely out of the viewport). */
export function isShown(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el instanceof Element)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return false;
  const st = window.getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
}

/** First shown element of a selector (inside `root`, default the document). */
export function firstShown(selector: string, root: ParentNode = document): HTMLElement | null {
  for (const el of Array.from(root.querySelectorAll(selector))) if (isShown(el)) return el as HTMLElement;
  return null;
}

/** Laid out at all (it may be scrolled away inside its panel). */
export function isLaidOut(el: Element | null | undefined): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 2 && r.height >= 2;
}

export const ladderPanel = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="ladder-panel"]');
export const twinPanel = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="twin-panel"]');

/** A pad control (Switch 0…) as shown in the 3D panel's operator pad. */
export function padControl(id: string): HTMLElement | null {
  const twin = twinPanel();
  return twin ? firstShown(`[data-control="${CSS.escape(id)}"]`, twin) : null;
}

/** Palette button of an instruction (full toolbar or compact row). */
export function paletteButton(op: string): HTMLElement | null {
  const lp = ladderPanel();
  return lp ? firstShown(`button[aria-label^="${CSS.escape(op)} —"]`, lp) : null;
}

/** The open operand box (input + suggestion list) of an instruction, if any. */
export function operandBox(op: string): { box: HTMLElement; input: HTMLInputElement } | null {
  const lp = ladderPanel();
  const input = lp?.querySelector<HTMLInputElement>(`.ld-pop input[aria-label^="${CSS.escape(op)} "]`);
  if (!input) return null;
  const box = input.closest<HTMLElement>('.ld-pop') ?? input;
  return { box, input };
}

/** Rendered instruction of the ladder (by element id). */
export function instructionEl(elementId: string): HTMLElement | null {
  const lp = ladderPanel();
  const el = lp?.querySelector(`g.ld-i[data-el="${CSS.escape(elementId)}"]`);
  return el ? (el as unknown as HTMLElement) : null;
}

/** Rung row `index` of the ladder editor. */
export function rungRow(index: number): HTMLElement | null {
  const lp = ladderPanel();
  const rows = lp ? Array.from(lp.querySelectorAll<HTMLElement>('[data-rung-row]')) : [];
  return rows[index] ?? null;
}

/**
 * Type `value` into a React-controlled input and press Enter, like a player (the editor then commits the operand and
 * moves on exactly as it would for real typing).
 */
export function typeAndEnter(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  input.focus();
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rectOf(el: Element, pad = 0): Rect {
  const r = el.getBoundingClientRect();
  const left = Math.max(2, r.left - pad);
  const top = Math.max(2, r.top - pad);
  const right = Math.min(window.innerWidth - 2, r.right + pad);
  const bottom = Math.min(window.innerHeight - 2, r.bottom + pad);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (!!a && !!b && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1);

/**
 * Where to put a card of `size` next to `target` (below, above, right, left — the first that fits), clamped to the
 * viewport with a `margin`. Without a target: bottom center.
 */
export type CardSide = 'below' | 'above' | 'right' | 'left';

export function placeCard(
  target: Rect | null,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
  margin = 10,
  order: ReadonlyArray<CardSide> = ['below', 'above', 'right', 'left'],
): { left: number; top: number; side: CardSide | 'center' } {
  const clampX = (x: number): number => Math.max(margin, Math.min(viewport.width - size.width - margin, x));
  const clampY = (y: number): number => Math.max(margin, Math.min(viewport.height - size.height - margin, y));
  if (!target) return { left: clampX((viewport.width - size.width) / 2), top: clampY(viewport.height - size.height - 24), side: 'center' };
  const cx = target.left + target.width / 2 - size.width / 2;
  const cy = target.top + target.height / 2 - size.height / 2;
  for (const side of order) {
    if (side === 'below' && target.top + target.height + gap + size.height + margin <= viewport.height) return { left: clampX(cx), top: target.top + target.height + gap, side };
    if (side === 'above' && target.top - gap - size.height - margin >= 0) return { left: clampX(cx), top: target.top - gap - size.height, side };
    if (side === 'right' && target.left + target.width + gap + size.width + margin <= viewport.width) return { left: target.left + target.width + gap, top: clampY(cy), side };
    if (side === 'left' && target.left - gap - size.width - margin >= 0) return { left: target.left - gap - size.width, top: clampY(cy), side };
  }
  // a huge target (a whole panel): inside it, bottom center
  return { left: clampX(cx), top: clampY(target.top + target.height - size.height - margin), side: 'center' };
}
