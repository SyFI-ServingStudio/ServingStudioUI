import { Box } from '@mui/material';
import type { ReactNode } from 'react';

import { tokens } from '../../theme';

export type CatalogTagTone =
  | 'workspace'
  | 'deployment'
  | 'trace'
  | 'axis'
  | 'singleton'
  | 'simulation'
  | 'timing'
  | 'profile'
  | 'measure';

const toneStyles: Record<CatalogTagTone, { color: string; border: string; background: string }> = {
  workspace: {
    color: tokens.gold,
    border: 'rgba(128,102,0,.27)',
    background: 'rgba(128,102,0,.065)',
  },
  deployment: {
    color: tokens.teal,
    border: 'rgba(31,111,107,.28)',
    background: 'rgba(31,111,107,.065)',
  },
  trace: {
    color: tokens.olive,
    border: 'rgba(86,106,46,.3)',
    background: 'rgba(86,106,46,.07)',
  },
  axis: {
    color: tokens.sectionAnalysis,
    border: 'rgba(87,126,137,.28)',
    background: 'rgba(87,126,137,.06)',
  },
  singleton: {
    color: tokens.sub,
    border: 'rgba(104,95,84,.25)',
    background: 'rgba(104,95,84,.055)',
  },
  simulation: {
    color: tokens.teal,
    border: 'rgba(31,111,107,.28)',
    background: 'rgba(31,111,107,.065)',
  },
  timing: {
    color: tokens.gold,
    border: 'rgba(128,102,0,.27)',
    background: 'rgba(128,102,0,.065)',
  },
  profile: {
    color: tokens.sectionAnalysis,
    border: 'rgba(87,126,137,.3)',
    background: 'rgba(87,126,137,.07)',
  },
  measure: {
    color: tokens.terra,
    border: 'rgba(168,75,46,.28)',
    background: 'rgba(168,75,46,.065)',
  },
};

/** Shared visual identity for catalog cells and their column-filter options. */
export default function CatalogTag({
  tone,
  children,
  selected = false,
  compact = false,
}: {
  tone: CatalogTagTone;
  children: ReactNode;
  selected?: boolean;
  compact?: boolean;
}) {
  const style = toneStyles[tone];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: compact ? 17 : 21,
        px: compact ? 0.6 : 0.85,
        border: `1px solid ${style.border}`,
        borderRadius: 0.75,
        background: style.background,
        boxShadow: selected ? `inset 0 0 0 1px ${style.color}` : 'none',
        color: style.color,
        fontFamily: tokens.mono,
        fontSize: compact ? 7.5 : 8.5,
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}
