import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';
import { OPTIMALITY_EPSILON_GPU_S } from '../../domain/optimality';
import type { KernelLadderProjection } from './optimalityKernelLadder';
import { optimalityKernelLadderOption } from './optimalityKernelLadderOption';

function unavailableMessage(projection: KernelLadderProjection): string {
  if (projection.status === 'scope_missing') return projection.reason;
  if (projection.status === 'ready') return '';
  const reason = 'reason' in projection ? projection.reason : undefined;
  return reason ?? `Optimality kernel ladder is ${projection.status.replace('_', ' ')}.`;
}

export default function OptimalityKernelLadderCard({
  idx,
  title,
  projection,
}: {
  idx?: string;
  title: string;
  projection: KernelLadderProjection;
}) {
  if (projection.status !== 'ready') {
    return (
      <ChartCard
        idx={idx}
        title={title}
        sub={projection.status.replace('_', ' ')}
        option={null}
        empty={unavailableMessage(projection)}
        caption="Optimality kernel ladder status for this scope."
      />
    );
  }
  const reportable = projection.rows.some((row) => row.total > OPTIMALITY_EPSILON_GPU_S);
  const sub = projection.kernelFilter
    ? `${projection.label} / ${projection.kernelFilter}`
    : `${projection.label} / ${projection.kernelNames.length} kernels`;
  return (
    <ChartCard
      idx={idx}
      title={title}
      sub={sub}
      option={reportable ? optimalityKernelLadderOption(projection, CHART_THEME) : null}
      height={Math.max(330, projection.rows.length * 38 + 90)}
      empty={reportable ? undefined : 'No kernel GPU·seconds are recorded for this scope.'}
      caption="R0-R5 optimality ladder. Every colored contribution is attributable to a simulator kernel; aggregate-only necessary-work bounds are shown in the separate iteration waterfall."
    />
  );
}
