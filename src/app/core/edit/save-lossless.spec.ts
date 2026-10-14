import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TreeStore } from '../tree-store/tree.store';
import { EditService } from './edit.service';
import { PersistenceService } from '../db/persistence.service';

describe('EditService.updateIndividual keeps what the form does not show', () => {
  let store: TreeStore;
  let service: EditService;
  const person = (id: string) => store.individuals().find((i) => i.id === id)!;
  const kids = (id: string, tag: string) => person(id).rawRef!.children.filter((c) => c.tag === tag);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TreeStore, EditService, { provide: PersistenceService, useValue: { scheduleWrite: vi.fn() } }],
    });
    store = TestBed.inject(TreeStore);
    service = TestBed.inject(EditService);
    store.setTreeId('lossless-tree');
  });

  const sour = () => ({ level: 2, tag: 'SOUR', pointer: '@S1@', children: [] });

  it('keeps life events', () => {
    const id = service.createIndividual({ given: 'A', surname: 'B', sex: 'F' });
    service.addLifeEvent(id, { tag: 'BAPM', date: '1 JAN 1975' });
    service.updateIndividual(id, { given: 'Ann', surname: 'B', sex: 'F' });
    const ev = person(id).events.filter((e) => e.type === 'BAPM');
    expect(ev).toHaveLength(1);
    expect(ev[0].date).toBe('1 JAN 1975');
  });

  it('keeps sources under Birth', () => {
    const id = service.createIndividual({ given: 'A', surname: 'B', sex: 'F', birthDate: '1 JAN 1950' });
    kids(id, 'BIRT')[0].children.push(sour());
    service.updateIndividual(id, { given: 'A', surname: 'B', sex: 'F', birthDate: '2 JAN 1950' });
    const birt = kids(id, 'BIRT');
    expect(birt).toHaveLength(1);
    expect(birt[0].children.map((c) => c.tag)).toContain('SOUR');
    expect(birt[0].children.find((c) => c.tag === 'DATE')!.value).toBe('2 JAN 1950');
  });

  it('clearing birth keeps a BIRT that still has a source', () => {
    const id = service.createIndividual({ given: 'A', surname: 'B', sex: 'F', birthDate: '1 JAN 1950' });
    kids(id, 'BIRT')[0].children.push(sour());
    service.updateIndividual(id, { given: 'A', surname: 'B', sex: 'F', birthDate: '', birthPlace: '' });
    const birt = kids(id, 'BIRT');
    expect(birt).toHaveLength(1);
    expect(birt[0].children.map((c) => c.tag)).toEqual(['SOUR']);
  });

  it('clearing birth removes an empty BIRT', () => {
    const id = service.createIndividual({ given: 'A', surname: 'B', sex: 'F', birthDate: '1 JAN 1950' });
    service.updateIndividual(id, { given: 'A', surname: 'B', sex: 'F', birthDate: '', birthPlace: '' });
    expect(kids(id, 'BIRT')).toHaveLength(0);
    expect(person(id).events.some((e) => e.type === 'BIRT')).toBe(false);
  });

  it('changing the death place keeps PLAC children', () => {
    const id = service.createIndividual({ given: 'A', surname: 'B', sex: 'F', deathPlace: 'Cebu' });
    kids(id, 'DEAT')[0].children.find((c) => c.tag === 'PLAC')!.children.push({ level: 3, tag: 'MAP', children: [] });
    service.updateIndividual(id, { given: 'A', surname: 'B', sex: 'F', deathPlace: 'Cebu City' });
    const plac = kids(id, 'DEAT')[0].children.find((c) => c.tag === 'PLAC')!;
    expect(plac.value).toBe('Cebu City');
    expect(plac.children.map((c) => c.tag)).toEqual(['MAP']);
  });
});
