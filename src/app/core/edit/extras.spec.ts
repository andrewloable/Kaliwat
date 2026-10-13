import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TreeStore } from '../tree-store/tree.store';
import { EditService } from './edit.service';
import { PersistenceService } from '../db/persistence.service';
import { extractDetails } from '../../ui/person-editor/person-editor';
import { lifeEventLabel } from '../model/life-events';

describe('EditService facts and life events', () => {
  let store: TreeStore;
  let service: EditService;
  let id: string;
  const person = () => store.individuals().find((i) => i.id === id)!;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TreeStore, EditService, { provide: PersistenceService, useValue: { scheduleWrite: vi.fn() } }],
    });
    store = TestBed.inject(TreeStore);
    service = TestBed.inject(EditService);
    store.setTreeId('extras-tree');
    id = service.createIndividual({ given: 'Ana', surname: 'López', sex: 'F' });
  });

  describe('facts', () => {
    it('adds an email to the record (with @ escaped) and shows it under Details', () => {
      expect(service.addFact(id, 'email', ' ana@example.com ')).toBeNull();
      expect(person().rawRef!.children.find((c) => c.tag === 'EMAIL')!.value).toBe('ana@@example.com');
      expect(extractDetails(person())).toEqual([
        expect.objectContaining({ label: 'Email', value: 'ana@example.com', href: 'mailto:ana@example.com' }),
      ]);
    });

    it('adds a Facebook link as an EVEN with a TYPE, adding https:// when missing', () => {
      expect(service.addFact(id, 'facebook', 'facebook.com/ana.lopez')).toBeNull();
      const even = person().rawRef!.children.find((c) => c.tag === 'EVEN')!;
      expect(even.value).toBe('https://facebook.com/ana.lopez');
      expect(even.children.find((c) => c.tag === 'TYPE')!.value).toBe('Facebook');
      expect(extractDetails(person())[0].label).toBe('Facebook');
    });

    it('adds a phone and a website', () => {
      expect(service.addFact(id, 'phone', '+63 917 555 1234')).toBeNull();
      expect(service.addFact(id, 'website', 'https://ana.example.com')).toBeNull();
      expect(extractDetails(person()).map((d) => d.label).sort()).toEqual(['Phone', 'Website']);
    });

    it('rejects bad values with a message and changes nothing', () => {
      expect(service.addFact(id, 'email', 'not an email')).toMatch(/valid email/i);
      expect(service.addFact(id, 'phone', '12')).toMatch(/valid phone/i);
      expect(service.addFact(id, 'facebook', 'nope')).toMatch(/valid web address/i);
      expect(service.addFact(id, 'website', 'javascript:alert(1)')).toMatch(/valid web address/i);
      expect(person().rawRef!.children.filter((c) => ['EMAIL', 'PHON', 'EVEN', 'WWW'].includes(c.tag))).toHaveLength(0);
    });

    it('removes a fact', () => {
      service.addFact(id, 'email', 'ana@example.com');
      const [d] = extractDetails(person());
      service.removeFact(id, d.node!);
      expect(extractDetails(person())).toHaveLength(0);
    });
  });

  describe('life events', () => {
    it('adds a baptism with date and place, in the record and the model', () => {
      expect(service.addLifeEvent(id, { tag: 'BAPM', date: '3 MAR 1990', place: 'Iloilo' })).toBeNull();
      const node = person().rawRef!.children.find((c) => c.tag === 'BAPM')!;
      expect(node.children.map((c) => [c.tag, c.value])).toEqual([['DATE', '3 MAR 1990'], ['PLAC', 'Iloilo']]);
      const ev = person().events.find((e) => e.type === 'BAPM')!;
      expect([ev.date, ev.place]).toEqual(['3 MAR 1990', 'Iloilo']);
      expect(lifeEventLabel(ev)).toBe('Baptism');
    });

    it('stores an occupation\'s text as the record value', () => {
      expect(service.addLifeEvent(id, { tag: 'OCCU', description: 'Teacher', place: 'Manila' })).toBeNull();
      expect(person().rawRef!.children.find((c) => c.tag === 'OCCU')!.value).toBe('Teacher');
      expect(person().events.find((e) => e.type === 'OCCU')!.description).toBe('Teacher');
    });

    it('stores an "other" event as EVEN with a TYPE and uses that name as its label', () => {
      expect(service.addLifeEvent(id, { tag: 'EVEN', title: 'Scholarship', date: '1985' })).toBeNull();
      const ev = person().events.find((e) => e.type === 'EVEN')!;
      expect(lifeEventLabel(ev)).toBe('Scholarship');
      expect(ev.raw!.children.find((c) => c.tag === 'TYPE')!.value).toBe('Scholarship');
    });

    it('validates input', () => {
      expect(service.addLifeEvent(id, { tag: 'BAPM' })).toMatch(/date, a place/i);
      expect(service.addLifeEvent(id, { tag: 'OCCU', date: '1990' })).toMatch(/occupation/i);
      expect(service.addLifeEvent(id, { tag: 'EVEN', date: '1990' })).toMatch(/name for this event/i);
      expect(service.addLifeEvent(id, { tag: 'XXXX', date: '1990' })).toMatch(/kind of event/i);
      expect(person().events).toHaveLength(0);
    });

    it('removes an event from the model and the record', () => {
      service.addLifeEvent(id, { tag: 'BURI', date: '2020' });
      service.removeLifeEvent(id, person().events.find((e) => e.type === 'BURI')!);
      expect(person().events.find((e) => e.type === 'BURI')).toBeUndefined();
      expect(person().rawRef!.children.find((c) => c.tag === 'BURI')).toBeUndefined();
    });
  });
});
