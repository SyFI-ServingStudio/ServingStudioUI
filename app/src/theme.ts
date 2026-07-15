import { createTheme } from '@mui/material/styles';

// Editorial / warm-paper design tokens (from design-d). Components read these
// via `import { tokens }` for sx values; MUI palette below mirrors the key ones.
export const tokens = {
  paper: '#f4efe4',
  tile: '#faf7f0',
  tile2: '#f7f2e7',
  leafbg: '#fffdf8',
  ink: '#2a2622',
  sub: '#8a8072',
  sub2: '#a89e8d',
  hair: '#e3dccb',
  teal: '#1f6f6b',
  terra: '#c25c3a',
  gold: '#b08900',
  olive: '#6a7f3a',
  violet: '#7a5cff',
  shadow: '0 1px 0 rgba(42,38,34,.02), 0 10px 30px -22px rgba(42,38,34,.35)',
  shadowLift: '0 20px 60px -28px rgba(42,38,34,.5)',
  serif: "'Fraunces', Georgia, serif",
  body: "'Hanken Grotesk', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  ease: 'cubic-bezier(.22,.61,.36,1)',
};

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: tokens.teal },
    secondary: { main: tokens.terra },
    background: { default: tokens.paper, paper: tokens.tile },
    text: { primary: tokens.ink, secondary: tokens.sub },
    divider: tokens.hair,
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: tokens.body,
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: tokens.paper,
          backgroundImage:
            'radial-gradient(circle at 12% 8%, rgba(194,92,58,.035), transparent 42%),' +
            'radial-gradient(circle at 90% 4%, rgba(31,111,107,.04), transparent 46%)',
          backgroundAttachment: 'fixed',
        },
        '::selection': { background: 'rgba(31,111,107,.18)' },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: tokens.tile,
          border: `1px solid ${tokens.hair}`,
          backgroundImage: 'none',
          boxShadow: tokens.shadow,
        },
      },
    },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: 'rgba(42,38,34,.96)',
          fontFamily: tokens.mono,
          fontSize: 11,
          borderRadius: 8,
          padding: '8px 10px',
        },
      },
    },
  },
});
