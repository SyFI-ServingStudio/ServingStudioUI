import { ToggleButton, ToggleButtonGroup } from '@mui/material';

import { tokens } from '../theme';

export interface SectionPanelToggleOption {
  readonly value: string;
  readonly label: string;
}

/** The existing compact two-state section control, driven by layout data. */
export function SectionPanelToggle({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: readonly SectionPanelToggleOption[];
  onChange(value: string): void;
}) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_, nextValue: string | null) => {
        if (nextValue !== null) onChange(nextValue);
      }}
      aria-label={ariaLabel}
      sx={{
        flexShrink: 0,
        '& .MuiToggleButton-root': {
          px: 1,
          py: 0.2,
          fontFamily: tokens.body,
          fontSize: 12,
          lineHeight: 1.45,
          color: tokens.sub,
          borderColor: tokens.hair,
          whiteSpace: 'nowrap',
          '&.Mui-selected': { color: tokens.teal, backgroundColor: tokens.tile2 },
        },
      }}
    >
      {options.map((option) => (
        <ToggleButton key={option.value} value={option.value}>
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
