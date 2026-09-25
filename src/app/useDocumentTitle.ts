/**
 * Per-route document title: "<title> · PLC World" (just "PLC World" without a title). Restores the previous
 * title when the page unmounts, so a route without its own title never shows a stale one.
 */
import { useEffect } from 'react';

export const APP_TITLE = 'PLC World';

export function pageTitle(title?: string): string {
  const t = title?.trim();
  return t ? `${t} · ${APP_TITLE}` : APP_TITLE;
}

export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.title;
    document.title = pageTitle(title);
    return () => {
      document.title = prev;
    };
  }, [title]);
}
