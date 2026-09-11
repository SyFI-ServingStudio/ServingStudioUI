/** Existing pool and worker batch charts reached through location-first reads. */
import { Box } from '@mui/material';
import { useMemo } from 'react';

import { batchSeriesRef, isPending, topologyRef, useArtifact } from '../../artifacts';
import { segmentOf } from '../../location';
import { CHART_THEME } from '../../ui/charts/platform';
import ChartCard from '../../ui/controls/ChartCard';
import { workerOf } from '../coordinate';
import { describeRead } from '../readProblem';
import type { PanelProps } from '../types';
import {
  batchChartSeries,
  batchMetricOption,
  poolBatchMetricOption,
  type BatchChartMetric,
} from './option';
import { buildPoolBatchSnapshots } from './snapshots';

interface CardSpec {
  readonly idx: string;
  readonly title: string;
  readonly metric: BatchChartMetric;
  readonly poolCaption: string;
  readonly workerCaption: string;
}

const CARDS: readonly CardSpec[] = [
  {
    idx: 'd1',
    title: 'Total batch tokens',
    metric: 'total_tokens',
    poolCaption:
      "Wall-clock pool snapshot of total logical tokens. Aggregate sums every worker's latest sampled invocation; average divides that sum by the pool worker count.",
    workerCaption:
      'Total logical tokens in each sampled worker invocation. For FFN this is the routed-token total.',
  },
  {
    idx: 'd2',
    title: 'Prefill tokens',
    metric: 'prefill_tokens',
    poolCaption:
      "Wall-clock pool snapshot of prompt tokens. Aggregate sums every worker's latest sampled invocation; average divides that sum by the pool worker count.",
    workerCaption: 'New prompt tokens processed by each sampled attention or iter-wise invocation.',
  },
  {
    idx: 'd3',
    title: 'Decode requests',
    metric: 'decode_requests',
    poolCaption:
      "Wall-clock pool snapshot of participating decode requests. Aggregate sums every worker's latest sampled invocation; average divides that sum by the pool worker count.",
    workerCaption:
      'Decode sequences participating in each sampled attention or iter-wise invocation; standard one-token decode makes this equal to decode tokens.',
  },
];

export function PoolBatchPanel({ location }: PanelProps) {
  const poolTag = segmentOf(location.focus.path, 'pool')?.role ?? null;
  const batch = useArtifact(useMemo(() => batchSeriesRef(location.ref), [location.ref]));
  const topology = useArtifact(useMemo(() => topologyRef(location.ref), [location.ref]));
  const workers =
    batch.status === 'ready' && poolTag !== null
      ? batch.value.workers.filter((worker) => worker.poolTag === poolTag)
      : [];
  const snapshots = buildPoolBatchSnapshots(workers);
  const workerType =
    topology.status === 'ready'
      ? topology.value.pools.find((pool) => pool.tag === poolTag)?.group.workerType
      : null;
  const readProblem =
    !isPending(batch) && batch.status !== 'ready'
      ? describeRead("This result's batch subject", batch)?.message
      : null;
  const topologyProblem =
    !isPending(topology) && topology.status !== 'ready'
      ? describeRead("This result's topology subject", topology)?.message
      : null;
  const topologyEmpty =
    topology.status === 'ready'
      ? null
      : (topologyProblem ??
        (isPending(topology)
          ? 'Loading worker-kind metadata…'
          : 'Worker-kind metadata is unavailable.'));
  const subjectEmpty =
    readProblem ??
    (isPending(batch)
      ? 'Loading batch composition…'
      : `The batch payload has no worker series for pool ${poolTag ?? 'selected'}. Re-run analysis with worker batch publication enabled.`);

  return (
    <Box
      component="section"
      aria-label={`Pool batch composition · ${poolTag ?? '—'}`}
      data-testid={`batch-pool-${poolTag ?? 'missing'}`}
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' }, gap: 2 }}
    >
      {CARDS.map((spec) => {
        const routedUnavailable = workerType === 'disagg_ffn' && spec.metric !== 'total_tokens';
        const unavailable =
          topologyEmpty ??
          (routedUnavailable
            ? 'FFN cost logs retain only routed total tokens; prefill/decode attribution is unavailable.'
            : snapshots === null
              ? subjectEmpty
              : null);
        return (
          <ChartCard
            evidenceId={`batch:${spec.metric}`}
            key={spec.metric}
            testId={`batch-pool-${spec.metric}`}
            idx={spec.idx}
            title={spec.title}
            sub={
              topology.status === 'ready'
                ? poolSubtitle(batch.status, poolTag, snapshots?.workerCount, routedUnavailable)
                : isPending(topology)
                  ? 'loading'
                  : topology.status.replace('_', ' ')
            }
            option={
              snapshots === null || unavailable !== null
                ? null
                : poolBatchMetricOption(
                    snapshots.aggregate,
                    snapshots.average,
                    spec.metric,
                    CHART_THEME,
                    cursorSeconds(location.focus.cursorMs),
                  )
            }
            note={
              unavailable === null ? 'pool aggregate ∥ pool average · wall-clock snapshot' : null
            }
            empty={unavailable ?? undefined}
            caption={spec.poolCaption}
          />
        );
      })}
    </Box>
  );
}

