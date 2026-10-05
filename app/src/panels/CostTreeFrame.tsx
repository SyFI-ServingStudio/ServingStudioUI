import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import SurfaceCard from '../ui/controls/SurfaceCard';
import { fmtMs } from './costTreeModel';
import { familyColor, useKernelKinds } from './kernelTaxonomy';
import { tokens, withAlpha } from '../ui/theme';
import { COST_TREE_VIEWPORT_HEIGHT } from './CostTreeCanvas';

export const COST_TREE_HEADER_HEIGHT = 45;
// Paper contributes two 1px outer borders and the viewport/header seam
// contributes one device-independent pixel, so the joint workbench reserves
// the measured outer frame height rather than duplicating this arithmetic.
export const COST_TREE_FRAME_HEIGHT = COST_TREE_HEADER_HEIGHT + COST_TREE_VIEWPORT_HEIGHT + 3;
export const WORKER_WORKBENCH_HEIGHT_VAR = '--worker-workbench-height';
export const WORKER_WORKBENCH_HEIGHT = `var(${WORKER_WORKBENCH_HEIGHT_VAR}, ${COST_TREE_FRAME_HEIGHT}px)`;

interface CostTreeFrameProps {
  worker?: {
    readonly id: string;
    readonly arch: { readonly type: string };
    readonly gpuCount: number;
  } | null;
  identity?: {
    readonly archId: string;
    readonly archType: string;
    readonly gpuCount: number;
  };
  timeBasis?: string;
  totalMs?: number;
  browserExpanded?: boolean;
  children: ReactNode;
}

/** Shared frame inherits the feature-owned workbench row height so exact-tree
 * transitions cannot collapse or resize the high-cardinality detail region. */
export function CostTreeFrame({
  worker = null,
  identity,
  timeBasis,
  totalMs,
  browserExpanded = false,
  children,
}: CostTreeFrameProps) {
  const kinds = useKernelKinds();
  const displayedIdentity =
    identity ??
    (worker === null
      ? null
      : { archId: worker.id, archType: worker.arch.type, gpuCount: worker.gpuCount });
  return (
    <SurfaceCard
      data-testid="cost-tree-frame"
      sx={{
        position: browserExpanded ? 'fixed' : 'relative',
        inset: browserExpanded ? 0 : undefined,
        zIndex: browserExpanded ? (theme) => theme.zIndex.modal + 1 : undefined,
        width: browserExpanded ? '100%' : undefined,
        height: browserExpanded ? '100dvh' : WORKER_WORKBENCH_HEIGHT,
        borderRadius: browserExpanded ? 0 : undefined,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* The header is one 45px row when it fits; where it does not (a phone,
          or a narrow frame with every DOC family in the legend) it wraps onto
          more rows and the canvas, which fills the frame, gives up the height. */}
      <Stack
        data-testid="cost-tree-header"
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{
          gap: '6px 12px',
          minHeight: COST_TREE_HEADER_HEIGHT,
          flexShrink: 0,
          boxSizing: 'border-box',
          p: '9px 13px',
          overflow: 'hidden',
          borderBottom: `1px solid ${tokens.hair}`,
        }}
      >
        <Typography
          noWrap
          sx={{ flexShrink: 0, fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}
        >
          {displayedIdentity === null ? (
            'CostTree'
          ) : (
            <>
              arch{' '}
              <Box
                component="span"
                sx={{
                  fontFamily: tokens.body,
                  fontSize: 12,
                  color: tokens.teal,
                  fontWeight: 500,
                }}
              >
                {displayedIdentity.archId} · {displayedIdentity.archType} ·{' '}
                {displayedIdentity.gpuCount} GPU
              </Box>
            </>
          )}
        </Typography>
        {timeBasis !== undefined && totalMs !== undefined && (
          <Box
            sx={{
              flexShrink: 0,
              fontFamily: tokens.body,
              fontSize: 12,
              color: tokens.sub,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.9,
              px: 1,
              py: 0.35,
              background: tokens.tile2,
            }}
          >
            Σ / {timeBasis} <b style={{ color: tokens.teal }}>{fmtMs(totalMs)}</b>
          </Box>
        )}
        <Stack
          direction="row"
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ gap: '3px 9px', ml: 'auto', minWidth: 0 }}
        >
          {kinds.categories.map((family) => (
            <Box
              key={family}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.45, fontSize: 12 }}
            >
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: 0.6,
                  background: familyColor(kinds, family),
                }}
              />
              {family}
            </Box>
          ))}
        </Stack>
      </Stack>
      {children}
    </SurfaceCard>
  );
}

interface CostTreeStatusViewportProps {
  role: 'status' | 'alert';
  busy?: boolean;
  children: ReactNode;
}

export function CostTreeStatusViewport({
  role,
  busy = false,
  children,
}: CostTreeStatusViewportProps) {
  return (
    <Box
      data-testid="cost-tree-viewport"
      role={role}
      aria-busy={busy || undefined}
      sx={{
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        p: 3,
        backgroundColor: tokens.tile2,
        backgroundImage: `radial-gradient(circle, ${withAlpha(tokens.sub, 0.12)} 0.7px, transparent 0.8px)`,
        backgroundSize: '16px 16px',
      }}
    >
      <Box sx={{ maxWidth: 720 }}>{children}</Box>
    </Box>
  );
}
