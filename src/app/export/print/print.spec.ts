import { describe, it, expect } from 'vitest';
import { generateSvg } from './print';
import { Individual, UUID } from '../../core/model/types';
import { applyRedaction } from '../redaction/redaction';

function mkI(id: UUID, name: string, events: Individual['events'] = []): Individual {
  return { id, sourceXref: id, names: [{ full: name }], sex: 'U', events, unions: [], mediaIds: [], notes: [], rawRef: undefined as never };
}
function deat(date: string): Individual['events'][0] {
  return { type: 'DEAT', date, citations: [], notes: [] };
}

const BASE_OPTS = { pageWidthMm: 297, pageHeightMm: 210, pageBreakThreshold: 30, title: 'Test Tree' };
const REF_YEAR = 2026;

describe('generateSvg()', () => {
  it('produces a valid SVG string', () => {
    const indis = new Map([['A', mkI('A', 'Ana /García/', [deat('1 JAN 1980')])]]);
    const { individuals: redacted } = applyRedaction(indis, { referenceYear: REF_YEAR });
    const { svg } = generateSvg(indis, redacted, BASE_OPTS);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toMatch(/<\/svg>$/);
  });

  it('deceased person name appears in SVG', () => {
    const indis = new Map([['A', mkI('A', 'María /López/', [deat('1 JAN 1970')])]]);
    const { individuals: redacted } = applyRedaction(indis, { referenceYear: REF_YEAR });
    const { svg } = generateSvg(indis, redacted, BASE_OPTS);
    expect(svg).toMatch(/María/);
    expect(svg).toMatch(/López/);
  });

  it('living person name does NOT appear in SVG', () => {
    const indis = new Map([['L', mkI('L', 'SecretPerson /Test/')]]); // no death → living
    const { individuals: redacted } = applyRedaction(indis, { referenceYear: REF_YEAR });
    const { svg } = generateSvg(indis, redacted, BASE_OPTS);
    expect(svg).not.toMatch(/SecretPerson/);
  });

  it('returns pageCount=1 for small trees', () => {
    const indis = new Map([['A', mkI('A', 'A /B/', [deat('1 JAN 1980')])]]);
    const { individuals: redacted } = applyRedaction(indis, { referenceYear: REF_YEAR });
    const { pageCount } = generateSvg(indis, redacted, BASE_OPTS);
    expect(pageCount).toBe(1);
  });

  it('returns pageCount>1 when individuals exceed pageBreakThreshold', () => {
    // Create 35 deceased individuals; threshold = 30 → 2 pages
    const indis = new Map<UUID, Individual>(
      Array.from({ length: 35 }, (_, i) => {
        const id = `P${i}`;
        return [id, mkI(id, `Person${i} /Test/`, [deat('1 JAN 1900')])];
      }),
    );
    const { individuals: redacted } = applyRedaction(indis, { referenceYear: REF_YEAR });
    const { pageCount } = generateSvg(indis, redacted, { ...BASE_OPTS, pageBreakThreshold: 30 });
    expect(pageCount).toBe(2);
  });

  it('SVG contains one-way export notice', () => {
    const { svg } = generateSvg(new Map(), new Map(), BASE_OPTS);
    expect(svg).toMatch(/one-way export/i);
  });

  it('SVG title appears in output', () => {
    const { svg } = generateSvg(new Map(), new Map(), { ...BASE_OPTS, title: 'My Family Chronicle' });
    expect(svg).toMatch(/My Family Chronicle/);
  });

  it('SVG has no http external asset references', () => {
    const indis = new Map([['A', mkI('A', 'A /B/', [deat('1 JAN 1980')])]]);
    const { individuals: redacted } = applyRedaction(indis, { referenceYear: REF_YEAR });
    const { svg } = generateSvg(indis, redacted, BASE_OPTS);
    // xmlns namespace URLs are legitimate; only flag actual asset hrefs/srcs
    expect(svg).not.toMatch(/(?:src|href|xlink:href)=["']https?:\/\//i);
  });

  it('empty tree produces valid SVG', () => {
    const { svg, pageCount } = generateSvg(new Map(), new Map(), BASE_OPTS);
    expect(svg).toMatch(/<svg /);
    expect(pageCount).toBe(1);
  });
});
