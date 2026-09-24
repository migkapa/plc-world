/** Tiny inline markdown subset for one-line texts: **bold**, `code`, *em* (no block elements, no HTML). */
import { Fragment } from 'react';

export function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
          <strong key={i} className="font-semibold text-white">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith('`') && p.endsWith('`') && p.length > 2 ? (
          <code key={i} className="rounded bg-black/40 px-1 py-px font-mono text-[0.88em] text-emerald-300">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith('*') && p.endsWith('*') && p.length > 2 ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
