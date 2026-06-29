import { describe, it, expect } from 'vitest';
import { parseGedcomBytes, MAX_BYTES } from './gedcom-parser';

const encode = (s: string) => new TextEncoder().encode(s);

const VALID_GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME John /Doe/
2 GIVN John
2 SURN Doe
1 SEX M
0 @F1@ FAM
1 HUSB @I1@
0 _CUSTOM TAG
1 _PROP somevalue
0 TRLR
`;

const MALFORMED_GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
NOT A VALID LINE
0 @I1@ INDI
1 NAME Jane /Smith/
0 TRLR
`;

describe('parseGedcomBytes', () => {
  it('parses a valid GEDCOM file and returns AST nodes', () => {
    const result = parseGedcomBytes(encode(VALID_GED));
    expect(result.report).toHaveLength(0);
    expect(result.ast.length).toBeGreaterThan(0);
    const tags = result.ast.map((n) => n.tag);
    expect(tags).toContain('HEAD');
    expect(tags).toContain('INDI');
    expect(tags).toContain('FAM');
    expect(tags).toContain('TRLR');
  });

  it('preserves unknown / custom tags in the AST', () => {
    const result = parseGedcomBytes(encode(VALID_GED));
    const custom = result.ast.find((n) => n.tag === '_CUSTOM');
    expect(custom).toBeTruthy();
    expect(custom!.children[0].tag).toBe('_PROP');
  });

  it('populates xref on level-0 records', () => {
    const result = parseGedcomBytes(encode(VALID_GED));
    const indi = result.ast.find((n) => n.tag === 'INDI');
    expect(indi?.xref).toBe('@I1@');
  });

  it('returns report entries for malformed lines without crashing', () => {
    const result = parseGedcomBytes(encode(MALFORMED_GED));
    expect(result.aborted).toBeFalsy();
    expect(result.report.length).toBeGreaterThan(0);
    // Still parses what it can
    const indi = result.ast.find((n) => n.tag === 'INDI');
    expect(indi).toBeTruthy();
  });

  it('returns aborted result when file exceeds the byte cap', () => {
    const oversized = new Uint8Array(MAX_BYTES + 1);
    const result = parseGedcomBytes(oversized);
    expect(result.aborted).toBe(true);
    expect(result.ast).toHaveLength(0);
    expect(result.report.length).toBeGreaterThan(0);
  });
});
