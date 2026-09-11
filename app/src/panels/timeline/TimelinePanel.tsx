import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';

import { runConcurrencyRef, useArtifact, type ArtifactResult } from '../../artifacts';
import { upTo, withCursor } from '../../location';
import { CHART_THEME } from '../../ui/charts/platform';
import EChart from '../../ui/controls/EChart';
import SurfaceCard from '../../ui/controls/SurfaceCard';
import { colors, tokens, withAlpha } from '../../ui/theme';
import type { PanelProps } from '../types';
import { concurrencySparkOption } from './option';

const RANGE_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
]);

export function RunTimelinePanel({ location, navigate }: PanelProps) {
  const state = useArtifact(useMemo(() => runConcurrencyRef(location.ref), [location.ref]));
  const committed = location.focus.cursorMs;
  const [draft, setDraft] = useState<number | null>(committed);

  useEffect(() => setDraft(committed), [committed, location.ref]);

  const commitCursor = (cursorMs: number | null) => {
    setDraft(cursorMs);
    const selected = location.focus.path.at(-1)?.at;
    // A free cursor invalidates an exact operation/leaf/parallel coordinate.
    // Return to the worker in the same commit; the iteration workbench then
    // resolves the new wall-clock cursor to the server-selected operation.
    const base =
      selected === 'operation' || selected === 'leaf' || selected === 'parallel'
        ? upTo(location.focus, 'worker')
        : location.focus;
    navigate({ ...location, focus: withCursor(base, cursorMs) }, 'replace');
  };

  if (state.status !== 'ready') {
    return (
      <SurfaceCard data-testid="run-timeline" accent={tokens.terra} sx={{ p: '12px 16px' }}>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={2}>
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
            Timeline
          </Typography>
          <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
            {oldStatusLabel(state)}
          </Typography>
        </Stack>
        <Typography
          role="status"
          sx={{ mt: 0.75, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}
        >
          {oldSubjectMessage(state)}
        </Typography>
      </SurfaceCard>
    );
  }

  const concurrency = state.value;
  const spanMs = concurrency.spanMs;
  if (spanMs <= 0) {
    return (
      <SurfaceCard data-testid="run-timeline" accent={tokens.terra} sx={{ p: '12px 16px' }}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
          Timeline
        </Typography>
        <Typography
          role="status"
          sx={{ mt: 0.75, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}
        >
          Concurrency subject is ready but has no positive wall-clock span.
        </Typography>
      </SurfaceCard>
    );
  }

  const cursor = draft;
  const fraction = cursor === null ? null : Math.min(1, Math.max(0, cursor / spanMs));
  const activeNow =
    cursor === null ? null : nearestActive(concurrency.tMs, concurrency.active, cursor);
  const rangeValue = cursor === null ? 0 : Math.round(Math.min(spanMs, Math.max(0, cursor)));
  const allSelected = cursor === null;
  const pill = {
    fontFamily: tokens.body,
    fontSize: 12,
    fontWeight: 600,
    px: 1.25,
    py: 0.5,
    borderRadius: 1.5,
    cursor: 'pointer',
    color: allSelected ? tokens.teal : tokens.sub,
    background: allSelected ? withAlpha(tokens.teal, 0.1) : 'transparent',
    border: `1px solid ${allSelected ? tokens.teal : tokens.hair}`,
    transition: `all .22s ${tokens.ease}`,
    '&:hover': {
      color: allSelected ? tokens.teal : tokens.ink,
      borderColor: allSelected ? tokens.teal : colors.borderHover,
    },
    '&:focus-visible': { outline: `2px solid ${tokens.ink}`, outlineOffset: 2 },
  };

  return (
    <SurfaceCard data-testid="run-timeline" accent={tokens.terra} sx={{ p: '12px 16px 10px' }}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 1.5, mb: 0.9 }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
          Timeline
          <Box
            component="span"
            sx={{
              fontFamily: tokens.body,
              fontSize: 12,
              color: tokens.sub,
              ml: 1.25,
              fontWeight: 400,
            }}
          >
            wall-clock · {(spanMs / 1000).toFixed(0)}s · active requests in system
          </Box>
        </Typography>
        <Box
          sx={{
            ml: 'auto',
            fontFamily: tokens.body,
            fontSize: 12,
            color: cursor === null ? tokens.sub : tokens.terra,
            minWidth: 118,
            textAlign: 'right',
          }}
        >
          {cursor === null
            ? `aggregate · peak ${concurrency.peak}`
            : `t = ${(cursor / 1000).toFixed(2)}s · ${activeNow ?? '—'} active`}
        </Box>
        <ButtonBase
          type="button"
          aria-pressed={allSelected}
          onClick={() => commitCursor(null)}
          sx={pill}
        >
          All
        </ButtonBase>
      </Stack>
      <Box
        sx={{
          position: 'relative',
          height: 50,
          borderRadius: 1.25,
          border: `1px solid ${tokens.hair}`,
          background: tokens.tile2,
          overflow: 'hidden',
          cursor: 'pointer',
          touchAction: 'none',
          '&:has(> input:focus-visible)': {
            outline: `2px solid ${tokens.ink}`,
            outlineOffset: 2,
          },
        }}
      >
        <Box
          component="input"
          type="range"
          min={0}
          max={Math.round(spanMs)}
          step={1}
          value={rangeValue}
          aria-label="Simulation time cursor"
          aria-valuetext={
            cursor === null
              ? 'Aggregate, no time selected'
              : `${(rangeValue / 1000).toFixed(2)} seconds, ${activeNow ?? 'unknown'} active requests`
          }
          onChange={(event) => setDraft(Number(event.currentTarget.value))}
          onPointerUp={(event) => commitCursor(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (RANGE_KEYS.has(event.key)) commitCursor(Number(event.currentTarget.value));
          }}
          onPointerCancel={(event) => commitCursor(Number(event.currentTarget.value))}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            m: 0,
            opacity: 0,
            cursor: 'ew-resize',
            zIndex: 2,
          }}
        />
        <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <EChart
            option={concurrencySparkOption(concurrency, CHART_THEME)}
            ariaLabel="Request concurrency over simulation time"
          />
        </Box>
        {fraction !== null && (
          <>
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${fraction * 100}%`,
                width: '2px',
                background: tokens.terra,
                pointerEvents: 'none',
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: `${fraction * 100}%`,
                transform: 'translate(-50%,-50%)',
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: tokens.terra,
                border: `2px solid ${colors.tooltipText}`,
                boxShadow: tokens.shadow,
                pointerEvents: 'none',
              }}
            />
          </>
        )}
      </Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{ mt: 0.4, fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}
      >
        <span>0s</span>
        <span>active requests in flight ↑ · drag or use arrow keys</span>
        <span>{(spanMs / 1000).toFixed(0)}s</span>
      </Stack>
    </SurfaceCard>
  );
}

function nearestActive(
  times: readonly number[],
  active: readonly number[],
  cursorMs: number,
): number | null {
  if (times.length === 0) return null;
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const candidate = Math.abs(time - cursorMs);
    if (candidate < distance) {
      distance = candidate;
      nearest = index;
    }
  });
  return active[nearest] ?? null;
}

function oldStatusLabel(state: Exclude<ArtifactResult<unknown>, { status: 'ready' }>): string {
  return {
    pending: 'loading',
    unavailable: 'unavailable',
    not_generated: 'not generated',
    failed: 'failed',
    incompatible: 'incompatible',
  }[state.status];
}

function oldSubjectMessage(state: Exclude<ArtifactResult<unknown>, { status: 'ready' }>): string {
  const reason = 'reason' in state ? state.reason : undefined;
  const code = 'code' in state ? state.code : undefined;
  return [
    `Analyzer subject concurrency is ${oldStatusLabel(state)}.`,
    code ? `[${code}]` : '',
    reason ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}
