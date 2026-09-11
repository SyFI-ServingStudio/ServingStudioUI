import { describe, expect, it } from 'vitest';

import { canHighlight, highlightLines, splitHighlightedLines } from './highlight';

describe('splitHighlightedLines', () => {
  it('preserves nesting across a line break', () => {
    expect(splitHighlightedLines('<span class="a"><span class="b">x\ny</span>z</span>')).toEqual([
      '<span class="a"><span class="b">x</span></span>',
      '<span class="a"><span class="b">y</span>z</span>',
    ]);
  });

  it('keeps a span that closes on its own line balanced', () => {
    expect(splitHighlightedLines('a<span class="s">b</span>\nc')).toEqual([
      'a<span class="s">b</span>',
      'c',
    ]);
  });

  it('emits a final empty line for a trailing newline', () => {
    expect(splitHighlightedLines('alpha\n')).toEqual(['alpha', '']);
  });
});

describe('highlightLines', () => {
  it('declines a language it has no grammar for', async () => {
    expect(canHighlight('brainfuck')).toBe(false);
    expect(await highlightLines('x = 1', 'brainfuck')).toBeNull();
    expect(await highlightLines('x = 1', null)).toBeNull();
  });

  it('declines a file too large to be worth tokenizing', async () => {
    const huge = Array.from({ length: 8_001 }, (_, index) => `let x${index} = 1;`).join('\n');
    expect(await highlightLines(huge, 'rust')).toBeNull();
  });

  it('loads a grammar on demand and returns one fragment per line', async () => {
    const lines = await highlightLines('fn main() {\n    let total = 1;\n}\n', 'rust');

    expect(lines).not.toBeNull();
    expect(lines).toHaveLength(4);
    expect(lines?.[0]).toContain('hljs-keyword');
    expect(lines?.[1]).toContain('total');
  });
});
