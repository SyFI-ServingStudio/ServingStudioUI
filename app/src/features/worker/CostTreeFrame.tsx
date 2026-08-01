import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import SurfaceCard from '../../components/SurfaceCard';
import { GROUP, fmtMs } from '../../domain/cost-tree';
import type { WorkerRow } from '../../domain/run';
import { tokens } from '../../theme';
import { COST_TREE_VIEWPORT_HEIGHT } from './CostTreeCanvas';

export const COST_TREE_HEADER_HEIGHT = 45;
// Paper contributes two 1px outer borders and the viewport/header seam
// contributes one device-independent pixel, so the joint workbench reserves
// the measured outer frame height rather than duplicating this arithmetic.
export const COST_TREE_FRAME_HEIGHT = COST_TREE_HEADER_HEIGHT + COST_TREE_VIEWPORT_HEIGHT + 3;
export const WORKER_WORKBENCH_HEIGHT_VAR = '--worker-workbench-height';
export const WORKER_WORKBENCH_HEIGHT = `var(${WORKER_WORKBENCH_HEIGHT_VAR}, ${COST_TREE_FRAME_HEIGHT}px)`;

interface CostTreeFrameProps {
  worker?: WorkerRow | null;
  identity?: {
    readonly archId: string;
    readonly archType: string;
    readonly gpuCount: number;
  };
  timeBasis?: string;
  totalMs?: number;
  children: ReactNode;
}

/** Shared frame inherits the feature-owned workbench row height so exact-tree
 * transitions cannot collapse or resize the high-cardinality detail region. */
export function CostTreeFrame({
  worker = null,
  identity,
  timeBasis,
  totalMs,
  children,
}: CostTreeFrameProps) {
  const displayedIdentity =
    identity ??
    (worker === null
      ? null
      : { archId: worker.id, archType: worker.arch.type, gpuCount: worker.gpuCount });
  return (
    <SurfaceCard
      data-testid="cost-tree-frame"
      sx={{
        height: WORKER_WORKBENCH_HEIGHT,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack
        data-testid="cost-tree-header"
        direction="row"
        alignItems="center"
        flexWrap="nowrap"
        useFlexGap
        sx={{
          gap: 1.2,
          height: COST_TREE_HEADER_HEIGHT,
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
                  fontFamily: tokens.mono,
                  fontSize: 10.5,
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
              fontFamily: tokens.mono,
              fontSize: 10,
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
          flexWrap="nowrap"
          useFlexGap
          sx={{ gap: '3px 9px', ml: 'auto', flexShrink: 0 }}
        >
          {Object.entries(GROUP)
            .filter(([group]) => group !== 'misc')
            .map(([group, definition]) => (
              <Box
                key={group}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.45, fontSize: 9.5 }}
              >
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: 0.6,
                    background: definition.color,
                  }}
                />
                {definition.label}
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
        backgroundImage: 'radial-gradient(circle, rgba(42,38,34,.12) 0.7px, transparent 0.8px)',
        backgroundSize: '16px 16px',
      }}
    >
      <Box sx={{ maxWidth: 720 }}>{children}</Box>
    </Box>
  );
}
