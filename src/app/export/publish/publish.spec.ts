import { describe, it, expect } from 'vitest';
import { generatePublishHtml } from './publish';
import { Individual, Union, MediaObject, UUID } from '../../core/model/types';

function mkI(id: UUID, name: string, events: Individual['events'] = []): Individual {
  return { id, sourceXref: id, names: [{ full: name }], sex: 'U', events, unions: [], mediaIds: [], notes: [], rawRef: undefined as never };
}
function ev(type: string, date?: string): Individual['events'][0] {
  return { type, date, citations: [], notes: [] };
}

const REFERENCE_YEAR = 2026;
const BASE = { referenceYear: REFERENCE_YEAR };

describe('generatePublishHtml()', () => {
  it('living person name does not appear in output', async () => {
    const living = mkI('LIVING', 'SecretName /Person/'); // no death event → living
    const indis = new Map([['LIVING', living]]);
    const { html } = await generatePublishHtml(indis, new Map(), new Map(), new Map(), BASE);
    expect(html).not.toMatch(/SecretName/);
    expect(html).not.toMatch(/Person.*SecretName|SecretName.*Person/);
  });

  it('deceased person name appears in output', async () => {
    const dead = mkI('DEAD', 'Visible /García/', [ev('DEAT', '1 JAN 1990')]);
    const indis = new Map([['DEAD', dead]]);
    const { html } = await generatePublishHtml(indis, new Map(), new Map(), new Map(), BASE);
    expect(html).toMatch(/Visible/);
    expect(html).toMatch(/García/);
  });

  it('output HTML has no http(s):// external asset URLs', async () => {
    const dead = mkI('D', 'Test /Person/', [ev('DEAT', '1 JAN 1980')]);
    const { html } = await generatePublishHtml(new Map([['D', dead]]), new Map(), new Map(), new Map(), BASE);
    // Should have no src="http..." or href="http..." references
    expect(html).not.toMatch(/(?:src|href|url)=?["'\(]https?:\/\//i);
  });

  it('output is valid HTML with required structure', async () => {
    const { html } = await generatePublishHtml(new Map(), new Map(), new Map(), new Map(), BASE);
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toMatch(/<meta charset="utf-8"/i);
    expect(html).toMatch(/ONE-WAY EXPORT/);
    expect(html).toMatch(/<\/html>/i);
  });

  it('one-way export notice is present', async () => {
    const { html } = await generatePublishHtml(new Map(), new Map(), new Map(), new Map(), BASE);
    expect(html).toMatch(/one-way export.*read only/i);
  });

  it('large output triggers size warning', async () => {
    const dead = mkI('D', 'Big /Tree/', [ev('DEAT', '1 JAN 1980')]);
    const { warnings } = await generatePublishHtml(
      new Map([['D', dead]]), new Map(), new Map(), new Map(),
      { ...BASE, maxSizeBytes: 10 }, // ridiculously small threshold
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/MB/);
  });

  it('no warning for small output', async () => {
    const { warnings } = await generatePublishHtml(new Map(), new Map(), new Map(), new Map(), BASE);
    expect(warnings).toHaveLength(0);
  });

  it('livingCount reflects actual living count', async () => {
    const indis = new Map([
      ['L1', mkI('L1', 'Live /One/')],              // living
      ['L2', mkI('L2', 'Live /Two/')],              // living
      ['D1', mkI('D1', 'Dead /One/', [ev('DEAT', '1 JAN 1980')])], // deceased
    ]);
    const { livingCount } = await generatePublishHtml(indis, new Map(), new Map(), new Map(), BASE);
    expect(livingCount).toBe(2);
  });

  it('custom title appears in output', async () => {
    const { html } = await generatePublishHtml(
      new Map(), new Map(), new Map(), new Map(),
      { ...BASE, title: 'My Custom Family' },
    );
    expect(html).toMatch(/My Custom Family/);
  });

  it('embedded JSON is inlined (no external script src)', async () => {
    const { html } = await generatePublishHtml(new Map(), new Map(), new Map(), new Map(), BASE);
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });
});
