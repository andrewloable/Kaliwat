import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { OrphansService } from './orphans.service';
import { TreeStore } from '../../core/tree-store/tree.store';
import type { Individual } from '../../core/model/types';

const person = (id: string): Individual => ({ id, names: [{ full: id }], events: [], unions: [], mediaIds: [], notes: [] });

describe('OrphansService', () => {
  let store: TreeStore;
  let orphans: OrphansService;
  beforeEach(() => {
    TestBed.resetTestingModule();
    store = TestBed.inject(TreeStore);
    orphans = TestBed.inject(OrphansService);
    // A + B married (the main tree); C on their own.
    store.setIndividuals([person('A'), person('B'), person('C')]);
    store.setUnions([{ id: 'U', spouseIds: ['A', 'B'], events: [], childLinks: [] }]);
  });

  it('shows the banner while people are unconnected', () => {
    expect(orphans.total()).toBe(1);
    expect(orphans.bannerVisible()).toBe(true);
  });

  it('Dismiss hides the banner only until the number of unconnected people changes', () => {
    orphans.dismiss();
    expect(orphans.bannerVisible()).toBe(false);
    store.setIndividuals([...store.individuals(), person('D')]);
    expect(orphans.total()).toBe(2);
    expect(orphans.bannerVisible()).toBe(true);
  });

  it('open and close drive the review', () => {
    orphans.open();
    expect(orphans.reviewing()).toBe(true);
    orphans.close();
    expect(orphans.reviewing()).toBe(false);
  });
});
