import { describe, it, expect } from 'vitest';
import { parseGedcomBytes } from './gedcom-parser';
import { normalizeAst } from '../normalize/normalizer';

// Minimal GEDCOM 7.0 file exercising v7-specific features
const V7_GED = `0 HEAD
1 GEDC
2 VERS 7.0
1 SCHMA
2 TAG _MYAPP https://example.com/ext
1 CHAR UTF-8
0 @I1@ INDI
1 NAME John /Doe/
2 GIVN John
2 SURN Doe
1 SEX M
1 BIRT
2 DATE
3 PHRASE about 1850
1 DEAT
2 DATE 15 JAN 2020
3 PHRASE 15 January 2020
1 NOTE Inline note text
2 CONT second line of note
1 NOTE @SNO1@
1 FAMS @F1@
1 FAMC @VOID@
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 BIRT
2 DATE 3 MAR 1952
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 12 JUN 1975
0 @SNO1@ SNOTE Shared note text from v7 SNOTE record
0 TRLR
`;

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('GEDCOM 7.0 parser', () => {
  it('detects GEDCOM 7.0 version via HEAD.GEDC.VERS', () => {
    const { ast } = parseGedcomBytes(encode(V7_GED));
    const { model } = normalizeAst(ast);
    expect(model.meta.gedcomVersion).toBe('7.0');
  });

  it('handles DATE PHRASE subdirectory when DATE value is empty', () => {
    const { ast } = parseGedcomBytes(encode(V7_GED));
    const { model } = normalizeAst(ast);
    const john = [...model.individuals.values()].find(i => i.names[0]?.full === 'John Doe');
    expect(john).toBeDefined();
    const birt = john!.events.find(e => e.type === 'BIRT');
    expect(birt?.date).toBe('about 1850');
  });

  it('uses DATE value when present (ignores PHRASE override)', () => {
    const { ast } = parseGedcomBytes(encode(V7_GED));
    const { model } = normalizeAst(ast);
    const john = [...model.individuals.values()].find(i => i.names[0]?.full === 'John Doe');
    const deat = john!.events.find(e => e.type === 'DEAT');
    expect(deat?.date).toBe('15 JAN 2020'); // value takes priority over PHRASE
  });

  it('concatenates CONT children into parent value', () => {
    const { ast } = parseGedcomBytes(encode(V7_GED));
    const { model } = normalizeAst(ast);
    const john = [...model.individuals.values()].find(i => i.names[0]?.full === 'John Doe');
    const inlineNote = john!.notes.find(n => n.includes('Inline note text'));
    expect(inlineNote).toContain('Inline note text\nsecond line of note');
  });

  it('resolves @VOID@ pointer without orphan warning', () => {
    const { ast } = parseGedcomBytes(encode(V7_GED));
    const { report } = normalizeAst(ast);
    expect(report.orphanPointers).not.toContain('@VOID@');
  });

  it('resolves SNOTE pointer to shared note text', () => {
    const { ast } = parseGedcomBytes(encode(V7_GED));
    const { model } = normalizeAst(ast);
    const john = [...model.individuals.values()].find(i => i.names[0]?.full === 'John Doe');
    const snoteResolved = john!.notes.find(n => n.includes('Shared note text'));
    expect(snoteResolved).toBeDefined();
  });

  it('preserves raw AST for v7 records (lossless principle)', () => {
    const { ast } = parseGedcomBytes(encode(V7_GED));
    const { model } = normalizeAst(ast);
    const john = [...model.individuals.values()].find(i => i.names[0]?.full === 'John Doe');
    expect(john?.rawRef).toBeDefined();
    expect(john?.rawRef?.tag).toBe('INDI');
    expect(john?.rawRef?.xref).toBe('@I1@');
  });

  it('5.5.1 round-trip still works (guardrail: no regression)', () => {
    const ged551 = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Alice /Smith/
1 SEX F
0 TRLR
`;
    const { ast } = parseGedcomBytes(encode(ged551));
    const { model, report } = normalizeAst(ast);
    expect(model.meta.gedcomVersion).toBe('5.5.1');
    expect([...model.individuals.values()][0].names[0].full).toBe('Alice Smith');
    expect(report.orphanPointers).toHaveLength(0);
  });
});
