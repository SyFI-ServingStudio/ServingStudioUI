import { Box } from '@mui/material';
import { useMemo } from 'react';

import {
  isPending,
  runLatencyRef,
  useArtifact,
  type ArtifactResult,
  type LatencySeries,
} from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import ChartCard from '../../ui/controls/ChartCard';
import type { PanelProps } from '../types';
import { sloMetricOption } from './option';

const SLO_CARDS = [
  {
    key: 'ttft',
    idx: 'a1',
    title: 'TTFT latency',
    color: CHART_THEME.palette[0],
    caption: 'Cumulative distribution of time to first token. The dotted marker shows p90.',
  },
  {
    key: 'tpot',
    idx: 'a2',
    title: 'TPOT latency',
    color: CHART_THEME.palette[1],
    caption: 'Cumulative distribution of time per output token. The dotted marker shows p90.',
  },
  {
    key: 'e2e',
    idx: 'a3',
    title: 'E2E latency',
    color: CHART_THEME.palette[2],
    caption: 'Cumulative distribution of end-to-end request latency. The dotted marker shows p90.',
  },
] as const;

export function RunSloPanel({ location }: PanelProps) {
  const state = useArtifact(useMemo(() => runLatencyRef(location.ref), [location.ref]));
  const byKey =
    state.status === 'ready'
      ? new Map(state.value.series.map((series) => [series.key, series]))
      : new Map<string, LatencySeries>();
  const sub = isPending(state)
    ? 'loading'
    : state.status === 'ready'
      ? 'request CDF'
      : state.status;
  const empty = state.status === 'ready' ? undefined : oldSubjectMessage(state);

  return (
    <Box
      data-testid="slo-chart-row"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(3,minmax(0,1fr))' },
        gap: 2,
        minWidth: 0,
      }}
    >
      {SLO_CARDS.map((card) => {
        const metric = byKey.get(card.key);
        return (
          <ChartCard
            evidenceId={`slo:${card.key}`}
            key={card.key}
            testId={`slo-${card.key}`}
            idx={card.idx}
            title={card.title}
            sub={sub.replace('_', ' ')}
            option={
              metric === undefined || metric.markers === null
                ? null
                : sloMetricOption({ ...metric, markers: metric.markers }, CHART_THEME, card.color)
            }
            empty={
              metric !== undefined && metric.markers === null
                ? 'No completed requests have this latency metric.'
                : empty
            }
            caption={card.caption}
          />
        );
      })}
    </Box>
  );
}

function oldSubjectMessage(state: Exclude<ArtifactResult<unknown>, { status: 'ready' }>) {
  const labels = {
    pending: 'loading',
    unavailable: 'unavailable',
    not_generated: 'not generated',
    failed: 'failed',
    incompatible: 'incompatible',
  } as const;
  const reason = 'reason' in state ? state.reason : undefined;
  const code = 'code' in state ? state.code : undefined;
  return [`Analyzer subject slo is ${labels[state.status]}.`, code ? `[${code}]` : '', reason ?? '']
    .filter(Boolean)
    .join(' ');
}
