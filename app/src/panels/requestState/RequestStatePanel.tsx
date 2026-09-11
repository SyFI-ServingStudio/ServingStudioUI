/** Existing request-state charts reached through location-first artifact reads. */
import { useMemo } from 'react';

import {
  isPending,
  requestStateSeriesRef,
  useArtifact,
  type ArtifactResult,
  type RequestStateTimeline,
} from '../../artifacts';
import { segmentOf } from '../../location';
import { CHART_THEME } from '../../ui/charts/platform';
import ChartCard from '../../ui/controls/ChartCard';
import { workerOf } from '../coordinate';
import { describeRead } from '../readProblem';
import type { PanelProps } from '../types';
import {
  clusterRequestStateOption,
  poolRequestStateOption,
  workerRequestStateOption,
} from './option';

const CLUSTER_CAPTION =
  'Time-weighted request populations by lifecycle category. Legend items independently enable or disable stacked layers.';
const POOL_CAPTION =
  'Pending requests for the selected pool: total pool pressure, per-worker average, and every individual worker queue.';
const WORKER_CAPTION =
  'Request populations by lifecycle category for the selected worker. Categories independently enable or disable and re-stack in the browser.';

export function RunRequestStatePanel({ location }: PanelProps) {
  const state = useArtifact(useMemo(() => requestStateSeriesRef(location.ref), [location.ref]));
  if (state.status !== 'ready') {
    return (
      <Unavailable
        state={state}
        testId="request-state-run"
        title="Request state"
        caption={CLUSTER_CAPTION}
      />
    );
  }
  const categoryCount = state.value.clusterSeries.length;
  return (
    <ChartCard
      evidenceId="request-state"
      testId="request-state-run"
      idx="e"
      title="Request state"
      sub={`${categoryCount} categories · legend toggles each layer`}
      option={clusterRequestStateOption(
        state.value,
        CHART_THEME,
        location.focus.cursorMs === null ? undefined : location.focus.cursorMs / 1000,
      )}
      empty="No request-state categories."
      note="Click a legend item to show or hide that category."
      caption={CLUSTER_CAPTION}
    />
  );
}

export function PoolRequestStatePanel({ location }: PanelProps) {
  const poolTag = segmentOf(location.focus.path, 'pool')?.role ?? null;
  const state = useArtifact(useMemo(() => requestStateSeriesRef(location.ref), [location.ref]));
  if (state.status !== 'ready') {
    return (
      <Unavailable
        state={state}
        testId={`request-state-pool-${poolTag ?? 'missing'}`}
        title={`Request state · ${poolTag ?? '—'}`}
        caption={POOL_CAPTION}
      />
    );
  }
  const pool = state.value.pools.find((candidate) => candidate.poolTag === poolTag);
  return (
    <ChartCard
      evidenceId="request-state"
      testId={`request-state-pool-${poolTag ?? 'missing'}`}
      idx="e"
      title={`Request state · ${poolTag ?? '—'}`}
      sub={pool ? `${pool.workerCount} workers · aggregate + average + workers` : 'no pool series'}
      option={pool ? poolRequestStateOption(state.value, pool, CHART_THEME) : null}
      empty={pool ? undefined : `No request-state series for pool ${poolTag ?? 'selected'}.`}
      note={pool ? 'pool aggregate · worker average · individual workers' : null}
      caption={POOL_CAPTION}
    />
  );
}

export function WorkerRequestStatePanel({ location }: PanelProps) {
  const selected = workerOf(location.focus);
  const state = useArtifact(useMemo(() => requestStateSeriesRef(location.ref), [location.ref]));
  const testId = `request-state-worker-${selected?.poolTag ?? 'missing'}-${selected?.workerId ?? 'missing'}`;
  if (state.status !== 'ready') {
    return (
      <Unavailable state={state} testId={testId} title="Request state" caption={WORKER_CAPTION} />
    );
  }
  const worker =
    selected === null
      ? undefined
      : state.value.pools
          .flatMap((pool) => pool.workers)
          .find(
            (candidate) =>
              candidate.worker.poolTag === selected.poolTag &&
              candidate.worker.workerId === selected.workerId,
          );
  return (
    <ChartCard
      evidenceId="request-state"
      testId={testId}
      idx="e"
      title="Request state"
      sub={
        worker
          ? `${worker.worker.poolTag} / ${worker.worker.workerId} · ${worker.series.length} categories`
          : 'no worker series'
      }
      option={worker ? workerRequestStateOption(state.value, worker.series, CHART_THEME) : null}
      empty={worker ? undefined : 'No request-state series for the selected worker.'}
      note={worker ? 'Click a legend item to show or hide that category.' : null}
      caption={WORKER_CAPTION}
    />
  );
}

function Unavailable({
  state,
  testId,
  title,
  caption,
}: {
  state: Exclude<ArtifactResult<RequestStateTimeline>, { status: 'ready' }>;
  testId: string;
  title: string;
  caption: string;
}) {
  const problem = isPending(state)
    ? 'Loading request state…'
    : describeRead("This result's request-state subject", state)?.message;
  return (
    <ChartCard
      evidenceId="request-state"
      testId={testId}
      idx="e"
      title={title}
      sub={isPending(state) ? 'loading' : state.status.replace('_', ' ')}
      option={null}
      empty={problem}
      caption={caption}
    />
  );
}
