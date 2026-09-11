import { Box, Skeleton, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';

import { conservationRef, isPending, useArtifact, type ConservationStatus } from '../../artifacts';
import SurfaceCard from '../../ui/controls/SurfaceCard';
import { tokens, withAlpha } from '../../ui/theme';
import { ReadProblem } from '../ReadProblem';
import type { PanelProps } from '../types';
import { runConservation, type CheckRow } from './checks';

const STATUS_STYLE: Record<ConservationStatus, { color: string; bg: string; label: string }> = {
  ok: { color: tokens.teal, bg: withAlpha(tokens.teal, 0.1), label: 'OK' },
  warn: { color: tokens.gold, bg: withAlpha(tokens.violet, 0.14), label: 'WARN' },
  fail: { color: tokens.terra, bg: withAlpha(tokens.terra, 0.14), label: 'FAIL' },
};

function formatInteger(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatDelta(row: CheckRow): string {
  if (row.deltaPercent === null) return row.delta === 0 ? '0% vs exp' : '— vs exp';
  const prefix = row.deltaPercent > 0 ? '+' : '';
  return `${prefix}${Number(row.deltaPercent.toFixed(2))}% vs exp`;
}

export function RunConservationPanel({ location }: PanelProps) {
  const state = useArtifact(useMemo(() => conservationRef(location.ref), [location.ref]));

  if (isPending(state)) {
    return (
      <SurfaceCard sx={{ p: '16px 16px 14px' }}>
        <Skeleton variant="rounded" height={120} />
      </SurfaceCard>
    );
  }
  if (state.status !== 'ready') {
    return (
      <SurfaceCard sx={{ p: '16px 16px 14px' }}>
        <ReadProblem what="This result's conservation subject" result={state} />
      </SurfaceCard>
    );
  }

  const data = runConservation(state.value).value;
  return (
    <SurfaceCard
      component="section"
      aria-labelledby="workload-conservation-title"
      data-testid="conservation-run"
      sx={{ p: '16px 16px 14px' }}
    >
      <Stack
        direction="row"
        alignItems="baseline"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1 }}
      >
        <Typography
          id="workload-conservation-title"
          component="h3"
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '-.01em',
            display: 'flex',
            alignItems: 'baseline',
            gap: 1.1,
          }}
        >
          <Box
            component="span"
            sx={{
              fontFamily: tokens.body,
              fontSize: 12,
              color: tokens.terra,
              letterSpacing: '.1em',
            }}
          >
            d
          </Box>
          Workload conservation
        </Typography>
        <Typography
          sx={{
            fontFamily: tokens.body,
            fontSize: 12,
            color: data.verdict === 'ok' ? tokens.teal : tokens.gold,
            textAlign: 'right',
            whiteSpace: 'nowrap',
          }}
        >
          {data.verdict === 'ok' ? 'all balanced' : 'imbalance flagged'}
        </Typography>
      </Stack>

      <Stack>
        {data.rows.map((row, index) => {
          const style = STATUS_STYLE[row.status];
          return (
            <Stack
              key={row.name}
              direction="row"
              alignItems="center"
              spacing={1.5}
              sx={{ py: 1.1, borderTop: index ? `1px solid ${tokens.hair}` : 'none' }}
            >
              <Box
                sx={{
                  width: 48,
                  textAlign: 'center',
                  fontFamily: tokens.body,
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '.06em',
                  color: style.color,
                  background: style.bg,
                  borderRadius: 0.75,
                  py: '3px',
                }}
              >
                {style.label}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.ink }}>
                  {row.name}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right', minWidth: 88 }}>
                <Typography
                  sx={{
                    fontFamily: tokens.body,
                    fontSize: 12,
                    color: tokens.ink,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatInteger(row.actual)}
                </Typography>
                <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: style.color }}>
                  {formatDelta(row)}
                </Typography>
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </SurfaceCard>
  );
}
