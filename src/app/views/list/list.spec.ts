import { TestBed } from '@angular/core/testing';
import { ListComponent } from './list';
import { TreeStore } from '../../core/tree-store/tree.store';
import { ImportService } from '../../core/import/import.service';
import { SearchService } from '../../core/search/search.service';
import { Individual } from '../../core/model/types';

// Minimal stub — spec only exercises template + computed signals
class FakeImportService {
  importFile = async () => ({ status: 'success' as const, treeId: 't', report: { total: 0, skipped: 0, warnings: [] } });
}

function makeIndi(id: string, name: string, birthYear?: string, deathYear?: string): Individual {
  return {
    id,
    names: [{ full: name }],
    sex: 'U',
    events: [
      ...(birthYear ? [{ type: 'BIRT', date: birthYear, place: undefined, citations: [], notes: [] }] : []),
      ...(deathYear ? [{ type: 'DEAT', date: deathYear, place: undefined, citations: [], notes: [] }] : []),
    ],
    unions: [],
    mediaIds: [],
    notes: [],
  };
}

describe('ListComponent', () => {
  let store: TreeStore;
  let search: SearchService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListComponent],
      providers: [
        TreeStore,
        { provide: ImportService, useClass: FakeImportService },
      ],
    }).compileComponents();
    store = TestBed.inject(TreeStore);
    search = TestBed.inject(SearchService);
    search.query.set('');
  });

  it('renders empty-state when store is empty', () => {
    const fixture = TestBed.createComponent(ListComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.empty-state')).toBeTruthy();
  });

  it('loads individuals into allRows signal via store', () => {
    const fixture = TestBed.createComponent(ListComponent);
    store.setIndividuals([
      makeIndi('a', 'Alice Smith', '1900', '1980'),
      makeIndi('b', 'Bob Jones', '1905'),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.rows().length).toBe(2);
    expect(fixture.componentInstance.rows()[0].displayName).toBe('Alice Smith');
  });

  it('shows no-results state when search matches nothing', () => {
    const fixture = TestBed.createComponent(ListComponent);
    store.setIndividuals([makeIndi('a', 'Alice Smith', '1900')]);
    search.query.set('zzznomatch');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.no-results')).toBeTruthy();
  });

  it('filters rows by search query (case-insensitive)', () => {
    const fixture = TestBed.createComponent(ListComponent);
    store.setIndividuals([
      makeIndi('a', 'Alice Smith'),
      makeIndi('b', 'Bob Jones'),
    ]);
    search.query.set('alice');
    const filtered = fixture.componentInstance.filtered();
    expect(filtered.length).toBe(1);
    expect(filtered[0].displayName).toContain('Alice');
  });

  it('search is diacritic-insensitive (manus matches Mañus, raphael matches Raphaël)', () => {
    const fixture = TestBed.createComponent(ListComponent);
    store.setIndividuals([
      makeIndi('a', 'Marianita Mañus'),
      makeIndi('b', 'Raphaël Loable'),
      makeIndi('c', 'Bob Jones'),
    ]);
    search.query.set('manus');
    expect(fixture.componentInstance.filtered().map(r => r.displayName)).toEqual(['Marianita Mañus']);
    search.query.set('raphael');
    expect(fixture.componentInstance.filtered().map(r => r.displayName)).toEqual(['Raphaël Loable']);
  });

  it('search matches all terms in any order, across middle names', () => {
    const fixture = TestBed.createComponent(ListComponent);
    store.setIndividuals([
      makeIndi('a', 'Andrew Mañus Loable'),
      makeIndi('b', 'Bob Jones'),
    ]);
    search.query.set('andrew loable');
    expect(fixture.componentInstance.filtered().map(r => r.displayName)).toEqual(['Andrew Mañus Loable']);
    search.query.set('loable andrew');
    expect(fixture.componentInstance.filtered().map(r => r.displayName)).toEqual(['Andrew Mañus Loable']);
  });

  it('no-results state is visually distinct from empty-tree', () => {
    const fixture = TestBed.createComponent(ListComponent);
    store.setIndividuals([makeIndi('a', 'Alice')]);
    search.query.set('zzz');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.no-results')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.empty-state')).toBeNull();
  });
});
