import { Fragment, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Tiny, safe markdown renderer for mission briefings & instruction docs (no HTML injection).
 * Supports: # / ## / ### headings, paragraphs, - / * / 1. lists, > quotes, ``` code blocks,
 * **bold**, *italic*, `code`, [text](url) links, and --- rules.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={cn('md space-y-2 text-sm leading-relaxed text-slate-300', className)}>{renderBlocks(source)}</div>;
}

function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      i++;
      out.push(
        <pre key={key++} className="overflow-x-auto rounded-lg border border-edge bg-black/40 p-3 font-mono text-xs text-emerald-300">
          {body.join('\n')}
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const cls = level === 1 ? 'text-xl font-bold text-white' : level === 2 ? 'text-base font-semibold text-white mt-3' : 'text-sm font-semibold text-slate-100 mt-2';
      out.push(
        <div key={key++} className={cls}>
          {inline(h[2]!)}
        </div>,
      );
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push(<hr key={key++} className="border-edge" />);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      out.push(
        <ListTag key={key++} className={cn('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc', 'marker:text-slate-500')}>
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) body.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(
        <blockquote key={key++} className="rounded-r-lg border-l-4 border-safety/70 bg-safety/5 px-3 py-2 text-slate-200">
          {inline(body.join(' '))}
        </blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^(#{1,3}\s|```|>|\s*([-*]|\d+\.)\s+|---+$)/.test(lines[i]!)
    ) {
      para.push(lines[i++]!);
    }
    out.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function inline(text: string): ReactNode {
  const parts = text.split(INLINE);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`'))
      return (
        <code key={i} className="rounded bg-black/40 px-1 py-0.5 font-mono text-[0.85em] text-emerald-300">
          {p.slice(1, -1)}
        </code>
      );
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (link) {
      const href = link[2]!;
      const safe = /^(https?:|#|\/)/.test(href) ? href : '#';
      return (
        <a key={i} href={safe} className="text-sky-400 hover:underline" target={safe.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
