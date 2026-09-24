import { describe, expect, it } from 'vitest';
import { GLOSSARY, glossaryHref, parseGlossaryParam } from './glossary';

describe('glossary deep links', () => {
  it('round-trips every term', () => {
    for (const g of GLOSSARY) expect(parseGlossaryParam(glossaryHref(g.id).split('/').pop())).toEqual({ term: g.id });
  });
  it('treats plain / unknown-term glossary as the glossary top, other segments as not-glossary', () => {
    expect(parseGlossaryParam('glossary')).toEqual({ term: undefined });
    expect(parseGlossaryParam('Glossary:nope')).toEqual({ term: undefined });
    expect(parseGlossaryParam('TON')).toBeNull();
    expect(parseGlossaryParam(undefined)).toBeNull();
  });
});
