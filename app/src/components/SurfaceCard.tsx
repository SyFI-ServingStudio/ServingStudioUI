import { Paper, type PaperProps } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { createContext, type ReactNode } from 'react';

import { tokens } from '../theme';

export interface SurfaceCardProps extends PaperProps {
  /** Optional semantic accent retained for feature-level grouping. */
  readonly accent?: string;
}

const SectionAccentContext = createContext<string | null>(null);

export function SurfaceAccentProvider({
  accent,
  children,
}: {
  accent: string;
  children: ReactNode;
}) {
  return <SectionAccentContext.Provider value={accent}>{children}</SectionAccentContext.Provider>;
}

const surfaceCardShell: SxProps<Theme> = {
  overflow: 'hidden',
  position: 'relative',
  borderRadius: '12px',
  background: tokens.tile,
  border: `1px solid ${tokens.hair}`,
  boxShadow: tokens.shadow,
};

/** Neutral card shell; feature components own content and selection states. */
export default function SurfaceCard({ accent: _accent, sx, children, ...props }: SurfaceCardProps) {
  const overrides = Array.isArray(sx) ? sx : sx === undefined ? [] : [sx];
  return (
    <Paper {...props} sx={[surfaceCardShell, ...overrides]}>
      {children}
    </Paper>
  );
}
