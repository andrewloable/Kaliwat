import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { extractDetails, factLabel, PersonEditorComponent } from './person-editor';
import { TreeStore } from '../../core/tree-store/tree.store';
import { PersistenceService } from '../../core/db/persistence.service';
import { ExportService } from '../../export/export.service';
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
    expect(d).toMatchObject({ label: 'Email', value: 'andrew.loable@gmail.com', href: 'mailto:andrew.loable@gmail.com' });
  });

  it('extracts PHON as a tel: link with whitespace stripped', () => {
    const d = extractDetails(person(n('PHON', '+63 917 555 1234')))[0];
    expect(d.label).toBe('Phone');
    expect(d.href).toBe('tel:+639175551234');
  });

  it('extracts WWW as a website link', () => {
    const d = extractDetails(person(n('WWW', 'https://loable.tech')))[0];
    expect(d).toMatchObject({ label: 'Website', value: 'https://loable.tech', href: 'https://loable.tech' });
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
    expect(d).toMatchObject({ label: 'Occupation', value: 'Carpenter', href: undefined });
  });

  it('de-duplicates identical details', () => {
    const indi = person(n('EMAIL', 'a@b.com'), n('EMAIL', 'a@b.com'));
    expect(extractDetails(indi)).toHaveLength(1);
  });
});

describe('PersonEditorComponent large trims', () => {
  // P is the child of A + B; A is one of 21 children of GA + GB. Trimming P's ancestors removes A, B, GA, GB and
  // A's 20 siblings (24 people); `siblings` controls how many there are.
  function setup(siblings: number) {
    const exportFn = vi.fn(async () => 'ged' as const);
    TestBed.configureTestingModule({
      imports: [PersonEditorComponent],
      providers: [
        { provide: PersistenceService, useValue: { scheduleWrite: vi.fn(), estimateQuota: vi.fn(async () => null) } },
        { provide: ExportService, useValue: { export: exportFn } },
      ],
    });
    const store = TestBed.inject(TreeStore);
    store.setTreeId('trim-test');
    const sibs = Array.from({ length: siblings }, (_, i) => `S${i}`);
    const ids = ['P', 'A', 'B', 'GA', 'GB', ...sibs];
    store.setIndividuals(ids.map((id) => ({ id, names: [{ full: id }], events: [], unions: [], mediaIds: [], notes: [] })));
    store.setUnions([
      { id: 'U0', spouseIds: ['A', 'B'], events: [], childLinks: [{ childId: 'P', citations: [], notes: [] }] },
      { id: 'U1', spouseIds: ['GA', 'GB'], events: [], childLinks: ['A', ...sibs].map((childId) => ({ childId, citations: [], notes: [] })) },
    ]);
    const f = TestBed.createComponent(PersonEditorComponent);
    f.componentInstance.open('P');
    f.detectChanges();
    const c = f.componentInstance;
    c.confirmingTrim.set(c.trimOptions().find((o) => o.side === 'ancestors')!);
    f.detectChanges();
    const text = () => (f.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
    const button = (label: string) => [...(f.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent!.trim() === label);
    return { f, exportFn, text, button };
  }
  afterEach(() => TestBed.resetTestingModule());

  it('a large trim asks for a backup and names the count on the button', () => {
    const { text, button } = setup(20);
    expect(text()).toContain('Download a backup first?');
    expect(button('Delete 24 people')).toBeDefined();
    expect(button('Download backup')).toBeDefined();
  });

  it('Download backup calls export once and says so', async () => {
    const { f, exportFn, text, button } = setup(20);
    button('Download backup')!.click();
    await f.whenStable();
    f.detectChanges();
    expect(exportFn).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Backup downloaded');
  });

  it('a small trim keeps the short confirm', () => {
    const { text, button } = setup(0);
    expect(text()).toContain('Trim ancestors: delete 4 people permanently?');
    expect(button('Download backup')).toBeUndefined();
    expect(button('Trim')).toBeDefined();
  });

  it('always shows both trim buttons; a side with nobody on it is disabled with the reason', () => {
    const { f } = setup(0); // P has parents, no children
    f.componentInstance.confirmingTrim.set(null);
    f.detectChanges();
    const btn = (side: string) => [...(f.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent!.trim().startsWith('Trim ' + side)) as HTMLButtonElement | undefined;
    expect(btn('ancestors')).toBeDefined();
    expect(btn('ancestors')!.disabled).toBe(false);
    expect(btn('descendants')).toBeDefined();
    expect(btn('descendants')!.disabled).toBe(true);
    expect(btn('descendants')!.textContent).toContain('no children recorded');
  });
});
