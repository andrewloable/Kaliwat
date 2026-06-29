import { GedcomNode, Individual, Union, MediaObject, PersonName, GedcomEvent, ChildLink, TreeModel, TreeMeta, UUID } from '../../core/model/types';
import { PointerTable } from '../../core/model/pointer-table';

export interface NormalizeReport {
  orphanPointers: string[];
  warnings: string[];
}

export interface NormalizeResult {
  model: TreeModel;
  pointerTable: PointerTable;
  report: NormalizeReport;
}

function findChildren(root: GedcomNode[], tag: string): GedcomNode[] {
  return root.filter((n) => n.tag === tag);
}

function childValue(node: GedcomNode, tag: string): string | undefined {
  return node.children.find((c) => c.tag === tag)?.value;
}

function childNodes(node: GedcomNode, tag: string): GedcomNode[] {
  return node.children.filter((c) => c.tag === tag);
}

function parseEvent(node: GedcomNode): GedcomEvent {
  const dateNode = node.children.find((c) => c.tag === 'DATE');
  // v7: DATE value may be empty; fall back to PHRASE subdirectory (human-readable text)
  const date = dateNode?.value || dateNode?.children.find((c) => c.tag === 'PHRASE')?.value;
  return {
    type: node.tag,
    date,
    place: childValue(node, 'PLAC'),
    citations: childNodes(node, 'SOUR').map((s) => s.pointer ?? s.value ?? ''),
    notes: childNodes(node, 'NOTE').map((n) => n.value ?? ''),
    raw: node,
  };
}

const EVENT_TAGS = new Set(['BIRT', 'DEAT', 'BURI', 'BAPM', 'CHR', 'CHRA', 'CONF', 'FCOM', 'ORDN', 'NATU', 'EMIG', 'IMMI', 'CENS', 'PROB', 'WILL', 'GRAD', 'RETI', 'EVEN', 'ADOP']);

