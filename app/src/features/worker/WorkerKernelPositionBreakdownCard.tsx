import { useActiveRunSubject } from '../../application/ActiveRunProvider';
import ChartCard from '../../components/ChartCard';
import { KERNEL_TIME_EPSILON_MS } from '../../domain/kernelTimeShare';
import type { WorkerKey } from '../../domain/worker';
import { projectKernelTimeBreakdown } from '../metrics/kernelTimeBreakdown';
import {
  projectWorkerKernelPositions,
  type WorkerKernelPositionBreakdown,
} from './workerKernelTimeBreakdown';
import { workerKernelPositionOption } from './workerKernelPositionOption';

function unavailableMessage(projection: WorkerKernelPositionBreakdown): string {
  if (projection.status === 'scope_missing') return projection.reason;
  if (projection.status === 'ready') return '';
  return 'reason' in projection && projection.reason
    ? projection.reason
    : `Kernel-time-share subject is ${projection.status.replace('_', ' ')}.`;
}

export default function WorkerKernelPositionBreakdownCard({ workerKey }: { workerKey: WorkerKey }) {
  const subject = useActiveRunSubject('kernelTimeShare');
  const positions = projectWorkerKernelPositions(subject, workerKey);
  const families = projectKernelTimeBreakdown(subject, { kind: 'worker', workerKey });

  if (positions.status !== 'ready') {
    return (
      <ChartCard
        idx="f"
        title={`Worker kernel time breakdown · ${workerKey}`}
        sub={positions.status.replace('_', ' ')}
        option={null}
        empty={unavailableMessage(positions)}
        caption="Analyzer kernel-time-share composition for the selected worker."
      />
    );
  }
  if (families.status !== 'ready') {
    return (
      <ChartCard
        idx="f"
        title={`Worker kernel time breakdown · ${workerKey}`}
        sub={families.status.replace('_', ' ')}
        option={null}
        empty={'reason' in families ? families.reason : 'Kernel-family composition is unavailable.'}
        caption="Analyzer kernel-time-share composition for the selected worker."
      />
    );
  }

  const hasKernelTime =
    positions.totalMs > KERNEL_TIME_EPSILON_MS && positions.positions.length > 0;
  const sub = positions.positionMixExact
    ? 'all operations · exact position mix · exact total'
    : 'all operations · sampled position mix · exact total';
  const note = `${positions.totalMs.toLocaleString('en-US', { maximumFractionDigits: 2 })} ms total · ${positions.sampledRows.toLocaleString('en-US')} / ${positions.rawRows.toLocaleString('en-US')} rows replayed`;
  return (
    <ChartCard
      idx="f"
      title={`Worker kernel time breakdown · ${workerKey}`}
      sub={sub}
      option={hasKernelTime ? workerKernelPositionOption(positions, families) : null}
      height={230}
      note={hasKernelTime ? note : undefined}
      empty={hasKernelTime ? undefined : 'This worker recorded no CostTree-root kernel time.'}
      caption="Share of the selected worker's aggregate CostTree-root kernel time by family and manifest position. Hover reports only the selected chunk."
    />
  );
}
