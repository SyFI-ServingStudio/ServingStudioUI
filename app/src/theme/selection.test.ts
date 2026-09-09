import { describe, expect, it, vi } from 'vitest';
import { themes } from './palettes';
import { createDetailColors, readableTerminalColor } from './colors';
import { readThemeId, resolveThemeId } from './selection';

describe('theme selection', () => {
  it('uses valid URL selection, then saved preference, then default', () => {
    expect(resolveThemeId('light', 'vscode')).toBe('light');
    expect(resolveThemeId('unknown', 'light')).toBe('light');
    expect(resolveThemeId(null, 'unknown')).toBe('vscode');
    expect(resolveThemeId('warm', null)).toBe('warm');
    expect(resolveThemeId('intro', 'intro')).toBe('vscode');
    expect(resolveThemeId('__proto__', 'constructor')).toBe('vscode');
  });
  it('still renders when browser storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(readThemeId()).toBe('vscode');
    } finally {
      spy.mockRestore();
    }
  });
  it('propagates theme changes into chart and terminal colors', () => {
    const vscode = createDetailColors(themes.vscode.palette);
    const light = createDetailColors(themes.light.palette);
    expect(vscode.operationPanel).not.toEqual(light.operationPanel);
    expect(vscode.blueWash).not.toBe(light.blueWash);
    expect(vscode.blueBright).not.toBe(light.blueBright);
    for (const theme of Object.values(themes)) {
      const colors = createDetailColors(theme.palette);
      expect(colors.operationPanel.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    }
  });
});

it('keeps near-white and near-black terminal colors legible in their respective modes', () => {
  expect(readableTerminalColor(255, 255, 255, 'light')).toBe('#737373');
  expect(readableTerminalColor(0, 0, 0, 'dark')).toBe('#8c8c8c');
  expect(readableTerminalColor(0, 0, 0, 'light')).toBe('#000000');
  expect(readableTerminalColor(255, 255, 255, 'dark')).toBe('#ffffff');
});
