import { createTheme } from '@mui/material/styles';

import { themes } from './theme/palettes';
import { readThemeId } from './theme/selection';
import { createDetailColors, withAlpha } from './theme/colors';
export { withAlpha } from './theme/colors';
export { themes } from './theme/palettes';
export { selectTheme } from './theme/selection';

export const activeThemeId = readThemeId();
export const activeTheme = themes[activeThemeId];
export const palette = activeTheme.palette;
const derivedColors = createDetailColors(palette, activeTheme.mode);
export const colors = { ...derivedColors, syntax: activeTheme.syntax ?? derivedColors.syntax };

// Historical token names remain aliases to preserve feature color semantics.
export const tokens = {
  paper: palette.background,
  tile: palette.surface,
  tile2: palette.elevated,
  leafbg: palette.leaf,
  chrome: palette.elevated,
  selected: palette.selected,
  ink: palette.text,
  sub: palette.secondaryText,
  sub2: palette.muted,
  hair: palette.border,
  teal: palette.blue,
  terra: palette.red,
  gold: palette.amber,
  olive: palette.green,
  violet: palette.violet,
  sectionStructure: palette.green,
  sectionAnalysis: palette.blue,
  operationColorPanel: colors.operationPanel,
  shadow: 'none',
  shadowLift: colors.shadowLift,
  serif: "'Geist', Arial, sans-serif",
  body: "'Geist', Arial, sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', Consolas, monospace",
  ease: 'cubic-bezier(.22,.61,.36,1)',
};

export const theme = createTheme({
  palette: {
    mode: activeTheme.mode,
    primary: { main: tokens.teal, contrastText: tokens.paper },
    secondary: { main: tokens.terra },
    background: { default: tokens.paper, paper: tokens.tile },
    text: { primary: tokens.ink, secondary: tokens.sub },
    divider: tokens.hair,
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: tokens.body,
    button: { textTransform: 'none', fontWeight: 500 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '@font-face': [
          {
            fontFamily: 'Geist',
            src: "url('./fonts/geist-regular.woff2') format('woff2')",
            fontWeight: 400,
            fontDisplay: 'swap',
          },
          {
            fontFamily: 'Geist',
            src: "url('./fonts/geist-medium.woff2') format('woff2')",
            fontWeight: '500 700',
            fontDisplay: 'swap',
          },
        ],
        body: {
          backgroundColor: tokens.paper,
          fontVariantNumeric: 'tabular-nums',
          colorScheme: activeTheme.mode,
        },
        '::selection': { background: withAlpha(tokens.teal, 0.25) },
        '*': { scrollbarWidth: 'thin', scrollbarColor: `${tokens.hair} transparent` },
        'button:focus-visible, a:focus-visible': {
          outline: `2px solid ${tokens.teal}`,
          outlineOffset: 3,
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: tokens.tile,
          border: `1px solid ${tokens.hair}`,
          backgroundImage: 'none',
          boxShadow: 'none',
        },
      },
    },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: colors.tooltipBackground,
          color: tokens.ink,
          fontFamily: tokens.body,
          fontSize: 13,
          borderRadius: 8,
          padding: '8px 12px',
        },
      },
    },
  },
});
