import { createTheme, type Theme } from '@mui/material/styles';

import { theme } from '../ui/theme';

type Rules = Record<string, unknown>;

/**
 * The application's theme for a viewer embedded in another page.
 *
 * The page's own styles stay the page's: the global CssBaseline rules become
 * the embedded root's (`ScopedCssBaseline`), and every portal (dialogs,
 * popovers, tooltips) opens in `container`, inside the viewer, so it is styled
 * like the rest of it even in a shadow root.
 */
export function embedTheme(container: HTMLElement): Theme {
  const baseline = (theme.components?.MuiCssBaseline?.styleOverrides ?? {}) as Rules;
  return createTheme(theme, {
    components: {
      MuiScopedCssBaseline: {
        styleOverrides: {
          root: {
            ...(baseline.body as Rules),
            '& *': baseline['*'],
            '& ::selection': baseline['::selection'],
            '& button:focus-visible, & a:focus-visible':
              baseline['button:focus-visible, a:focus-visible'],
          },
        },
      },
      MuiModal: { defaultProps: { container } },
      MuiPopover: { defaultProps: { container } },
      MuiPopper: { defaultProps: { container } },
      MuiTooltip: { defaultProps: { PopperProps: { container } } },
    },
  });
}
