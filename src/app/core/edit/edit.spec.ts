import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TreeStore } from '../tree-store/tree.store';
import { EditService, PersonFormData } from './edit.service';
import { PersistenceService } from '../db/persistence.service';
import { TestBed } from '@angular/core/testing';

function mockPersistence(): Partial<PersistenceService> {
  return {
    scheduleWrite: vi.fn(),
    saveIndividuals: vi.fn().mockResolvedValue(undefined),
    saveUnions: vi.fn().mockResolvedValue(undefined),
  };
}

function baseForm(overrides: Partial<PersonFormData> = {}): PersonFormData {
  return { given: 'Ana', surname: 'López', sex: 'F', ...overrides };
}

describe('EditService', () => {
  let store: TreeStore;
  let service: EditService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TreeStore,
        EditService,
        { provide: PersistenceService, useValue: mockPersistence() },
      ],
    });
    store = TestBed.inject(TreeStore);
    service = TestBed.inject(EditService);
    store.setTreeId('test-tree');
  });

  it('createIndividual adds to store and returns uuid', () => {
    const id = service.createIndividual(baseForm());
    expect(id).toBeTruthy();
    const indis = store.individuals();
    expect(indis).toHaveLength(1);
    expect(indis[0].names[0].given).toBe('Ana');
    expect(indis[0].sex).toBe('F');
  });

  it('createIndividual stores birth/death events', () => {
    service.createIndividual(baseForm({ birthDate: '15 JUN 1940', birthPlace: 'Madrid', deathDate: '3 MAR 2010' }));
    const indi = store.individuals()[0];
    const birth = indi.events.find(e => e.type === 'BIRT');
    const death = indi.events.find(e => e.type === 'DEAT');
    expect(birth?.date).toBe('15 JUN 1940');
    expect(birth?.place).toBe('Madrid');
    expect(death?.date).toBe('3 MAR 2010');
  });

  it('updateIndividual mutates in-place', () => {
    const id = service.createIndividual(baseForm());
    service.updateIndividual(id, { ...baseForm(), given: 'María', surname: 'García', sex: 'F' });
    const indi = store.individuals().find(i => i.id === id);
    expect(indi?.names[0].given).toBe('María');
    expect(indi?.names[0].surname).toBe('García');
  });

  it('addParentChild creates union with parent+child', () => {
    const parentId = service.createIndividual(baseForm({ given: 'Luis', sex: 'M' }));
    const childId = service.createIndividual(baseForm({ given: 'Rosa', sex: 'F' }));
    const err = service.addParentChild(parentId, childId);
    expect(err).toBeNull();
    const unions = store.unions();
    expect(unions).toHaveLength(1);
    expect(unions[0].spouseIds).toContain(parentId);
    expect(unions[0].childLinks[0].childId).toBe(childId);
  });

  it('addParentChild rejects self-parenting', () => {
    const id = service.createIndividual(baseForm());
    const err = service.addParentChild(id, id);
    expect(err?.kind).toBe('self-parent');
  });

  it('addParentChild rejects ancestry cycle', () => {
    // A → child of B → child of A would be a cycle
    const aId = service.createIndividual(baseForm({ given: 'A' }));
    const bId = service.createIndividual(baseForm({ given: 'B' }));
    // Make A a child of B
    service.addParentChild(bId, aId);
    // Now try to make B a child of A — should be rejected
    const err = service.addParentChild(aId, bId);
    expect(err?.kind).toBe('cycle');
  });

  it('linkSpouses creates union with both spouse IDs', () => {
    const aId = service.createIndividual(baseForm({ given: 'Juan', sex: 'M' }));
    const bId = service.createIndividual(baseForm({ given: 'María', sex: 'F' }));
    const err = service.linkSpouses(aId, bId);
    expect(err).toBeNull();
    const unions = store.unions();
    expect(unions).toHaveLength(1);
    expect(unions[0].spouseIds).toContain(aId);
    expect(unions[0].spouseIds).toContain(bId);
  });

  it('linkSpouses rejects self-union', () => {
    const id = service.createIndividual(baseForm());
    const err = service.linkSpouses(id, id);
    expect(err?.kind).toBe('self-parent');
  });

  it('deleteIndividual removes the person and keeps a union with 2+ participants', () => {
    const parentId = service.createIndividual(baseForm({ given: 'Parent', sex: 'M' }));
    const child1 = service.createIndividual(baseForm({ given: 'Child1' }));
    const child2 = service.createIndividual(baseForm({ given: 'Child2' }));
    service.addParentChild(parentId, child1);
    service.addParentChild(parentId, child2);
    expect(store.unions()[0].childLinks).toHaveLength(2);

    service.deleteIndividual(child1);

    expect(store.individuals().find(i => i.id === child1)).toBeUndefined();
    const u = store.unions();
    expect(u).toHaveLength(1);
    expect(u[0].childLinks.map(c => c.childId)).toEqual([child2]);
    expect(u[0].spouseIds).toContain(parentId);
  });

  it('deleteIndividual drops a union left with fewer than two participants and unlinks it', () => {
    const a = service.createIndividual(baseForm({ given: 'Juan', sex: 'M' }));
    const b = service.createIndividual(baseForm({ given: 'María', sex: 'F' }));
    service.linkSpouses(a, b);
    expect(store.unions()).toHaveLength(1);

    service.deleteIndividual(b);

    expect(store.unions()).toHaveLength(0);
    expect(store.individuals().find(i => i.id === a)?.unions).toHaveLength(0);
  });

  it('ancestorIds returns empty for person with no parents', () => {
    const id = service.createIndividual(baseForm());
    expect(store.ancestorIds(id).size).toBe(0);
  });

  it('ancestorIds returns parent for simple chain', () => {
    const parentId = service.createIndividual(baseForm({ given: 'Parent' }));
    const childId = service.createIndividual(baseForm({ given: 'Child' }));
    service.addParentChild(parentId, childId);
    const ancestors = store.ancestorIds(childId);
    expect(ancestors.has(parentId)).toBe(true);
    expect(ancestors.has(childId)).toBe(false);
  });
});
