import { Box, Paper, type PaperProps } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { createContext, useContext, type ReactNode } from 'react';

import { tokens } from '../theme';

export interface SurfaceCardProps extends PaperProps {
  /** Fallback edge color outside a section-owned accent provider. */
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
  borderRadius: 2,
  background: tokens.tile,
  border: `1px solid ${tokens.hair}`,
  boxShadow: tokens.shadow,
};

/** Canonical page-card shell. Feature components may extend layout through sx,
 * but must not reproduce the surface/border/left-accent treatment themselves. */
export default function SurfaceCard({
  accent = tokens.teal,
  sx,
  children,
  ...props
}: SurfaceCardProps) {
  const sectionAccent = useContext(SectionAccentContext);
  const edgeAccent = sectionAccent ?? accent;
  const overrides = Array.isArray(sx) ? sx : sx === undefined ? [] : [sx];
  return (
    <Paper {...props} sx={[surfaceCardShell, ...overrides]}>
      {/* Render above opaque feature content so canvases cannot cover the
       * shared semantic edge. It does not participate in card layout. */}
      <Box
        aria-hidden="true"
        data-surface-accent-edge
        sx={{
          position: 'absolute',
          zIndex: 2,
          inset: 0,
          boxSizing: 'border-box',
          borderRadius: 'inherit',
          borderLeft: `2px solid ${edgeAccent}`,
          pointerEvents: 'none',
        }}
      />
      {children}
    </Paper>
  );
}
