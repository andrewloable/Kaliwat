import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ExportService } from './export.service';
import { EditService } from '../core/edit/edit.service';
import { PersistenceService } from '../core/db/persistence.service';
import { TreeStore } from '../core/tree-store/tree.store';
import { db } from '../core/db/kaliwat-db';
import { parseGedcomBytes } from '../gedcom/parser/gedcom-parser';
import { normalizeAst } from '../gedcom/normalize/normalizer';
import type { GedcomNode, Individual, Union } from '../core/model/types';

const TREE_ID = 'export-roundtrip';

// A small family: Rosa (with a _UID and a custom tag), her husband Pedro, and their child Juan.
const FILE = [
  '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
  '0 @I1@ INDI', '1 _UID AAA-111', '1 NAME Rosa /Cruz/', '2 GIVN Rosa', '2 SURN Cruz', '1 SEX F', '1 _XYZ keep-me',
  '1 BIRT', '2 DATE 1930', '1 FAMS @F1@',
  '0 @I2@ INDI', '1 NAME Pedro /Cruz/', '1 SEX M', '1 FAMS @F1@',
  '0 @I3@ INDI', '1 NAME Juan /Cruz/', '1 SEX M', '1 FAMC @F1@',
  '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@', '1 CHIL @I3@',
  '0 TRLR',
].join('\n');

function load(text: string) {
  const parsed = parseGedcomBytes(new TextEncoder().encode(text));
  if (parsed.aborted) throw new Error('parse failed');
  return { ast: parsed.ast as GedcomNode[], model: normalizeAst(parsed.ast).model };
}

// jsdom's Blob has no text().
const readText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });

describe('export round trip', () => {
  let store: TreeStore;
  let edit: EditService;
  let exporter: ExportService;

  // Loads FILE the way the import does: the people and families go to the store, the parsed records to rawAst.
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PersistenceService, useValue: { scheduleWrite: vi.fn(), estimateQuota: vi.fn(async () => null) } }],
    });
    store = TestBed.inject(TreeStore);
    edit = TestBed.inject(EditService);
    exporter = TestBed.inject(ExportService);
    const { ast, model } = load(FILE);
    store.setTreeId(TREE_ID);
    store.setIndividuals([...model.individuals.values()] as Individual[]);
    store.setUnions([...model.unions.values()] as Union[]);
    await db.rawAst.put({ treeId: TREE_ID, id: 'root', nodes: ast });
  });

  afterEach(async () => {
    await db.rawAst.delete([TREE_ID, 'root']);
    TestBed.resetTestingModule();
  });

  it('buildFile returns a .ged without downloading when there are no photos', async () => {
    const download = vi.spyOn(exporter as unknown as { download(): void }, 'download').mockImplementation(() => undefined);

    const built = await exporter.buildFile();

    expect(built?.format).toBe('ged');
    expect(built?.name).toBe('family-tree.ged');
    expect(download).not.toHaveBeenCalled();
  });

  it('import, edit, export, re-import keeps the edits, the other records and the custom tags', async () => {
    const juan = store.individuals().find((i) => i.names[0].given === 'Juan')!;
    edit.updateIndividual(juan.id, { given: 'Juan Carlos', surname: 'Cruz', sex: 'M' });
    const lina = edit.createIndividual({ given: 'Lina', surname: 'Cruz', sex: 'F' });
    const pedro = store.individuals().find((i) => i.names[0].given === 'Pedro')!;
    expect(edit.linkSpouses(pedro.id, lina)).toBeNull();

    const built = await exporter.buildFile();
    const text = await readText(built!.blob);
    const back = load(text).model;

    const people = [...back.individuals.values()];
    expect(people.map((i) => i.names[0].full).sort()).toEqual(['Juan Carlos Cruz', 'Lina Cruz', 'Pedro Cruz', 'Rosa Cruz']);
    // Rosa's _UID and her custom tag are still in the file, untouched.
    expect(text).toContain('1 _UID AAA-111');
    expect(text).toContain('1 _XYZ keep-me');
    // Every person appears once.
    expect(text.match(/^0 @[^@]+@ INDI$/gm)).toHaveLength(4);
    // Two families with two spouses each (Rosa+Pedro, Pedro+Lina), and Juan Carlos is a child of exactly one.
    const families = [...back.unions.values()];
    expect(families.filter((u) => u.spouseIds.length === 2)).toHaveLength(2);
    const juanId = people.find((i) => i.names[0].given === 'Juan Carlos')!.id;
    expect(families.filter((u) => u.childLinks.some((c) => c.childId === juanId))).toHaveLength(1);
  });

  it('export still downloads the built file and returns its format', async () => {
    const download = vi.spyOn(exporter as unknown as { download(blob: Blob, name: string): void }, 'download').mockImplementation(() => undefined);

    const format = await exporter.export();

    expect(format).toBe('ged');
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][1]).toBe('family-tree.ged');
  });
});
