import { describe, it, expect } from 'vitest';
import { getUnionsWithChildren } from './union';
import { Individual, Union } from './types';

const makeIndividual = (unionIds: string[]): Individual => ({
  id: 'person-1',
  names: [],
  events: [],
  unions: unionIds.map((id) => ({ unionId: id })),
  mediaIds: [],
  notes: [],
});

const makeUnion = (id: string, childIds: string[]): Union => ({
  id,
  spouseIds: ['person-1', `spouse-of-${id}`],
  events: [],
  childLinks: childIds.map((childId) => ({ childId, citations: [], notes: [] })),
});

describe('getUnionsWithChildren', () => {
  it('returns empty array for person with no unions', () => {
    const person = makeIndividual([]);
    expect(getUnionsWithChildren(person, new Map())).toEqual([]);
  });

  it('returns one entry for a person with one union', () => {
    const union = makeUnion('u1', ['child-1', 'child-2']);
    const person = makeIndividual(['u1']);
    const result = getUnionsWithChildren(person, new Map([['u1', union]]));
    expect(result).toHaveLength(1);
    expect(result[0].childIds).toEqual(['child-1', 'child-2']);
  });

  it('returns two entries with disjoint child sets for a person with two unions', () => {
    const u1 = makeUnion('u1', ['child-A', 'child-B']);
    const u2 = makeUnion('u2', ['child-C']);
    const person = makeIndividual(['u1', 'u2']);
    const unionMap = new Map([
      ['u1', u1],
      ['u2', u2],
    ]);
    const result = getUnionsWithChildren(person, unionMap);
    expect(result).toHaveLength(2);
    const allChildren = result.flatMap((r) => r.childIds);
    const uniqueChildren = new Set(allChildren);
    expect(uniqueChildren.size).toBe(allChildren.length);
    expect(result[0].childIds).toEqual(['child-A', 'child-B']);
    expect(result[1].childIds).toEqual(['child-C']);
  });

  it('skips missing union refs gracefully', () => {
    const person = makeIndividual(['u1', 'u-missing']);
    const u1 = makeUnion('u1', ['child-X']);
    const result = getUnionsWithChildren(person, new Map([['u1', u1]]));
    expect(result).toHaveLength(1);
    expect(result[0].union.id).toBe('u1');
  });
});
