import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TreeStore } from '../tree-store/tree.store';
import { EditService } from './edit.service';
import { PersistenceService } from '../db/persistence.service';

describe('EditService relative builders take form data', () => {
  let store: TreeStore;
  let service: EditService;
  const person = (id: string) => store.individuals().find((i) => i.id === id)!;
  const union = (id: string) => store.unions().find((u) => u.id === id)!;
  const mk = (given: string, sex: 'M' | 'F') => service.createIndividual({ given, surname: 'S', sex });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TreeStore, EditService, { provide: PersistenceService, useValue: { scheduleWrite: vi.fn() } }],
    });
    store = TestBed.inject(TreeStore);
    service = TestBed.inject(EditService);
    store.setTreeId('quickadd-tree');
  });

  it('addChild files the child under the chosen family only', () => {
    const mother = mk('Mother', 'F');
    service.linkSpouses(mother, mk('Jose', 'M'));
    service.linkSpouses(mother, mk('Pedro', 'M'));
    const [u1, u2] = store.unions().filter((u) => u.spouseIds.includes(mother));
    const kid = service.addChild(mother, { given: 'Kid', surname: 'Cruz', sex: 'M' }, u2.id);
    expect(union(u2.id).childLinks.map((c) => c.childId)).toEqual([kid]);
    expect(union(u1.id).childLinks).toHaveLength(0);
    expect(person(kid).names[0].full).toBe('Kid Cruz');
    expect(person(kid).sex).toBe('M');
  });

  it('addSpouse with data', () => {
    const a = mk('A', 'M');
    const b = service.addSpouse(a, { given: 'B', surname: '', sex: 'F' });
    expect(person(b).sex).toBe('F');
    expect(store.unions().some((u) => u.spouseIds.includes(a) && u.spouseIds.includes(b))).toBe(true);
  });

  it('addParent and addSibling with data', () => {
    const c = mk('C', 'M');
    const dad = service.addParent(c, { given: 'Dad', surname: 'S', sex: 'M' });
    expect(person(dad).names[0].full).toBe('Dad S');
    const sis = service.addSibling(c, { given: 'Sis', surname: 'S', sex: 'F' });
    expect(person(sis).names[0].full).toBe('Sis S');
    expect(store.unions().some((u) => u.childLinks.some((l) => l.childId === c) && u.childLinks.some((l) => l.childId === sis))).toBe(true);
  });

  it('still creates a blank person without data', () => {
    const p = mk('P', 'M');
    const kid = service.addChild(p);
    expect(person(kid).names[0].full).toBe('');
    expect(person(kid).sex).toBe('U');
  });
});
