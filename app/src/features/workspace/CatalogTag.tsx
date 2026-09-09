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

const typeTones: Partial<Record<CatalogTagTone, string>> = {
  simulation: tokens.teal,
  timing: tokens.gold,
  profile: tokens.violet,
  measure: tokens.olive,
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
  const color = typeTones[tone] ?? tokens.sub;
  const isType = tone in typeTones;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: compact ? 22 : 26,
        px: compact ? 0.6 : 0.85,
        border: '1px solid transparent',
        borderRadius: 0.75,
        background: isType ? `${color}12` : 'transparent',
        boxShadow: selected ? `inset 0 0 0 1px ${color}` : 'none',
        color,
        fontFamily: 'inherit',
        fontSize: compact ? 12 : 12.5,
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {children}
    </Box>
  );
}
