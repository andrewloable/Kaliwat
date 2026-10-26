import { GedcomNode, TreeModel } from '../model/types';
import { ParseResult } from '../../gedcom/parser/gedcom-parser';
import { normalizeAst } from '../../gedcom/normalize/normalizer';
import { importGedzip } from '../../gedcom/gedzip/gedzip';

export interface TreeFile {
  ast: GedcomNode[];
  model: TreeModel;
  warnings: string[];
  skipped: number;
  mediaBlobs: { id: string; path: string; blob: Blob; thumb: Blob | null }[];
}

export type ReadError = { error: string; aborted?: boolean };

/**
 * Reads a picked .ged or .gdz: unpacks the archive, parses and normalizes the GEDCOM, and pairs each photo in the
 * archive with its media record by FILE path (a photo that matches none keeps a `media-<i>` id). Writes nothing.
 * Shared by Import and Merge; `parse` is the worker parser in the app and a direct parse in tests.
 */
export async function readTreeFile(
  file: File,
  parse: (f: File) => Promise<ParseResult>,
  onPhotos?: (done: number, total: number) => void,
): Promise<TreeFile | ReadError> {
  let gedcomFile: File;
  let mediaBlobs: TreeFile['mediaBlobs'] = [];

  // Unpack .gdz archives first
  if (file.name.toLowerCase().endsWith('.gdz')) {
    const result = await importGedzip(file, onPhotos);
    if ('error' in result) return { error: result.error };
    gedcomFile = new File([result.gedcomBytes], 'gedcom.ged', { type: 'text/plain' });
    // Pair media entries with placeholder IDs (real IDs assigned after normalize)
    mediaBlobs = result.media.map((m, i) => ({
      path: m.path, id: `media-${i}`, blob: m.blob, thumb: m.thumb,
    }));
  } else {
    gedcomFile = file;
  }

  const parseResult = await parse(gedcomFile);
  if (parseResult.aborted) {
    return { error: parseResult.report[0]?.message ?? 'File too large or parse aborted', aborted: true };
  }

  const { model, report } = normalizeAst(parseResult.ast);
  const mediaObjects = [...model.media.values()];

  // Match extracted blobs to MediaObject IDs by FILE path
  for (const m of mediaBlobs) {
    const mo = mediaObjects.find(o => o.file === m.path || o.file?.endsWith(m.path) || m.path.endsWith(o.file ?? ''));
    if (mo) m.id = mo.id;
  }

  return {
    ast: parseResult.ast as GedcomNode[],
    model,
    warnings: [
      ...parseResult.report.map(r => r.message),
      ...report.orphanPointers.map(p => `Orphan pointer: ${p}`),
      ...report.warnings,
    ],
    skipped: parseResult.report.length + report.orphanPointers.length,
    mediaBlobs,
  };
}
