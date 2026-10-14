import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TreeStore } from '../tree-store/tree.store';
import { EditService, validateFact } from './edit.service';
import { PersistenceService } from '../db/persistence.service';
import { relativeDefaults } from './relative-defaults';
import type { Individual, Union } from '../model/types';

const p = (id: string, surname: string, sex: string) =>
  ({ id, names: [{ full: 'X ' + surname, given: 'X', surname }], sex, events: [], unions: [], mediaIds: [], notes: [] }) as Individual;
const u = (id: string, spouseIds: string[], childIds: string[] = []) =>
  ({ id, spouseIds, events: [], childLinks: childIds.map((c) => ({ childId: c, citations: [], notes: [] })) }) as unknown as Union;

describe('relativeDefaults', () => {
  const jose = p('jose', 'Reyes', 'M');
  const maria = p('maria', 'Santos', 'F');
  const pedro = p('pedro', 'Cruz', 'M');
  const all = [jose, maria, pedro];

  it('child of a male anchor takes his surname', () => {
    expect(relativeDefaults('child', jose, all, [])).toEqual({ surname: 'Reyes', sex: 'U' });
  });
  it('child of a female anchor with one husband takes his surname', () => {
    expect(relativeDefaults('child', maria, all, [u('u1', ['maria', 'jose'])]).surname).toBe('Reyes');
  });
  it('two husbands: chosen family decides, otherwise her own surname', () => {
    const us = [u('u1', ['maria', 'jose']), u('u2', ['maria', 'pedro'])];
    expect(relativeDefaults('child', maria, all, us, 'u2').surname).toBe('Cruz');
    expect(relativeDefaults('child', maria, all, us).surname).toBe('Santos');
  });
  it('female anchor with no union keeps her surname', () => {
    expect(relativeDefaults('child', maria, all, []).surname).toBe('Santos');
  });
  it('sibling takes the anchor surname', () => {
    expect(relativeDefaults('sibling', p('ana', 'Reyes', 'F'), all, [])).toEqual({ surname: 'Reyes', sex: 'U' });
  });
  it('spouse is the opposite sex with no surname', () => {
    expect(relativeDefaults('spouse', p('a', 'S', 'M'), [], [])).toEqual({ surname: '', sex: 'F' });
    expect(relativeDefaults('spouse', p('a', 'S', 'F'), [], [])).toEqual({ surname: '', sex: 'M' });
    expect(relativeDefaults('spouse', p('a', 'S', 'U'), [], [])).toEqual({ surname: '', sex: 'U' });
  });
  it('parent is the missing one of a one-parent family', () => {
    const ana = p('ana', 'Reyes', 'F');
    const sex = (spouses: string[]) =>
      relativeDefaults('parent', ana, [...all, ana], spouses.length >= 0 ? [u('u', spouses, ['ana'])] : []).sex;
    expect(sex(['jose'])).toBe('F');
    expect(sex(['maria'])).toBe('M');
    expect(sex(['jose', 'maria'])).toBe('U');
    expect(relativeDefaults('parent', ana, all, [])).toEqual({ surname: '', sex: 'U' });
  });
});

describe('validateFact', () => {
  let service: EditService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TreeStore, EditService, { provide: PersistenceService, useValue: { scheduleWrite: vi.fn() } }],
    });
    TestBed.inject(TreeStore).setTreeId('vf-tree');
    service = TestBed.inject(EditService);
  });

  it('accepts Facebook links', () => {
    for (const v of ['facebook.com/juan', 'https://m.facebook.com/profile.php?id=1', 'fb.com/juan']) {
      expect(validateFact('facebook', v)).toBeNull();
    }
  });
  it('rejects non-Facebook links, also through addFact', () => {
    expect(validateFact('facebook', 'instagram.com/juan')).toContain('Facebook link');
    expect(validateFact('facebook', 'juan.delacruz')).toContain('Facebook link');
    const id = service.createIndividual({ given: 'A', surname: 'B', sex: 'F' });
    expect(service.addFact(id, 'facebook', 'instagram.com/juan')).not.toBeNull();
  });
  it('keeps the other messages', () => {
    expect(validateFact('email', 'x@y.co')).toBeNull();
    expect(validateFact('email', 'nope')).toBe('Enter a valid email address.');
    expect(validateFact('phone', '12')).toBe('Enter a valid phone number.');
    expect(validateFact('website', 'nope')).toBe('Enter a valid web address (for example https://example.com).');
  });
});
