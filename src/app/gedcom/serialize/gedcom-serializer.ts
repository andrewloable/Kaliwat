import { GedcomNode, Individual, TreeModel } from '../../core/model/types';

function serializeNode(node: GedcomNode): string {
  const xref = node.xref ? `${node.xref} ` : '';
  const ptr = node.pointer ? ` ${node.pointer}` : '';
  const val = node.value !== undefined && node.value !== '' ? ` ${node.value}` : '';
  return `${node.level} ${xref}${node.tag}${ptr}${val}\n` +
    node.children.map(serializeNode).join('');
}

/**
 * Serializes the full TreeModel to GEDCOM 5.5.1 text.
 * Uses documentAst as the source of truth — edits applied to rawRef nodes
 * are automatically reflected since rawRef is a reference into documentAst.
 */
export function serializeModel(model: TreeModel): string {
  return model.documentAst.map(serializeNode).join('');
}

// ── Test-only mutation helpers ────────────────────────────────────────────────
// These let specs exercise the merge path without a full editing UI.

/** Edits the first NAME value in an individual's rawRef and syncs the model. */
export function mutateGivenName(individual: Individual, newGiven: string): void {
  const rawRef = individual.rawRef;
  if (!rawRef) return;
  const nameNode = rawRef.children.find(c => c.tag === 'NAME');
  if (nameNode) {
    const surname = individual.names[0]?.surname ?? '';
    nameNode.value = surname ? `${newGiven} /${surname}/` : newGiven;
    const givnNode = nameNode.children.find(c => c.tag === 'GIVN');
    if (givnNode) givnNode.value = newGiven;
  } else {
    rawRef.children.unshift({ level: 1, tag: 'NAME', value: newGiven, children: [] });
  }
  if (individual.names[0]) {
    individual.names[0] = {
      ...individual.names[0],
      given: newGiven,
      full: nameNode?.value?.replace(/\//g, '').trim() ?? newGiven,
    };
  }
}

/** Edits a BIRT date in an individual's rawRef and syncs the model event. */
export function mutateBirthDate(individual: Individual, newDate: string): void {
  const rawRef = individual.rawRef;
  if (!rawRef) return;
  let birtNode = rawRef.children.find(c => c.tag === 'BIRT');
  if (!birtNode) {
    birtNode = { level: 1, tag: 'BIRT', children: [] };
    rawRef.children.push(birtNode);
  }
  const dateNode = birtNode.children.find(c => c.tag === 'DATE');
  if (dateNode) {
    dateNode.value = newDate;
  } else {
    birtNode.children.unshift({ level: 2, tag: 'DATE', value: newDate, children: [] });
  }
  const event = individual.events.find(e => e.type === 'BIRT');
  if (event) event.date = newDate;
}