function parseName(node: GedcomNode): PersonName {
  const raw = node.value ?? '';
  const match = raw.match(/^([^/]*)\/?([^/]*)\/?(.*)$/);
  return {
    full: raw.replace(/\//g, '').trim(),
    given: match?.[1]?.trim() || childValue(node, 'GIVN'),
    surname: match?.[2]?.trim() || childValue(node, 'SURN'),
    prefix: childValue(node, 'NPFX'),
    suffix: childValue(node, 'NSFX'),
    type: childValue(node, 'TYPE'),
  };
}

function crypto_uuid(): UUID {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // ponytail: simple fallback for Node test env without WebCrypto
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function normalizeAst(ast: GedcomNode[]): NormalizeResult {
  const pt = new PointerTable();
  const report: NormalizeReport = { orphanPointers: [], warnings: [] };

  const indiNodes = findChildren(ast, 'INDI');
  const famNodes = findChildren(ast, 'FAM');
  const objeNodes = findChildren(ast, 'OBJE');
  const snoteNodes = findChildren(ast, 'SNOTE'); // v7 shared notes

  // First pass: allocate UUIDs for all records (including v7 SNOTE)
  for (const node of [...indiNodes, ...famNodes, ...objeNodes, ...snoteNodes]) {
    if (node.xref) {
      const id = crypto_uuid();
      pt.register(node.xref, id);
    }
  }

  // v7 SNOTE text lookup (xref → text value)
  const snoteText = new Map<string, string>();
  for (const node of snoteNodes) {
    if (node.xref) snoteText.set(node.xref, node.value ?? '');
  }

  // Resolve a pointer, reporting orphans
  const resolve = (xref: string | undefined): UUID | undefined => {
    if (!xref) return undefined;
    if (xref === '@VOID@') return undefined; // v7 explicitly-void pointer — not an orphan
    const id = pt.getUuid(xref);
    if (!id) {
      if (!report.orphanPointers.includes(xref)) {
        report.orphanPointers.push(xref);
      }
    }
    return id;
  };

  // Build MediaObjects from top-level OBJE records up front; inline OBJE
  // (no xref, FILE as a child — MyHeritage's form) are synthesized on demand.
  const media = new Map<UUID, MediaObject>();
  for (const node of objeNodes) {
    if (!node.xref) continue;
    const id = pt.getUuid(node.xref)!;
    media.set(id, {
      id, sourceXref: node.xref,
      form: childValue(node, 'FORM'),
      title: childValue(node, 'TITL'),
      file: childValue(node, 'FILE'),
      links: [], rawRef: node,
    });
  }

  // Resolve a record's child OBJE to a media id — pointer reference OR an
  // inline OBJE block (synthesize a MediaObject so the photo is linked).
  const objeId = (o: GedcomNode): UUID | undefined => {
    if (o.pointer) return resolve(o.pointer);
    const file = childValue(o, 'FILE') ?? o.value;
    if (!file) return undefined;
    const id = crypto_uuid();
    media.set(id, {
      id,
      form: childValue(o, 'FORM'),
      title: childValue(o, 'TITL'),
      file,
      links: [], rawRef: o,
    });
    return id;
  };

  // Build Individuals
  const individuals = new Map<UUID, Individual>();
  for (const node of indiNodes) {
    if (!node.xref) continue;
    const id = pt.getUuid(node.xref)!;
    const names = childNodes(node, 'NAME').map(parseName);
    if (names.length === 0) names.push({ full: '' });
    const sex = childValue(node, 'SEX') ?? 'U';
    const events = node.children.filter((c) => EVENT_TAGS.has(c.tag)).map(parseEvent);
    const mediaIds = childNodes(node, 'OBJE')
      .map(objeId)
      .filter((id): id is UUID => id !== undefined);
    const notes = childNodes(node, 'NOTE').map((n) =>
      n.value ?? (n.pointer ? (snoteText.get(n.pointer) ?? '') : ''),
    );

    // Validate FAMS/FAMC pointers for orphan detection
    for (const tag of ['FAMS', 'FAMC']) {
      for (const c of childNodes(node, tag)) {
        resolve(c.pointer);
      }
    }

    // unions will be linked during FAM pass
    individuals.set(id, { id, sourceXref: node.xref, names, sex, events, unions: [], mediaIds, notes, rawRef: node });
  }

  // Build Unions from FAM records
  const unions = new Map<UUID, Union>();
  for (const node of famNodes) {
    if (!node.xref) continue;
    const id = pt.getUuid(node.xref)!;

    const spouseIds: UUID[] = [];
    for (const tag of ['HUSB', 'WIFE']) {
      const ref = childNodes(node, tag)[0]?.pointer;
      const spouseId = resolve(ref);
      if (spouseId) spouseIds.push(spouseId);
    }

    const childLinks: ChildLink[] = childNodes(node, 'CHIL')
      .map((c) => {
        const childId = resolve(c.pointer);
        if (!childId) return null;
        return { childId, pedi: undefined, status: undefined, citations: [], notes: [] } as ChildLink;
      })
      .filter((c): c is ChildLink => c !== null);

    const events = node.children.filter((c) => c.tag === 'MARR' || c.tag === 'DIV' || EVENT_TAGS.has(c.tag)).map(parseEvent);

    const union: Union = { id, sourceXref: node.xref, spouseIds, events, childLinks, rawRef: node };
    unions.set(id, union);

    // Link spouses → this union
    for (const spouseId of spouseIds) {
      const indi = individuals.get(spouseId);
      if (indi && !indi.unions.some((u) => u.unionId === id)) {
        indi.unions.push({ unionId: id });
      }
    }

    // Update PEDI/STAT from FAMC in INDI records
    for (const childLink of childLinks) {
      const indi = individuals.get(childLink.childId);
      if (!indi) continue;
      const famcNode = indi.rawRef?.children.find(
        (c) => c.tag === 'FAMC' && c.pointer === node.xref,
      );
      if (famcNode) {
        childLink.pedi = childValue(famcNode, 'PEDI');
        childLink.status = childValue(famcNode, 'STAT');
        childLink.citations = childNodes(famcNode, 'SOUR').map((s) => s.pointer ?? s.value ?? '');
        childLink.notes = childNodes(famcNode, 'NOTE').map((n) => n.value ?? '');
      }
    }
  }

  const headNode = ast.find((n) => n.tag === 'HEAD');
  const meta: TreeMeta = {
    gedcomVersion: headNode?.children.find((c) => c.tag === 'GEDC')?.children.find((c) => c.tag === 'VERS')?.value,
    charset: headNode?.children.find((c) => c.tag === 'CHAR')?.value,
    submitterName: undefined,
    source: headNode?.children.find((c) => c.tag === 'SOUR')?.value,
  };

  const model: TreeModel = {
    id: crypto_uuid(),
    meta,
    individuals,
    unions,
    media,
    documentAst: ast,
  };

  return { model, pointerTable: pt, report };
}
