/** Existing pool and worker KV charts reached through location-first reads. */
import { useMemo } from 'react';

import {
  isPending,
  kvOccupancySeriesRef,
  useArtifact,
  type KvOccupancyTimeline,
  type WorkerCoordinate,
} from '../../artifacts';
import { segmentOf } from '../../location';
import { CHART_THEME } from '../../ui/charts/platform';
import ChartCard from '../../ui/controls/ChartCard';
import { workerOf } from '../coordinate';
import { describeRead } from '../readProblem';
import type { PanelProps } from '../types';
import { kvOption } from './option';

const TITLE = 'KV occupancy';
const CAPTION = 'Per-worker active KV-cache occupancy over time, with bold pool-average lines.';

export function PoolMemoryPanel(props: PanelProps) {
  const pool = segmentOf(props.location.focus.path, 'pool');
  return <MemoryPanel {...props} scope={{ kind: 'pool', poolTag: pool?.role ?? null }} />;
}

export function WorkerMemoryPanel(props: PanelProps) {
  return (
    <MemoryPanel {...props} scope={{ kind: 'worker', worker: workerOf(props.location.focus) }} />
  );
}

type Scope =
  | { readonly kind: 'pool'; readonly poolTag: string | null }
  | { readonly kind: 'worker'; readonly worker: WorkerCoordinate | null };

function MemoryPanel({ location, scope }: PanelProps & { scope: Scope }) {
  const state = useArtifact(useMemo(() => kvOccupancySeriesRef(location.ref), [location.ref]));
  const identity = identityOf(scope);
  const testId = `kv-${scope.kind}-${identity ?? 'missing'}`;

  if (isPending(state)) {
    return (
      <ChartCard
        evidenceId="kv-cache"
        testId={testId}
        idx="b"
        title={TITLE}
        sub="loading"
        option={null}
        empty="Loading KV occupancy…"
      />
    );
  }
  if (state.status !== 'ready') {
    const problem = describeRead("This result's kv-occupancy subject", state);
    return (
      <ChartCard
        evidenceId="kv-cache"
        testId={testId}
        idx="b"
        title={TITLE}
        sub={state.status.replace('_', ' ')}
        option={null}
        empty={problem?.message}
        caption={CAPTION}
      />
    );
  }

  const timeline = scopedTimeline(state.value, scope);
  const option =
    timeline.series.length === 0 && timeline.workerSeries.length === 0
      ? null
      : kvOption(
          timeline,
          CHART_THEME,
          location.focus.cursorMs === null ? undefined : location.focus.cursorMs / 1000,
        );
  return (
    <ChartCard
      evidenceId="kv-cache"
      testId={testId}
      idx="b"
      title={TITLE}
      sub={option === null ? emptySubtitleOf(scope) : subtitleOf(scope, timeline)}
      option={option}
      note={option === null ? null : noteOf(scope)}
      caption={CAPTION}
      empty={option === null ? emptyOf(scope) : undefined}
    />
  );
}

function scopedTimeline(timeline: KvOccupancyTimeline, scope: Scope): KvOccupancyTimeline {
  if (scope.kind === 'pool') {
    if (scope.poolTag === null) return { ...timeline, series: [], workerSeries: [] };
    return {
      ...timeline,
      series: timeline.series.filter((series) => series.poolTag === scope.poolTag),
      workerSeries: timeline.workerSeries.filter(
        (series) => series.worker.poolTag === scope.poolTag,
      ),
    };
  }
  if (scope.worker === null) return { ...timeline, series: [], workerSeries: [] };
  const worker = scope.worker;
  return {
    ...timeline,
    series: [],
    workerSeries: timeline.workerSeries.filter(
      (series) =>
        series.worker.poolTag === worker.poolTag && series.worker.workerId === worker.workerId,
    ),
  };
}

function identityOf(scope: Scope): string | null {
  if (scope.kind === 'pool') return scope.poolTag;
  return scope.worker === null ? null : `${scope.worker.poolTag}-${scope.worker.workerId}`;
}

function subtitleOf(scope: Scope, timeline: KvOccupancyTimeline): string {
  if (scope.kind === 'pool') {
    return `${timeline.workerSeries.length} workers · pool: ${scope.poolTag ?? '—'}`;
  }
  if (scope.worker === null) return 'worker: —';
  return `worker: ${encodeURIComponent(scope.worker.poolTag)}/${encodeURIComponent(
    scope.worker.workerId,
  )}`;
}

function noteOf(scope: Scope): string | null {
  if (scope.kind === 'pool') {
    return scope.poolTag === null
      ? null
      : `scoped to ${scope.poolTag} pool; bold line is the pool average`;
  }
  return scope.worker === null ? null : 'selected worker only';
}

function emptyOf(scope: Scope): string {
  const identity = poolOf(scope) ?? 'selected';
  return `The KV subject has no cache series for the ${identity} scope.`;
}

function emptySubtitleOf(scope: Scope): string {
  const pool = poolOf(scope);
  return pool === null ? '—' : `pool: ${pool}`;
}

function poolOf(scope: Scope): string | null {
  return scope.kind === 'pool' ? scope.poolTag : (scope.worker?.poolTag ?? null);
}
