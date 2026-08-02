import { describe, expect, it } from 'vitest';

import { ansiLines, hasAnsi, stripAnsi } from './ansi';

// Built rather than written literally: a raw ESC byte in source is invisible in
// a diff and easy for tooling to mangle.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** A line of the simulator's real `tracing` output. */
const TRACING_LINE =
  `${ESC}[2m2026-05-23T11:10:54.556547Z${ESC}[0m ${ESC}[32m INFO${ESC}[0m ` +
  `[build]   kernel unified.embedding (elementwise) backend=triton done`;

describe('hasAnsi', () => {
  it('sees a colour sequence', () => {
    expect(hasAnsi(TRACING_LINE)).toBe(true);
  });

  it('leaves ordinary log text alone', () => {
    expect(hasAnsi('2026-05-23 INFO [build] kernel done (63 samples)')).toBe(false);
  });

  it('does not fire on a bracket that is not an escape', () => {
    expect(hasAnsi('array[0] = kv[32m]')).toBe(false);
  });
});

describe('stripAnsi', () => {
  it('leaves only the visible text', () => {
    expect(stripAnsi(TRACING_LINE)).toBe(
      '2026-05-23T11:10:54.556547Z  INFO [build]   kernel unified.embedding (elementwise) backend=triton done',
    );
  });

  it('drops sequences that are not colour, such as a cursor move', () => {
    expect(stripAnsi(`before${ESC}[2K${ESC}[1Aafter`)).toBe('beforeafter');
  });

  it('drops an OSC title sequence with either terminator', () => {
    expect(stripAnsi(`${ESC}]0;a title${BEL}run`)).toBe('run');
    expect(stripAnsi(`${ESC}]0;a title${ESC}\\run`)).toBe('run');
  });

  it('preserves line structure exactly', () => {
    const text = `${ESC}[32mone${ESC}[0m\ntwo\n\nthree\n`;
    expect(stripAnsi(text)).toBe('one\ntwo\n\nthree\n');
  });
});

describe('ansiLines', () => {
  it('colours the level and fades the timestamp', () => {
    const [line] = ansiLines(TRACING_LINE);
    expect(line).toContain('opacity:.62');
    expect(line).toContain('2026-05-23T11:10:54.556547Z');
    // 32 is green, which resolves to the palette's olive rather than #00ff00.
    expect(line).toContain('color:#566a2e');
    expect(line).toContain('INFO');
    // Text after the reset carries no styling at all.
    expect(line?.endsWith('backend=triton done')).toBe(true);
  });

  it('keeps one entry per line, matching the stripped text', () => {
    const text = `${ESC}[32mone${ESC}[0m\ntwo\n\nthree\n`;
    expect(ansiLines(text)).toHaveLength(stripAnsi(text).split('\n').length);
  });

  it('carries style across a line break but closes the markup on each line', () => {
    const lines = ansiLines(`${ESC}[31mfirst\nsecond\nthird${ESC}[0m`);
    expect(lines).toHaveLength(3);
    lines.forEach((line) => {
      expect(line).toContain('color:#a84b2e');
      // Balanced on its own: as many closes as opens.
      expect(line.match(/<span/g)?.length).toBe(line.match(/<\/span>/g)?.length);
    });
  });

  it('escapes markup in the file so a log cannot inject HTML', () => {
    const [line] = ansiLines(`${ESC}[32m<script>alert(1)</script>${ESC}[0m & <b>`);
    expect(line).not.toContain('<script>');
    expect(line).toContain('&lt;script&gt;');
    expect(line).toContain('&amp;');
    expect(line).toContain('&lt;b&gt;');
  });

  it('emits no span for unstyled text', () => {
    expect(ansiLines('plain line')).toEqual(['plain line']);
  });

  it('treats an empty parameter list as a full reset', () => {
    const [line] = ansiLines(`${ESC}[1mbold${ESC}[mafter`);
    expect(line).toContain('font-weight:700');
    expect(line?.endsWith('after')).toBe(true);
  });

  it('clears bold and dim together on 22, leaving colour intact', () => {
    const [line] = ansiLines(`${ESC}[1;2;32mloud${ESC}[22mquiet`);
    expect(line).toContain('font-weight:700');
    expect(line).toContain('opacity:.62');
    expect(line).toContain('<span style="color:#566a2e">quiet</span>');
  });

  it('reads 256-colour and truecolour, darkening what a light page cannot show', () => {
    const [indexed] = ansiLines(`${ESC}[38;5;226mbright yellow`);
    const [truecolor] = ansiLines(`${ESC}[38;2;255;255;0mbright yellow`);
    // Both are near-white in luminance terms and must come back darkened.
    [indexed, truecolor].forEach((line) => {
      const hex = /color:#([0-9a-f]{6})/.exec(line ?? '')?.[1];
      expect(hex).toBeDefined();
      const [red, green, blue] = [0, 2, 4].map((at) =>
        Number.parseInt((hex ?? '').slice(at, at + 2), 16),
      );
      const luminance = (0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0)) / 255;
      expect(luminance).toBeLessThanOrEqual(0.56);
    });
  });

  it('swaps foreground and background on inverse', () => {
    const [line] = ansiLines(`${ESC}[32;7mflipped`);
    expect(line).toContain('background:#566a2e');
  });

  it('ignores a sequence it does not render instead of printing it', () => {
    const [line] = ansiLines(`${ESC}[2Kprogress`);
    expect(line).toBe('progress');
  });
});
