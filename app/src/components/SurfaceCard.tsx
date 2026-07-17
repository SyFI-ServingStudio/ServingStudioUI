import { Paper, type PaperProps } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

import { tokens } from '../theme';

export interface SurfaceCardProps extends PaperProps {
  /** Semantic edge color; content owns meaning while this component owns the shell. */
  readonly accent?: string;
}

const surfaceCardShell = (accent: string): SxProps<Theme> => ({
  overflow: 'hidden',
  borderRadius: 2,
  borderTop: `2px solid ${accent}`,
  background: tokens.tile,
});

/** Canonical page-card shell. Feature components may extend layout through sx,
 * but must not reproduce the surface/border/accent treatment themselves. */
export default function SurfaceCard({ accent = tokens.teal, sx, ...props }: SurfaceCardProps) {
  const overrides = Array.isArray(sx) ? sx : sx === undefined ? [] : [sx];
  return <Paper {...props} sx={[surfaceCardShell(accent), ...overrides]} />;
}
