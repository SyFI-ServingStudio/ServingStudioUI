// The VS Code-inspired palette is sampled, not an export of the user's theme.
const vscode = {
  blue: '#8db9e2',
  green: '#73c991',
  amber: '#e2c08d',
  red: '#f88070',
  text: '#cccccc',
  muted: '#8c8c8c',
  background: '#1e1e1e',
  // Background layers sampled from the editor, sidebar, activity bar and selected row.
  surface: '#252526',
  elevated: '#333333',
  leaf: '#2a2d2e',
  selected: '#37373d',
  secondaryText: '#a0a0a0',
  border: '#3c3c3c',
  violet: '#b4a0c5',
};

export type ThemePalette = { [Key in keyof typeof vscode]: string };
export interface SyntaxPalette {
  comment: string;
  keyword: string;
  string: string;
  number: string;
  title: string;
  type: string;
  variable: string;
}
export interface ThemeDefinition {
  label: string;
  mode: 'dark' | 'light';
  palette: ThemePalette;
  syntax?: SyntaxPalette;
}

// Light colors are mapped from Microsoft's light_vs.json / light_plus.json
// and the light workbench defaults. See docs/themes.md for source attribution.
export const themes: Record<'vscode' | 'light' | 'warm', ThemeDefinition> = {
  vscode: { label: 'VS Code Dark', mode: 'dark', palette: vscode },
  light: {
    label: 'VS Code Light',
    mode: 'light',
    palette: {
      blue: '#0451a5',
      green: '#098658',
      amber: '#795e26',
      red: '#a31515',
      text: '#333333',
      muted: '#767676',
      background: '#ffffff',
      surface: '#fafafa',
      elevated: '#f3f3f3',
      leaf: '#ffffff',
      selected: '#e4e6f1',
      secondaryText: '#6f6f6f',
      border: '#d4d4d4',
      violet: '#af00db',
    },
    syntax: {
      comment: '#008000',
      keyword: '#0000ff',
      string: '#a31515',
      number: '#098658',
      title: '#795e26',
      type: '#267f99',
      variable: '#001080',
    },
  },
  warm: {
    label: 'Warm Paper',
    mode: 'light',
    // Restored from viz-ui 0c8283b, retaining the current typography and layout.
    palette: {
      blue: '#1f6f6b',
      green: '#566a2e',
      amber: '#806600',
      red: '#a84b2e',
      text: '#2a2622',
      muted: '#736a5e',
      background: '#f4efe4',
      surface: '#faf7f0',
      elevated: '#f7f2e7',
      leaf: '#fffdf8',
      selected: '#e3dccb',
      secondaryText: '#685f54',
      border: '#e3dccb',
      violet: '#6548dc',
    },
  },
};

export type ThemeId = keyof typeof themes;
export const DEFAULT_THEME: ThemeId = 'vscode';
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(themes, value);
}
