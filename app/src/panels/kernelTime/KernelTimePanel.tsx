import { useMemo } from 'react';

import {
  isPending,
  kernelTimeShareRef,
  useArtifact,
  type ArtifactResult,
  type KernelTimeShare,
} from '../../artifacts';
import { segmentOf } from '../../location';
import { CHART_THEME } from '../../ui/charts/platform';
import ChartCard from '../../ui/controls/ChartCard';
import { describeRead } from '../readProblem';
import type { PanelProps } from '../types';
import {
  hasReportableKernelTime,
  poolBreakdown,
  runBreakdown,
  type KernelTimeBreakdownProjection,
  type ReadyKernelTimeBreakdown,
} from './breakdown';
import { kernelTimeStackOption } from './option';

const CAPTION_EXACT =
  'Critical-path share of analyzer CostTree-root wall-clock time by family. Scope totals and the family mixture are exact.';
const CAPTION_SAMPLED =
  'Critical-path share of analyzer CostTree-root wall-clock time by family. Scope totals are exact; the position/family mixture is estimated from the analyzer replay sample.';

export function RunKernelTimePanel({ location }: PanelProps) {
  const state = useArtifact(useMemo(() => kernelTimeShareRef(location.ref), [location.ref]));
  if (state.status !== 'ready') {
    return (
      <Unavailable state={state} testId="kernel-time-run" title="Cluster kernel time breakdown" />
    );
  }
  return (
    <BreakdownCard
      testId="kernel-time-run"
      title="Cluster kernel time breakdown"
      projection={runBreakdown(state.value)}
    />
  );
}

export function PoolKernelTimePanel({ location }: PanelProps) {
  const poolTag = segmentOf(location.focus.path, 'pool')?.role ?? null;
  const state = useArtifact(useMemo(() => kernelTimeShareRef(location.ref), [location.ref]));
  const title = `Kernel time breakdown · ${poolTag ?? '—'}`;
  const testId = `kernel-time-pool-${poolTag ?? 'missing'}`;
  if (state.status !== 'ready') {
    return <Unavailable state={state} testId={testId} title={title} />;
  }
  const projection: KernelTimeBreakdownProjection =
    poolTag === null
      ? { status: 'absent', reason: 'This address does not name a pool.' }
      : poolBreakdown(state.value, poolTag);
  if (projection.status === 'absent') {
    return (
      <ChartCard
        evidenceId="kernel-time-breakdown"
        testId={testId}
        idx="f"
        title={title}
        sub="scope missing"
        option={null}
        empty={projection.reason}
        caption="Analyzer kernel-time-share subject status for this scope."
      />
    );
  }
  return <BreakdownCard testId={testId} title={title} projection={projection} />;
}

function BreakdownCard({
  testId,
  title,
  projection,
}: {
  testId: string;
  title: string;
  projection: ReadyKernelTimeBreakdown;
}) {
  const hasKernelTime = hasReportableKernelTime(projection);
  const sampling = projection.sampling;
  const sub = projection.positionMixExact
    ? 'exact family mix · exact totals'
    : 'sampled family mix · exact totals';
  const samplingNote = projection.positionMixExact
    ? `all ${sampling.rawRows.toLocaleString('en-US')} worker rows replayed`
    : `${sampling.method} · ${sampling.sampledRows.toLocaleString('en-US')} / ${sampling.rawRows.toLocaleString('en-US')} worker rows replayed`;
  const totalNote = projection.rows
    .map(
      (row) => `${row.label} ${row.total.toLocaleString('en-US', { maximumFractionDigits: 2 })} ms`,
    )
    .join(' · ');
  return (
    <ChartCard
      evidenceId="kernel-time-breakdown"
      testId={testId}
      idx="f"
      title={title}
      sub={sub}
      option={hasKernelTime ? kernelTimeStackOption(projection, CHART_THEME) : null}
      height={Math.max(170, projection.rows.length * 48 + 74)}
      note={hasKernelTime ? `${totalNote} · ${samplingNote}` : undefined}
      empty={hasKernelTime ? undefined : 'This scope recorded no CostTree-root kernel time.'}
      caption={projection.positionMixExact ? CAPTION_EXACT : CAPTION_SAMPLED}
    />
  );
}

function Unavailable({
  state,
  testId,
  title,
}: {
  state: ArtifactResult<KernelTimeShare>;
  testId: string;
  title: string;
}) {
  const problem = isPending(state)
    ? 'Loading kernel time…'
    : describeRead("This result's kernel-time-share subject", state)?.message;
  return (
    <ChartCard
      evidenceId="kernel-time-breakdown"
      testId={testId}
      idx="f"
      title={title}
      sub={isPending(state) ? 'loading' : state.status.replace('_', ' ')}
      option={null}
      empty={problem}
      caption="Analyzer kernel-time-share subject status for this scope."
    />
  );
}
