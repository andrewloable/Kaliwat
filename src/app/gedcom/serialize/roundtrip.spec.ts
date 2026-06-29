import { describe, it, expect } from 'vitest';
import { parseGedcomBytes } from '../parser/gedcom-parser';
import { normalizeAst } from '../normalize/normalizer';
import { serializeModel, mutateGivenName, mutateBirthDate } from './gedcom-serializer';

const encode = (s: string) => new TextEncoder().encode(s);

// UTF-8 fixture with standard tags + custom tags to verify preservation
const CORPUS_GED = `0 HEAD
1 SOUR TestApp
2 VERS 1.0
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Maria /Santos/
2 GIVN Maria
2 SURN Santos
1 SEX F
1 BIRT
2 DATE 12 JUN 1945
2 PLAC Manila, Philippines
1 DEAT
2 DATE 3 MAR 2018
1 _CUSTOM_FIELD SomeAppData
2 _NESTED nested value
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jose /Reyes/
2 GIVN Jose
2 SURN Reyes
1 SEX M
1 BIRT
2 DATE 4 APR 1940
1 FAMS @F1@
0 @I3@ INDI
1 NAME Ana /Reyes/
2 GIVN Ana
2 SURN Reyes
1 SEX F
1 BIRT
2 DATE 7 JAN 1968
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 CHIL @I3@
1 MARR
2 DATE 1966
2 PLAC Manila, Philippines
1 _APPTAG preserved custom family tag
0 TRLR
`;

function roundTrip(ged: string) {
  const r1 = parseGedcomBytes(encode(ged));
  const { model: m1 } = normalizeAst(r1.ast);
  const exported = serializeModel(m1);
  const r2 = parseGedcomBytes(encode(exported));
  const { model: m2 } = normalizeAst(r2.ast);
  return { m1, m2, exported };
}

describe('GEDCOM serializer round-trip', () => {
  it('exported text is parseable (no abort, has HEAD and TRLR)', () => {
    const { exported } = roundTrip(CORPUS_GED);
    expect(exported).toContain('0 HEAD');
    expect(exported).toContain('0 TRLR');
    expect(exported).toMatch(/0 @I\d+@ INDI/);
    expect(exported).toMatch(/0 @F\d+@ FAM/);
  });

  it('import → export → import: same individual + union count', () => {
    const { m1, m2 } = roundTrip(CORPUS_GED);
    expect(m2.individuals.size).toBe(m1.individuals.size);
    expect(m2.unions.size).toBe(m1.unions.size);
  });

  it('import → export → import: names semantically equal', () => {
    const { m1, m2 } = roundTrip(CORPUS_GED);
    for (const indi1 of m1.individuals.values()) {
      const indi2 = [...m2.individuals.values()].find(i => i.sourceXref === indi1.sourceXref);
      expect(indi2).toBeDefined();
      expect(indi2!.names[0]?.full).toBe(indi1.names[0]?.full);
    }
  });

  it('import → export → import: family relationships preserved', () => {
    const { m1, m2 } = roundTrip(CORPUS_GED);
    for (const u1 of m1.unions.values()) {
      const u2 = [...m2.unions.values()].find(u => u.sourceXref === u1.sourceXref);
      expect(u2).toBeDefined();
      expect(u2!.childLinks).toHaveLength(u1.childLinks.length);
      expect(u2!.spouseIds).toHaveLength(u1.spouseIds.length);
    }
  });

  it('custom/unknown tags are preserved through round-trip', () => {
    const { exported } = roundTrip(CORPUS_GED);
    expect(exported).toContain('_CUSTOM_FIELD SomeAppData');
    expect(exported).toContain('_NESTED nested value');
    expect(exported).toContain('_APPTAG preserved custom family tag');
  });

  it('mutated given name: edit reflected, sibling tags intact (merge path exercised)', () => {
    const { model } = normalizeAst(parseGedcomBytes(encode(CORPUS_GED)).ast);

    const maria = [...model.individuals.values()].find(i => i.names[0]?.full === 'Maria Santos');
    expect(maria).toBeDefined();
    mutateGivenName(maria!, 'Isabella');

    const exported = serializeModel(model);
    expect(exported).toContain('Isabella /Santos/');
    // Sibling tags of INDI must survive (death date, custom field)
    expect(exported).toContain('1 DEAT');
    expect(exported).toContain('_CUSTOM_FIELD');

    // Re-import: edit visible in normalized model
    const { model: m2 } = normalizeAst(parseGedcomBytes(encode(exported)).ast);
    const edited = [...m2.individuals.values()].find(i => i.sourceXref === maria!.sourceXref);
    expect(edited!.names[0]?.given).toBe('Isabella');
    expect(edited!.names[0]?.full).toBe('Isabella Santos');
  });

  it('mutated birth date: date reflected, other fields intact', () => {
    const { model } = normalizeAst(parseGedcomBytes(encode(CORPUS_GED)).ast);

    const jose = [...model.individuals.values()].find(i => i.names[0]?.full === 'Jose Reyes');
    expect(jose).toBeDefined();
    mutateBirthDate(jose!, '15 SEP 1938');

    const exported = serializeModel(model);
    expect(exported).toContain('15 SEP 1938');

    const { model: m2 } = normalizeAst(parseGedcomBytes(encode(exported)).ast);
    const edited = [...m2.individuals.values()].find(i => i.sourceXref === jose!.sourceXref);
    expect(edited!.events.find(e => e.type === 'BIRT')?.date).toBe('15 SEP 1938');
    // Name untouched
    expect(edited!.names[0]?.full).toBe('Jose Reyes');
  });
});
