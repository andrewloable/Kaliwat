import { describe, it, expect } from 'vitest';
import { parseGedcomBytes } from '../parser/gedcom-parser';
import { normalizeAst } from './normalizer';

const encode = (s: string) => new TextEncoder().encode(s);

const MULTI_FAMILY_GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME John /Doe/
1 SEX M
1 FAMS @F1@
1 FAMS @F2@
0 @I2@ INDI
1 NAME Alice /Smith/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Betty /Jones/
1 SEX F
1 FAMS @F2@
0 @I4@ INDI
1 NAME Child /Doe/
1 FAMC @F1@
0 @I5@ INDI
1 NAME Child2 /Doe/
1 FAMC @F2@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I4@
1 MARR
2 DATE 1990
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I3@
1 CHIL @I5@
0 TRLR
`;

const ORPHAN_GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Jane /Doe/
1 FAMS @MISSING@
0 TRLR
`;

const MISSING_FIELDS_GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
0 TRLR
`;

describe('normalizeAst', () => {
  it('maps individuals and families from a multi-family fixture', () => {
    const { ast } = parseGedcomBytes(encode(MULTI_FAMILY_GED));
    const { model } = normalizeAst(ast);
    expect(model.individuals.size).toBe(5);
    expect(model.unions.size).toBe(2);
  });

  it('allocates internal UUIDs distinct from GEDCOM xrefs', () => {
    const { ast } = parseGedcomBytes(encode(MULTI_FAMILY_GED));
    const { model, pointerTable } = normalizeAst(ast);
    const ids = [...model.individuals.keys()];
    expect(ids.length).toBeGreaterThan(0);
    // UUIDs should not look like @I1@ pointers
    ids.forEach((id) => expect(id).not.toMatch(/^@/));
    // PointerTable maps @I1@ to the same UUID as the individual's id
    const indi1Uuid = pointerTable.getUuid('@I1@');
    expect(model.individuals.has(indi1Uuid!)).toBe(true);
  });

  it('retains rawRef on each individual and union', () => {
    const { ast } = parseGedcomBytes(encode(MULTI_FAMILY_GED));
    const { model } = normalizeAst(ast);
    for (const indi of model.individuals.values()) {
      expect(indi.rawRef).toBeTruthy();
    }
    for (const union of model.unions.values()) {
      expect(union.rawRef).toBeTruthy();
    }
  });

  it('a multi-married person yields N unions with correct disjoint child sets', () => {
    const { ast } = parseGedcomBytes(encode(MULTI_FAMILY_GED));
    const { model, pointerTable } = normalizeAst(ast);
    const johnId = pointerTable.getUuid('@I1@')!;
    const john = model.individuals.get(johnId)!;
    expect(john.unions).toHaveLength(2);

    const u1 = model.unions.get(john.unions[0].unionId)!;
    const u2 = model.unions.get(john.unions[1].unionId)!;
    const c1 = u1.childLinks.map((l) => l.childId);
    const c2 = u2.childLinks.map((l) => l.childId);
    // Child sets are disjoint
    expect(c1.some((id) => c2.includes(id))).toBe(false);
    expect(c1.length + c2.length).toBe(2);
  });

  it('orphan pointer adds to report and does not throw', () => {
    const { ast } = parseGedcomBytes(encode(ORPHAN_GED));
    const { report } = normalizeAst(ast);
    expect(report.orphanPointers).toContain('@MISSING@');
  });

  it('missing NAME and SEX default gracefully', () => {
    const { ast } = parseGedcomBytes(encode(MISSING_FIELDS_GED));
    const { model } = normalizeAst(ast);
    const indi = [...model.individuals.values()][0];
    expect(indi).toBeTruthy();
    expect(indi.names.length).toBeGreaterThan(0);
    expect(indi.sex).toBe('U');
  });
});
