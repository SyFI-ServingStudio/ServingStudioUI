import { describe, expect, it } from 'vitest';

import { delimiterFor, parseDelimitedText } from './delimitedText';

describe('delimiterFor', () => {
  it('reads a tsv with tabs and everything else with commas', () => {
    expect(delimiterFor('logs/run.tsv')).toBe('\t');
    expect(delimiterFor('logs/run.csv')).toBe(',');
  });
});

describe('parseDelimitedText', () => {
  it('separates the header from the rows', () => {
    const table = parseDelimitedText('a,b\n1,2\n3,4\n', ',', 100);

    expect(table?.header).toEqual(['a', 'b']);
    expect(table?.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(table?.totalRows).toBe(2);
  });

  it('keeps a quoted delimiter inside its own field', () => {
    const table = parseDelimitedText('name,note\nrun,"tp=2, ep=8"\n', ',', 100);

    expect(table?.rows).toEqual([['run', 'tp=2, ep=8']]);
  });

  it('keeps a quoted newline inside its own field', () => {
    const table = parseDelimitedText('name,note\nrun,"line one\nline two"\n', ',', 100);

    expect(table?.rows).toEqual([['run', 'line one\nline two']]);
  });

  it('unescapes a doubled quote', () => {
    const table = parseDelimitedText('a\n"say ""hi"""\n', ',', 100);

    expect(table?.rows).toEqual([['say "hi"']]);
  });

  it('handles CRLF line endings', () => {
    const table = parseDelimitedText('a,b\r\n1,2\r\n', ',', 100);

    expect(table?.rows).toEqual([['1', '2']]);
  });

  it('reports the full row count even when truncated', () => {
    const text = 'a\n' + Array.from({ length: 10 }, (_, index) => index).join('\n') + '\n';

    const table = parseDelimitedText(text, ',', 3);

    expect(table?.rows).toHaveLength(3);
    expect(table?.totalRows).toBe(10);
  });

  it('returns null for an empty file', () => {
    expect(parseDelimitedText('', ',', 100)).toBeNull();
  });
});