export function WorkerBatchPanel({ location }: PanelProps) {
  const worker = workerOf(location.focus);
  const batch = useArtifact(useMemo(() => batchSeriesRef(location.ref), [location.ref]));
  const topology = useArtifact(useMemo(() => topologyRef(location.ref), [location.ref]));
  const series =
    batch.status === 'ready' && worker !== null
      ? batch.value.workers.find(
          (entry) => entry.poolTag === worker.poolTag && entry.workerId === worker.workerId,
        )
      : undefined;
  const workerKey =
    worker === null
      ? '—'
      : `${encodeURIComponent(worker.poolTag)}/${encodeURIComponent(worker.workerId)}`;
  const workerType =
    topology.status === 'ready' && worker !== null
      ? topology.value.pools.find((pool) => pool.tag === worker.poolTag)?.group.workerType
      : null;

  if (series === undefined) {
    const problem =
      !isPending(batch) && batch.status !== 'ready'
        ? describeRead("This result's batch subject", batch)?.message
        : null;
    return (
      <ChartCard
        evidenceId="batch"
        testId="batch-worker-empty"
        idx="d"
        title="Batch composition"
        sub={
          isPending(batch)
            ? 'loading'
            : batch.status === 'ready'
              ? 'ready · worker detail unavailable'
              : batch.status.replace('_', ' ')
        }
        option={null}
        empty={
          problem ??
          (isPending(batch)
            ? 'Loading batch composition…'
            : `The batch payload has no series for worker ${workerKey}. Re-run analysis with worker batch publication enabled.`)
        }
        caption="Worker-level sampled batch composition."
      />
    );
  }

  const projected = batchChartSeries(series);
  return (
    <Box
      component="section"
      aria-label={`Batch composition · ${workerKey}`}
      data-testid="batch-worker"
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' }, gap: 2 }}
    >
      {CARDS.map((spec) => {
        const topologyProblem =
          !isPending(topology) && topology.status !== 'ready'
            ? describeRead("This result's topology subject", topology)?.message
            : null;
        const unavailable =
          topology.status !== 'ready'
            ? (topologyProblem ?? 'Waiting for prefetched worker-kind metadata.')
            : workerType === 'disagg_ffn' && spec.metric !== 'total_tokens'
              ? 'FFN cost logs retain only routed total tokens; prefill/decode attribution is unavailable.'
              : null;
        return (
          <ChartCard
            evidenceId={`batch:${spec.metric}`}
            key={spec.metric}
            testId={`batch-worker-${spec.metric}`}
            idx={spec.idx}
            title={spec.title}
            sub={unavailable ? 'unavailable for this worker kind' : `worker: ${workerKey}`}
            option={
              unavailable
                ? null
                : batchMetricOption(
                    projected,
                    spec.metric,
                    CHART_THEME,
                    cursorSeconds(location.focus.cursorMs),
                  )
            }
            empty={unavailable ?? undefined}
            note={unavailable ? null : 'selected worker · sampled invocations'}
            caption={spec.workerCaption}
          />
        );
      })}
    </Box>
  );
}

function poolSubtitle(
  status: string,
  poolTag: string | null,
  workerCount: number | undefined,
  routedUnavailable: boolean,
): string {
  if (routedUnavailable) return 'unavailable for this pool kind';
  if (workerCount !== undefined) return `pool: ${poolTag} · ${workerCount} workers`;
  if (status === 'ready') return 'ready · worker detail unavailable';
  return status.replace('_', ' ');
}

function cursorSeconds(cursorMs: number | null): number | undefined {
  return cursorMs === null ? undefined : cursorMs / 1000;
}
