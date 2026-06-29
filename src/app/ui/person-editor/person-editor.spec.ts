import { describe, it, expect } from 'vitest';
import { extractDetails, factLabel } from './person-editor';
import { GedcomNode, Individual } from '../../core/model/types';

const n = (tag: string, value?: string, children: GedcomNode[] = []): GedcomNode => ({
  level: 0, tag, value, children, xref: undefined, pointer: undefined,
});

function person(...rawChildren: GedcomNode[]): Individual {
  return {
    id: 'p1', names: [{ full: 'Test Person' }], events: [], unions: [],
    mediaIds: [], notes: [], rawRef: n('INDI', undefined, rawChildren),
  };
}

describe('factLabel', () => {
  it('maps known social URLs to friendly labels', () => {
    expect(factLabel('', 'https://facebook.com/x')).toBe('Facebook');
    expect(factLabel('', 'https://twitter.com/x')).toBe('Twitter / X');
    expect(factLabel('', 'https://x.com/x')).toBe('Twitter / X');
    expect(factLabel('', 'https://instagram.com/x')).toBe('Instagram');
    expect(factLabel('', 'https://www.linkedin.com/in/x')).toBe('LinkedIn');
  });

  it('falls back to the fact type, then "Fact"', () => {
    expect(factLabel('Occupation', 'https://example.com')).toBe('Occupation');
    expect(factLabel('', 'https://example.com')).toBe('Fact');
  });
});

describe('extractDetails', () => {
  it('returns [] when there is no person or no raw subtree', () => {
    expect(extractDetails(null)).toEqual([]);
    expect(extractDetails({ ...person(), rawRef: undefined })).toEqual([]);
  });

  it('extracts EMAIL nested under RESI, un-escaping @@ and adding mailto:', () => {
    const indi = person(n('RESI', undefined, [n('EMAIL', 'andrew.loable@@gmail.com')]));
    const d = extractDetails(indi)[0];
    expect(d).toEqual({ label: 'Email', value: 'andrew.loable@gmail.com', href: 'mailto:andrew.loable@gmail.com' });
  });

  it('extracts PHON as a tel: link with whitespace stripped', () => {
    const d = extractDetails(person(n('PHON', '+63 917 555 1234')))[0];
    expect(d.label).toBe('Phone');
    expect(d.href).toBe('tel:+639175551234');
  });

  it('extracts WWW as a website link', () => {
    const d = extractDetails(person(n('WWW', 'https://loable.tech')))[0];
    expect(d).toEqual({ label: 'Website', value: 'https://loable.tech', href: 'https://loable.tech' });
  });

  it('labels an EVEN whose value is a social URL and keeps it as a link', () => {
    const indi = person(n('EVEN', 'https://www.facebook.com/andrew.loable', [n('TYPE', 'Fact 1')]));
    const d = extractDetails(indi)[0];
    expect(d.label).toBe('Facebook');
    expect(d.href).toBe('https://www.facebook.com/andrew.loable');
  });

  it('labels a non-URL EVEN by its TYPE with no link', () => {
    const indi = person(n('EVEN', 'Carpenter', [n('TYPE', 'Occupation')]));
    const d = extractDetails(indi)[0];
    expect(d).toEqual({ label: 'Occupation', value: 'Carpenter', href: undefined });
  });

  it('de-duplicates identical details', () => {
    const indi = person(n('EMAIL', 'a@b.com'), n('EMAIL', 'a@b.com'));
    expect(extractDetails(indi)).toHaveLength(1);
  });
});
