/** Existing utilization charts reached through location-first artifact reads. */
import { useMemo } from 'react';

import {
  isPending,
  utilizationSeriesRef,
  useArtifact,
  type UtilizationTimeline,
  type WorkerCoordinate,
} from '../../artifacts';
import { segmentOf } from '../../location';
import { CHART_THEME } from '../../ui/charts/platform';
import ChartCard from '../../ui/controls/ChartCard';
import { workerOf } from '../coordinate';
import { describeRead } from '../readProblem';
import type { PanelProps } from '../types';
import { utilizationOption } from './option';

const TITLE = 'GPU utilization';
const CAPTION = 'Per-worker GPU busy fraction over time, with bold pool-average lines.';
const CLUSTER_CAPTION =
  "GPU busy fraction over time for every worker; bold lines show each pool's average.";

export function RunUtilizationPanel(props: PanelProps) {
  return <UtilizationPanel {...props} scope={{ kind: 'run' }} />;
}

export function PoolUtilizationPanel(props: PanelProps) {
  const pool = segmentOf(props.location.focus.path, 'pool');
  return <UtilizationPanel {...props} scope={{ kind: 'pool', poolTag: pool?.role ?? null }} />;
}

export function WorkerUtilizationPanel(props: PanelProps) {
  return (
    <UtilizationPanel
      {...props}
      scope={{ kind: 'worker', worker: workerOf(props.location.focus) }}
    />
  );
}

type Scope =
  | { readonly kind: 'run' }
  | { readonly kind: 'pool'; readonly poolTag: string | null }
  | { readonly kind: 'worker'; readonly worker: WorkerCoordinate | null };

function UtilizationPanel({ location, scope }: PanelProps & { scope: Scope }) {
  const state = useArtifact(useMemo(() => utilizationSeriesRef(location.ref), [location.ref]));
  const presentation = presentationFor(scope);

  if (isPending(state)) {
    return (
      <ChartCard
        evidenceId="utilization"
        testId={presentation.testId}
        idx={presentation.idx}
        title={presentation.title}
        sub="loading"
        option={null}
        empty="Loading utilization…"
      />
    );
  }
  if (state.status !== 'ready') {
    const problem = describeRead("This result's utilization subject", state);
    return (
      <ChartCard
        evidenceId="utilization"
        testId={presentation.testId}
        idx={presentation.idx}
        title={presentation.title}
        sub={state.status.replace('_', ' ')}
        option={null}
        empty={problem?.message}
        caption={presentation.caption}
      />
    );
  }

  const timeline = scopedTimeline(state.value, scope);
  const option =
    timeline.series.length === 0 && timeline.workerSeries.length === 0
      ? null
      : utilizationOption(
          timeline,
          CHART_THEME,
          location.focus.cursorMs === null ? undefined : location.focus.cursorMs / 1000,
        );

  return (
    <ChartCard
      evidenceId="utilization"
      testId={presentation.testId}
      idx={presentation.idx}
      title={presentation.title}
      sub={subtitleFor(scope, timeline)}
      option={option}
      note={noteFor(scope)}
      caption={presentation.caption}
      empty={option === null ? emptyFor(scope) : undefined}
    />
  );
}

function scopedTimeline(timeline: UtilizationTimeline, scope: Scope): UtilizationTimeline {
  if (scope.kind === 'run') return timeline;
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
    workerSeries: timeline.workerSeries.filter((series) => sameWorker(series.worker, worker)),
  };
}

function sameWorker(left: WorkerCoordinate, right: WorkerCoordinate): boolean {
  return left.poolTag === right.poolTag && left.workerId === right.workerId;
}

function presentationFor(scope: Scope): {
  testId: string;
  idx: string;
  title: string;
  caption: string;
} {
  if (scope.kind === 'run') {
    return {
      testId: 'utilization-run',
      idx: 'c',
      title: `${TITLE} · all pools`,
      caption: CLUSTER_CAPTION,
    };
  }
  if (scope.kind === 'pool') {
    return {
      testId: `utilization-pool-${scope.poolTag ?? 'missing'}`,
      idx: 'a',
      title: TITLE,
      caption: CAPTION,
    };
  }
  const identity = scope.worker && `${scope.worker.poolTag}-${scope.worker.workerId}`;
  return {
    testId: `utilization-worker-${identity ?? 'missing'}`,
    idx: 'a',
    title: TITLE,
    caption: CAPTION,
  };
}

function subtitleFor(scope: Scope, timeline: UtilizationTimeline): string {
  if (scope.kind === 'run') {
    return `${timeline.workerSeries.length} worker lines · ${timeline.series.length} pool averages`;
  }
  if (scope.kind === 'pool') {
    return `${timeline.workerSeries.length} workers · pool: ${scope.poolTag ?? '—'}`;
  }
  return scope.worker === null
    ? 'worker: —'
    : `worker: ${encodeURIComponent(scope.worker.poolTag)}/${encodeURIComponent(
        scope.worker.workerId,
      )}`;
}

function noteFor(scope: Scope): string | null {
  if (scope.kind === 'run') return null;
  if (scope.kind === 'pool') {
    return scope.poolTag === null
      ? null
      : `scoped to ${scope.poolTag} pool; bold line is the pool average`;
  }
  return scope.worker === null ? null : 'selected worker only';
}

function emptyFor(scope: Scope): string {
  if (scope.kind === 'run')
    return 'The utilization subject has no GPU series for the selected scope.';
  if (scope.kind === 'pool') {
    return `The utilization subject has no GPU series for the ${scope.poolTag ?? 'selected'} scope.`;
  }
  return `The utilization subject has no GPU series for the ${
    scope.worker === null ? 'selected' : `${scope.worker.poolTag}/${scope.worker.workerId}`
  } scope.`;
}
