import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TreeStore } from '../core/tree-store/tree.store';
import { EditService } from '../core/edit/edit.service';
import { PersistenceService } from '../core/db/persistence.service';
import { ExportService } from './export.service';
import { GedcomNode } from '../core/model/types';

function mockPersistence(): Partial<PersistenceService> {
  return {
    scheduleWrite: vi.fn(),
    saveIndividuals: vi.fn().mockResolvedValue(undefined),
    saveUnions: vi.fn().mockResolvedValue(undefined),
  };
}

const childrenWith = (node: GedcomNode, tag: string) =>
  node.children.filter((c) => c.tag === tag).map((c) => c.pointer);

describe('ExportService.buildExportAst', () => {
  let store: TreeStore;
  let edit: EditService;
  let exporter: ExportService;

  // dad (M) + mom (F) married, with child kid (M)
  let dadX: string, momX: string, kidX: string, unionX: string;
  let ast: GedcomNode[];
  let indiNodes: GedcomNode[], famNodes: GedcomNode[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TreeStore,
        EditService,
        ExportService,
        { provide: PersistenceService, useValue: mockPersistence() },
      ],
    });
    store = TestBed.inject(TreeStore);
    edit = TestBed.inject(EditService);
    exporter = TestBed.inject(ExportService);
    store.setTreeId('t');

    const dad = edit.createIndividual({ given: 'Dad', surname: 'L', sex: 'M' });
    const mom = edit.createIndividual({ given: 'Mom', surname: 'L', sex: 'F' });
    const kid = edit.createIndividual({ given: 'Kid', surname: 'L', sex: 'M' });
    edit.linkSpouses(dad, mom);
    edit.addParentChild(dad, kid); // attaches kid to the existing dad+mom union

    const find = (id: string) => store.individuals().find((i) => i.id === id)!;
    dadX = find(dad).sourceXref!;
    momX = find(mom).sourceXref!;
    kidX = find(kid).sourceXref!;
    unionX = store.unions()[0].sourceXref!;

    ast = (exporter as unknown as { buildExportAst(a?: GedcomNode[]): GedcomNode[] }).buildExportAst(undefined);
    indiNodes = ast.filter((n) => n.tag === 'INDI');
    famNodes = ast.filter((n) => n.tag === 'FAM');
  });

  it('wraps records with HEAD first and TRLR last', () => {
    expect(ast[0].tag).toBe('HEAD');
    expect(ast[ast.length - 1].tag).toBe('TRLR');
  });

  it('regenerates FAMS on spouses and FAMC on the child', () => {
    const dadNode = indiNodes.find((n) => n.xref === dadX)!;
    const momNode = indiNodes.find((n) => n.xref === momX)!;
    const kidNode = indiNodes.find((n) => n.xref === kidX)!;
    expect(childrenWith(dadNode, 'FAMS')).toContain(unionX);
    expect(childrenWith(momNode, 'FAMS')).toContain(unionX);
    expect(childrenWith(kidNode, 'FAMC')).toContain(unionX);
  });

  it('regenerates HUSB/WIFE by sex and CHIL on the family', () => {
    const fam = famNodes.find((n) => n.xref === unionX)!;
    expect(childrenWith(fam, 'HUSB')).toContain(dadX); // M
    expect(childrenWith(fam, 'WIFE')).toContain(momX); // F
    expect(childrenWith(fam, 'CHIL')).toContain(kidX);
  });

  it('every FAMS/FAMC pointer resolves to an exported FAM xref', () => {
    const famXrefs = new Set(famNodes.map((n) => n.xref));
    for (const indi of indiNodes) {
      for (const link of indi.children.filter((c) => c.tag === 'FAMS' || c.tag === 'FAMC')) {
        expect(famXrefs.has(link.pointer)).toBe(true);
      }
    }
  });

  it('strips stale FAMS/FAMC from the raw record before regenerating', () => {
    const dadIndi = store.individuals().find((i) => i.sourceXref === dadX)!;
    dadIndi.rawRef!.children.push({
      level: 1, tag: 'FAMS', pointer: '@FOLD@', value: undefined, xref: undefined, children: [],
    });
    const ast2 = (exporter as unknown as { buildExportAst(a?: GedcomNode[]): GedcomNode[] }).buildExportAst(undefined);
    const dadNode = ast2.filter((n) => n.tag === 'INDI').find((n) => n.xref === dadX)!;
    const fams = childrenWith(dadNode, 'FAMS');
    expect(fams).toContain(unionX);
    expect(fams).not.toContain('@FOLD@');
  });
});
