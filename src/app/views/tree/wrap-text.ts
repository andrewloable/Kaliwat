/**
 * Greedily wrap `text` into at most `maxLines` lines, each fitting `maxWidth`
 * pixels per the supplied `measure` function. The final line gets an ellipsis
 * if content still overflows. SVG <text> has no auto-wrap, so the tree card
 * computes its name lines with this and renders one <tspan> per line.
 */
export function wrapToLines(
  text: string,
  measure: (s: string) => number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const trial = line ? line + ' ' + word : word;

    if (measure(trial) <= maxWidth || !line) {
      line = trial;
      continue;
    }

    // `word` doesn't fit on the current line.
    lines.push(line);
    if (lines.length === maxLines - 1) {
      // Last allowed line: pack the remaining words and truncate to fit.
      const rest = words.slice(i).join(' ');
      lines.push(truncateToWidth(rest, measure, maxWidth));
      return lines;
    }
    line = word;
  }

  lines.push(truncateToWidth(line, measure, maxWidth));
  return lines;
}

/** Longest prefix of `s` that fits `maxWidth` with a trailing ellipsis. */
function truncateToWidth(s: string, measure: (x: string) => number, maxWidth: number): string {
  if (measure(s) <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(s.slice(0, mid) + '…') <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? s.slice(0, lo).trimEnd() + '…' : '…';
}
