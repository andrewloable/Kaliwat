import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TreeStore } from '../tree-store/tree.store';
import { EditService } from './edit.service';
import { PersistenceService } from '../db/persistence.service';
import { buildLayout } from '../../layout/pedigree-layout';

describe('EditService moving and disconnecting relatives', () => {
  let store: TreeStore;
  let service: EditService;
  let father: string, mother: string, jonathan: string, lourdes: string;
  const mk = (given: string, sex: 'M' | 'F') => service.createIndividual({ given, surname: 'S', sex });
  const person = (id: string) => store.individuals().find((i) => i.id === id)!;
  const familiesOf = (id: string) => store.unions().filter((u) => u.childLinks.some((c) => c.childId === id));
  /** The parents the Ancestors layout shows for someone. */
  const shownParents = (id: string) => {
    const l = buildLayout(id, 'pedigree', new Map(store.individuals().map((i) => [i.id, i])),
      new Map(store.unions().map((u) => [u.id, u])));
    return l.nodes.filter((n) => !n.isFocus).map((n) => n.id).sort();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TreeStore, EditService, { provide: PersistenceService, useValue: { scheduleWrite: vi.fn() } }],
    });
    store = TestBed.inject(TreeStore);
    service = TestBed.inject(EditService);
    store.setTreeId('relations-tree');
    father = mk('Father', 'M');
    mother = mk('Mother', 'F');
    jonathan = mk('Jonathan', 'M');
    lourdes = mk('Lourdes', 'F');
    service.linkSpouses(father, mother);
    service.addParentChild(father, jonathan);
  });

  it('connecting a new parent moves the child, and the tree follows', () => {
    expect(shownParents(jonathan)).toEqual([father, mother].sort()); // both parents, to start
    expect(service.addParentChild(lourdes, jonathan)).toBeNull();

    // exactly one family has him as a child now, and it is Lourdes's
    const fams = familiesOf(jonathan);
    expect(fams).toHaveLength(1);
    expect(fams[0].spouseIds).toEqual([lourdes]);
    expect(shownParents(jonathan)).toEqual([lourdes]);
    // the old couple is untouched
    expect(store.unions().find((u) => u.spouseIds.includes(father) && u.spouseIds.includes(mother))).toBeDefined();
    expect(person(lourdes).unions).toHaveLength(1);
  });

  it('moving the last child out of a one-parent family removes that family', () => {
    const solo = mk('Solo', 'F');
    service.addParentChild(solo, jonathan, false);
    expect(familiesOf(jonathan)).toHaveLength(2);
    service.addParentChild(lourdes, jonathan); // leaves both
    expect(store.unions().find((u) => u.spouseIds.length === 1 && u.spouseIds[0] === solo)).toBeUndefined();
    expect(person(solo).unions).toHaveLength(0);
  });

  it('connecting as a child of someone moves them too (the other direction)', () => {
    // "connect as child": Lourdes is the parent, Jonathan the child — same call from the parent's side
    service.addParentChild(lourdes, jonathan);
    expect(service.addParentChild(father, jonathan)).toBeNull(); // and back again
    expect(shownParents(jonathan)).toEqual([father, mother].sort()); // the old family again
    expect(familiesOf(jonathan)).toHaveLength(1);
  });

  it('refuses an existing link instead of adding it twice', () => {
    expect(service.addParentChild(father, jonathan)?.kind).toBe('duplicate');
    expect(service.linkSpouses(father, mother)?.kind).toBe('duplicate');
    expect(store.unions().filter((u) => u.spouseIds.includes(father) && u.spouseIds.includes(mother))).toHaveLength(1);
  });

  it('removeChildLink detaches a child from a family', () => {
    const fam = familiesOf(jonathan)[0];
    service.removeChildLink(jonathan, fam.id);
    expect(familiesOf(jonathan)).toHaveLength(0);
    expect(shownParents(jonathan)).toEqual([]);
    // the couple stays
    expect(store.unions().find((u) => u.id === fam.id)?.spouseIds.sort()).toEqual([father, mother].sort());
  });

  it('removeSpouse ends a couple with no children, and tidies both people', () => {
    const a = mk('A', 'M'), b = mk('B', 'F');
    service.linkSpouses(a, b);
    const u = store.unions().find((x) => x.spouseIds.includes(a) && x.spouseIds.includes(b))!;
    service.removeSpouse(a, u.id);
    expect(store.unions().find((x) => x.id === u.id)).toBeUndefined();
    expect(person(a).unions).toHaveLength(0);
    expect(person(b).unions).toHaveLength(0);
  });

  it('removeSpouse keeps the children with the other parent', () => {
    const fam = familiesOf(jonathan)[0];
    service.removeSpouse(father, fam.id);
    const after = store.unions().find((x) => x.id === fam.id)!;
    expect(after.spouseIds).toEqual([mother]);
    expect(after.childLinks.map((c) => c.childId)).toEqual([jonathan]);
    expect(person(father).unions.find((r) => r.unionId === fam.id)).toBeUndefined();
  });

  it('removing a parent from the child\'s side detaches that family (remove as parent)', () => {
    const fam = familiesOf(jonathan)[0];
    service.removeChildLink(jonathan, fam.id); // from the parent's list: "remove child Jonathan"
    expect(familiesOf(jonathan)).toHaveLength(0);
  });

  it('+ Parent fills the missing second parent of a one-parent family', () => {
    const kid = mk('Kid', 'M');
    service.addParentChild(father, kid, false); // may create a second family for father; use a fresh dad
    const dad = mk('Dad', 'M');
    const k2 = mk('K2', 'M');
    service.addParentChild(dad, k2);
    const newParent = service.addParent(k2);
    const fam = familiesOf(k2)[0];
    expect(fam.spouseIds.sort()).toEqual([dad, newParent].sort());
    expect(familiesOf(k2)).toHaveLength(1);
    expect(person(newParent).unions).toHaveLength(1);
  });
});
