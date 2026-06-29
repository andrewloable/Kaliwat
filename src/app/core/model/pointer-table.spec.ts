import { describe, it, expect, beforeEach } from 'vitest';
import { PointerTable } from './pointer-table';

describe('PointerTable', () => {
  let pt: PointerTable;

  beforeEach(() => {
    pt = new PointerTable();
  });

  it('round-trips xref ↔ uuid', () => {
    pt.register('@I1@', 'uuid-001');
    expect(pt.getUuid('@I1@')).toBe('uuid-001');
    expect(pt.getXref('uuid-001')).toBe('@I1@');
  });

  it('returns undefined for unknown entries', () => {
    expect(pt.getUuid('@UNKNOWN@')).toBeUndefined();
    expect(pt.getXref('no-such-uuid')).toBeUndefined();
  });

  it('allocate never collides with existing xrefs', () => {
    pt.register('@I1@', 'uuid-001');
    const next = pt.allocate('I');
    expect(next).not.toBe('@I1@');
    expect(pt.hasXref(next)).toBe(false);
  });

  it('allocate produces distinct xrefs across multiple calls', () => {
    const a = pt.allocate('I');
    pt.register(a, 'uuid-a');
    const b = pt.allocate('I');
    expect(a).not.toBe(b);
  });
});
