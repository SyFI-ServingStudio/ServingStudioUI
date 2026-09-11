import { describe, expect, it } from 'vitest';
import { activeTheme, tokens } from '../../ui/theme';

import { ansiLines, hasAnsi, stripAnsi } from './ansi';

// Built rather than written literally: a raw ESC byte in source is invisible in
// a diff and easy for tooling to mangle.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe('hasAnsi', () => {
  it('does not fire on a bracket that is not an escape', () => {
    expect(hasAnsi('array[0] = kv[32m]')).toBe(false);
  });
});

describe('stripAnsi', () => {
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
  it('carries style across a line break but closes the markup on each line', () => {
    const lines = ansiLines(`${ESC}[31mfirst\nsecond\nthird${ESC}[0m`);
    expect(lines).toHaveLength(3);
    lines.forEach((line) => {
      expect(line).toContain(`color:${tokens.terra}`);
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

  it('treats an empty parameter list as a full reset', () => {
    const [line] = ansiLines(`${ESC}[1mbold${ESC}[mafter`);
    expect(line).toContain('font-weight:700');
    expect(line?.endsWith('after')).toBe(true);
  });

  it('reads 256-colour and truecolour using the current theme contrast direction', () => {
    const [indexed] = ansiLines(`${ESC}[38;5;226mbright yellow`);
    const [truecolor] = ansiLines(`${ESC}[38;2;255;255;0mbright yellow`);
    // Extended colors remain readable on the selected background.
    [indexed, truecolor].forEach((line) => {
      const hex = /color:#([0-9a-f]{6})/.exec(line ?? '')?.[1];
      expect(hex).toBeDefined();
      const [red, green, blue] = [0, 2, 4].map((at) =>
        Number.parseInt((hex ?? '').slice(at, at + 2), 16),
      );
      const luminance = (0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0)) / 255;
      if (activeTheme.mode === 'light') expect(luminance).toBeLessThanOrEqual(0.46);
      else expect(luminance).toBeGreaterThanOrEqual(0.54);
    });
  });
});
