import { readGedcom } from 'read-gedcom';
import { GedcomNode } from '../../core/model/types';

export const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_RECORDS = 500_000;

export interface ParseWarning {
  line?: number;
  message: string;
}

export interface ParseResult {
  ast: GedcomNode[];
  report: ParseWarning[];
  aborted?: boolean;
}

// Convert read-gedcom tree node to our GedcomNode shape
function convertNode(node: any, level: number): GedcomNode {
  const rawValue = node.value as string | null;
  const isPointerRef = !!rawValue && /^@[^@]+@$/.test(rawValue);
  return {
    level,
    tag: node.tag as string,
    xref: (node.pointer as string) || undefined,
    pointer: isPointerRef ? rawValue! : undefined,
    value: !isPointerRef && rawValue ? rawValue : undefined,
    children: ((node.children as any[]) ?? []).map((c) => convertNode(c, level + 1)),
  };
}

// Fallback line-by-line parser that tolerates malformed lines
const LINE_RE = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\w+)(?:\s+(.+))?$/;

function parseByLine(text: string): { nodes: GedcomNode[]; warnings: ParseWarning[] } {
  const lines = text.split(/\r?\n/);
  const warnings: ParseWarning[] = [];
  const stack: GedcomNode[] = [];
  const roots: GedcomNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) {
      warnings.push({
        line: i + 1,
        message: `Malformed line: "${line.length > 60 ? line.slice(0, 60) + '…' : line}"`,
      });
      continue;
    }
    const level = parseInt(m[1], 10);
    const tag = m[3];
    const rawValue = m[4]?.trim();

    // CONT/CONC fold into parent value (v7 uses CONT only; 5.5.1 used both)
    if ((tag === 'CONT' || tag === 'CONC') && stack.length > 0) {
      const parent = stack[stack.length - 1];
      if (tag === 'CONT') {
        parent.value = (parent.value ? parent.value + '\n' : '') + (rawValue ?? '');
      } else {
        parent.value = (parent.value ?? '') + (rawValue ?? '');
      }
      continue;
    }

    const isPointerRef = !!rawValue && /^@[^@]+@$/.test(rawValue);
    const node: GedcomNode = {
      level,
      tag,
      xref: m[2] || undefined,
      pointer: isPointerRef ? rawValue : undefined,
      value: !isPointerRef ? rawValue : undefined,
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return { nodes: roots, warnings };
}

export function parseGedcomBytes(bytes: Uint8Array): ParseResult {
  if (bytes.length > MAX_BYTES) {
    return {
      ast: [],
      report: [{ message: `File exceeds maximum size of ${MAX_BYTES / 1024 / 1024} MB` }],
      aborted: true,
    };
  }

  // Happy path: read-gedcom handles encodings (UTF-8, ANSEL)
  try {
    // ponytail: read-gedcom types say ArrayBuffer but accepts Uint8Array at runtime
    const root = readGedcom(bytes as unknown as ArrayBuffer);
    const topNodes: any[] = root[0]?.children ?? [];
    if (topNodes.length > MAX_RECORDS) {
      return {
        ast: [],
        report: [{ message: `File exceeds maximum record count of ${MAX_RECORDS}` }],
        aborted: true,
      };
    }
    return { ast: topNodes.map((n) => convertNode(n, 0)), report: [] };
  } catch {
    // Best-effort fallback: parse line by line, skip malformed lines
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const { nodes, warnings } = parseByLine(text);
    return { ast: nodes, report: warnings };
  }
}
