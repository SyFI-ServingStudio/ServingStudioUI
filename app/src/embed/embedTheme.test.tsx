import { Popover, Tooltip } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { embedTheme } from './embedTheme';

afterEach(cleanup);

describe('embedTheme', () => {
  it('opens every portal inside the viewer', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const anchor = document.createElement('button');
    document.body.append(anchor);
    render(
      <ThemeProvider theme={embedTheme(container)}>
        <Tooltip title="tip" open>
          <button type="button">target</button>
        </Tooltip>
        <Popover open anchorEl={anchor}>
          popover
        </Popover>
      </ThemeProvider>,
    );
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe('tip');
    expect(container.querySelector('.MuiPopover-paper')?.textContent).toBe('popover');
  });

  it('keeps the global baseline rules on the viewer root', () => {
    const root = embedTheme(document.createElement('div')).components?.MuiScopedCssBaseline
      ?.styleOverrides?.root as Record<string, unknown>;
    expect(root).toHaveProperty('fontVariantNumeric', 'tabular-nums');
    expect(root).toHaveProperty(['& *', 'scrollbarWidth'], 'thin');
    expect(root).toHaveProperty(['& button:focus-visible, & a:focus-visible', 'outlineOffset'], 3);
  });
});
