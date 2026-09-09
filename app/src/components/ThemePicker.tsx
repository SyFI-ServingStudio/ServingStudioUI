import { Box, ButtonBase, Tooltip } from '@mui/material';
import { activeThemeId, selectTheme, themes, tokens } from '../theme';
import type { ThemeId } from '../theme/palettes';

const labels: Record<ThemeId, string> = { vscode: 'Dark', light: 'Light', warm: 'Paper' };

export default function ThemePicker() {
  return (
    <Box
      role="group"
      aria-label="Color theme"
      sx={{ display: 'flex', alignItems: 'center', gap: '3px', p: '3px', borderRadius: '8px',
        border: `1px solid ${tokens.hair}`, background: tokens.paper }}
    >
      {(Object.keys(themes) as ThemeId[]).map((id) => {
        const definition = themes[id];
        const selected = id === activeThemeId;
        return (
          <Tooltip key={id} title={definition.label} arrow>
            <ButtonBase
              aria-label={definition.label}
              aria-pressed={selected}
              onClick={() => { if (!selected) selectTheme(id); }}
              sx={{
                gap: '6px', px: '8px', height: 28, borderRadius: '5px',
                fontSize: 11, fontWeight: selected ? 500 : 400,
                color: selected ? tokens.ink : tokens.sub,
                background: selected ? tokens.tile : 'transparent',
                transition: 'background-color 150ms, color 150ms',
                '&:hover': { background: tokens.tile, color: tokens.ink },
                '&.Mui-focusVisible': { outline: `2px solid ${tokens.ink}`, outlineOffset: 2 },
              }}
            >
              <Box aria-hidden="true" sx={{
                width: 14, height: 14, borderRadius: '3px', overflow: 'hidden',
                border: `1px solid ${definition.palette.muted}`,
                background: definition.palette.background,
                display: 'flex', alignItems: 'stretch',
              }}>
                <Box sx={{ width: 4, background: definition.palette.elevated,
                  borderRight: `1px solid ${definition.palette.border}` }} />
              </Box>
              {labels[id]}
            </ButtonBase>
          </Tooltip>
        );
      })}
    </Box>
  );
}
