// @vitest-environment jsdom
/** Per-route titles and the 404 page (QA: every route was "PLC World"; the 404 had no way back). */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import NotFoundPage from './pages/NotFoundPage';
import { pageTitle, useDocumentTitle } from './useDocumentTitle';

afterEach(cleanup);

function Titled({ title }: { title?: string }) {
  useDocumentTitle(title);
  return null;
}

describe('document titles', () => {
  it('formats "<page> · PLC World" and restores the previous title on unmount', () => {
    expect(pageTitle('1-1 Hello, Lamp')).toBe('1-1 Hello, Lamp · PLC World');
    expect(pageTitle()).toBe('PLC World');
    expect(pageTitle('  ')).toBe('PLC World');
    document.title = 'before';
    const view = render(<Titled title="Campaign" />);
    expect(document.title).toBe('Campaign · PLC World');
    view.rerender(<Titled title="Profile" />);
    expect(document.title).toBe('Profile · PLC World');
    view.unmount();
    expect(document.title).toBe('before');
  });

  it('the 404 page names the address and links home, to the campaign and the reference', () => {
    const { hook } = memoryLocation({ path: '/no-such-page' });
    render(
      <Router hook={hook}>
        <NotFoundPage />
      </Router>,
    );
    expect(document.title).toBe('Page not found · PLC World');
    expect(screen.getByTestId('not-found').textContent).toContain('#/no-such-page');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/campaign', '/reference']));
  });
});
