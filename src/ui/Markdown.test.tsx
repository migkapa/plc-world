/**
 * The tiny markdown renderer: GFM tables (mission 3-6 timing sheet), code/links nested in bold/italic
 * (2-4 `S:FS`, 3-4 `.TT`), wrapped list items, and a sweep over every mission's rendered text for
 * leftover markdown syntax.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../game/missions';
import { INSTRUCTIONS } from '../plc/instructions';
import { Markdown } from './Markdown';

const html = (src: string) => renderToStaticMarkup(<Markdown source={src} />);
/** Visible text of the rendered markup (tags stripped, entities decoded enough for these checks). */
const text = (src: string) =>
  html(src)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

describe('Markdown', () => {
  it('renders a GFM pipe table with a header row, alignment and inline markup in cells', () => {
    const out = html(`Intro line
| Phase | NS | Time |
|---|:---:|--:|
| 1 | **green** | 10 s |
| 2 | \`yellow\` | 3 s |
Next paragraph`);
    expect(out).toContain('<table');
    expect(out.match(/<th /g)).toHaveLength(3);
    expect(out.match(/<tr/g)).toHaveLength(3); // header + 2 rows
    expect(out).toMatch(/<th scope="col" class="[^"]*text-center[^"]*">NS<\/th>/);
    expect(out).toMatch(/<td class="[^"]*text-right[^"]*">10 s<\/td>/);
    expect(out).toMatch(/<strong[^>]*>green<\/strong>/);
    expect(out).toMatch(/<code[^>]*>yellow<\/code>/);
    expect(out).toMatch(/<p>Intro line<\/p>/);
    expect(out).toMatch(/<p>Next paragraph<\/p>/);
    expect(out).not.toContain('|');
  });

  it('keeps a lone pipe line without a separator row as a paragraph', () => {
    const out = html('| not | a table |\nstill text');
    expect(out).not.toContain('<table');
    expect(out).toContain('| not | a table |');
  });

  it('pads short rows and keeps escaped pipes in cells', () => {
    const out = html('| a | b |\n|---|---|\n| x \\| y |');
    expect(out.match(/<td /g)).toHaveLength(2);
    expect(out).toContain('x | y');
  });

  it('parses code and links inside **bold** and *italic*', () => {
    const out = html('The flag **`S:FS`** is set; *see `TON`* and **[docs](#/reference)**.');
    expect(out).toMatch(/<strong[^>]*><code[^>]*>S:FS<\/code><\/strong>/);
    expect(out).toMatch(/<em>see <code[^>]*>TON<\/code><\/em>/);
    expect(out).toMatch(/<strong[^>]*><a href="#\/reference"[^>]*>docs<\/a><\/strong>/);
    expect(out).not.toContain('`');
  });

  it('code spans win over asterisks inside them', () => {
    const out = html('Operators: `+ - * / MOD **` and **bold**');
    expect(out).toMatch(/<code[^>]*>\+ - \* \/ MOD \*\*<\/code>/);
    expect(out).toMatch(/<strong[^>]*>bold<\/strong>/);
  });

  it('joins an indented continuation line to its list item', () => {
    const out = html('- one `a`,\n  `b` two\n- three');
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out).toMatch(/<li>one <code[^>]*>a<\/code>, <code[^>]*>b<\/code> two<\/li>/);
    expect(out).not.toContain('<p>');
  });

  it('mission 3-6 shows its timing sheet as a 6-row table', () => {
    const m = MISSIONS.find((x) => x.id === '3-6')!;
    const out = html(m.briefing);
    expect(out.match(/<table/g)).toHaveLength(1);
    expect(out.match(/<tbody>([\s\S]*)<\/tbody>/)![1]!.match(/<tr/g)).toHaveLength(6);
    expect(out).toContain('all-red clearance');
  });

  it('leaves no raw markdown syntax in any mission text or instruction help', () => {
    const sources: [string, string][] = [];
    for (const m of MISSIONS) {
      sources.push([`${m.id} briefing`, m.briefing], ...m.objectives.map((o, i) => [`${m.id} objective ${i}`, o] as [string, string]));
      m.hints.forEach((h, i) => sources.push([`${m.id} hint ${i}`, h]));
      if (m.debrief) sources.push([`${m.id} debrief`, m.debrief]);
    }
    for (const [k, info] of Object.entries(INSTRUCTIONS)) if (info.details) sources.push([`${k} details`, info.details.replace(/```[\s\S]*?```/g, '')]);
    for (const [where, src] of sources) {
      const t = text(src);
      expect(t, where).not.toMatch(/\|\s*-{3}/); // table separator rows
      expect(t.replace(/`[^`\n]*[*+/-][^`\n]*`/g, ''), where).not.toMatch(/`/); // stray backticks
      expect(t, where).not.toMatch(/\*\*\S/); // unparsed bold
    }
  });
});
