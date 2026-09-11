/**
 * Find which lines of a previewed file contain a query.
 *
 * Line-level rather than token-level on purpose: the highlighted body is HTML
 * from highlight.js, and injecting match markup into it would mean re-parsing
 * spans that may already wrap part of the match. Marking whole lines and
 * stepping between them answers "where is this in the file", which is what a
 * preview is for.
 */

/** 1-indexed line numbers containing `query`, case-insensitively. */
export function matchingLines(text: string, query: string): readonly number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: number[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.toLowerCase().includes(needle)) matches.push(index + 1);
  });
  return matches;
}

/** Step through matches, wrapping at both ends. Returns the new index. */
export function stepMatch(count: number, current: number, delta: number): number {
  if (count === 0) return 0;
  return (((current + delta) % count) + count) % count;
}
