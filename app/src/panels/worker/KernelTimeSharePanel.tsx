import { useMemo } from 'react';

import {
  isPending,
  kernelTimeShareRef,
  useArtifact,
  workerKernelTimeShareRef,
} from '../../artifacts';
import { KERNEL_TIME_EPSILON_MS } from '../../artifacts/schema/kernelTimeShare';
import ChartCard from '../../ui/controls/ChartCard';
import { describeRead } from '../readProblem';
import type { PanelProps } from '../types';
import { workerOf } from '../coordinate';
import { projectWorkerComposition, workerLabel } from './composition';
import { workerKernelPositionOption } from './option';

const CAPTION =
  "Share of the selected worker's aggregate CostTree-root kernel time by family and manifest position. Hover reports only the selected chunk.";

export function KernelTimeSharePanel({ location }: PanelProps) {
  const worker = useMemo(
    () => workerOf(location.focus) ?? { poolTag: '', workerId: '' },
    [location.focus],
  );
  const aggregate = useArtifact(useMemo(() => kernelTimeShareRef(location.ref), [location.ref]));
  const scoped = useArtifact(
    useMemo(() => workerKernelTimeShareRef(location.ref, worker), [location.ref, worker]),
  );
  const workerKey = `${encodeURIComponent(worker.poolTag)}/${encodeURIComponent(worker.workerId)}`;
  const title = `Worker kernel time breakdown · ${workerKey}`;
  const testId = `kernel-time-worker-${worker.poolTag}-${worker.workerId}`;

  if (isPending(aggregate)) {
    return (
      <ChartCard
        evidenceId="kernel-position-breakdown"
        testId={testId}
        idx="f"
        title={title}
        sub="loading"
        option={null}
        empty="Loading kernel time…"
        caption={CAPTION}
      />
    );
  }
  if (aggregate.status !== 'ready') {
    return (
      <ChartCard
        evidenceId="kernel-position-breakdown"
        testId={testId}
        idx="f"
        title={title}
        sub={aggregate.status.replace('_', ' ')}
        option={null}
        empty={describeRead("This result's kernel-time-share subject", aggregate)?.message}
        caption={CAPTION}
      />
    );
  }

  const projection = projectWorkerComposition(
    aggregate.value,
    worker,
    scoped.status === 'ready' ? scoped.value : undefined,
  );

  if (projection.status === 'absent') {
    return (
      <ChartCard
        evidenceId="kernel-position-breakdown"
        testId={testId}
        idx="f"
        title={title}
        sub="scope missing"
        option={null}
        empty={projection.reason}
        caption={CAPTION}
      />
    );
  }
  if (isPending(scoped)) {
    return (
      <ChartCard
        evidenceId="kernel-position-breakdown"
        testId={testId}
        idx="f"
        title={title}
        sub="loading"
        option={null}
        empty="Loading kernel time…"
        caption={CAPTION}
      />
    );
  }
  if (projection.status === 'unread') {
    const problem = describeRead(`The composition of worker ${workerLabel(worker)}`, scoped);
    return (
      <ChartCard
        evidenceId="kernel-position-breakdown"
        testId={testId}
        idx="f"
        title={title}
        sub={scoped.status === 'ready' ? 'scope missing' : scoped.status.replace('_', ' ')}
        option={null}
        empty={
          problem?.message ??
          `Kernel-time-share composition for worker ${workerKey} has not been read.`
        }
        caption={CAPTION}
      />
    );
  }

  const value = projection.value;
  const hasKernelTime = value.kernelTimeMs > KERNEL_TIME_EPSILON_MS && value.slices.length > 0;
  const sub = value.mixtureExact
    ? 'all operations · exact position mix · exact total'
    : 'all operations · sampled position mix · exact total';
  const note = `${value.kernelTimeMs.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })} ms total · ${value.sampledRows.toLocaleString('en-US')} / ${value.rawRows.toLocaleString('en-US')} rows replayed`;
  return (
    <ChartCard
      evidenceId="kernel-position-breakdown"
      testId={testId}
      idx="f"
      title={title}
      sub={sub}
      option={hasKernelTime ? workerKernelPositionOption(value) : null}
      height={230}
      note={hasKernelTime ? note : undefined}
      empty={hasKernelTime ? undefined : 'This worker recorded no CostTree-root kernel time.'}
      caption={CAPTION}
    />
  );
}
