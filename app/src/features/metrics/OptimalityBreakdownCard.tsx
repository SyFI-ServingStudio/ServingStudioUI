import type { SubjectResult } from '../../domain/subject';
import {
  hasReportableOptimality,
  projectOptimalityBreakdown,
  type OptimalityBreakdownProjection,
  type OptimalityScope,
} from './optimalityBreakdown';
import { OPTIMALITY_FAMILIES, optimalityStackOption } from './optimalityOption';
import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';

function unavailableMessage(projection: OptimalityBreakdownProjection): string {
  if (projection.status === 'scope_missing') return projection.reason;
  if (projection.status === 'ready') return '';
  const reason = 'reason' in projection ? projection.reason : undefined;
  const code = 'code' in projection ? projection.code : undefined;
  return [
    `Optimality subject is ${projection.status.replace('_', ' ')}.`,
    code ? `[${code}]` : '',
    reason ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Shared cluster/pool card: the sub-optimality waterfall (idle / imbalance /
 * batching / communication / hardware-gap / hardware-optimal) in GPU·seconds,
 * one bar per scope row, anchored to the optimal floor. */
export default function OptimalityBreakdownCard({
  idx,
  title,
  subject,
  scope,
}: {
  idx?: string;
  title: string;
  subject: SubjectResult<'optimality'>;
  scope: OptimalityScope;
}) {
  const projection = projectOptimalityBreakdown(subject, scope);
  if (projection.status !== 'ready') {
    return (
      <ChartCard
        idx={idx}
        title={title}
        sub={projection.status.replace('_', ' ')}
        option={null}
        empty={unavailableMessage(projection)}
        caption="Analyzer optimality subject status for this scope."
      />
    );
  }

  const reportable = hasReportableOptimality(projection);
  const sub = `${Math.round(projection.optimalityRatio * 100)}% hardware-optimal`;
  const specNote = projection.gpuSpecMatched
    ? `roofline ${projection.gpuSpecMatched}`
    : `roofline unavailable (${projection.gpuName || 'unknown GPU'})`;
  const note = `${specNote} · batching ceiling: ${projection.peaksSource}`;
  const separatePoolScale = scope.kind === 'pool';

  return (
    <ChartCard
      idx={idx}
      title={title}
      sub={sub}
      option={
        reportable
          ? optimalityStackOption(projection.rows, OPTIMALITY_FAMILIES, CHART_THEME, {
              separatePrimaryRowScale: separatePoolScale,
            })
          : null
      }
      height={Math.max(separatePoolScale ? 270 : 180, projection.rows.length * 46 + 98)}
      note={reportable ? note : undefined}
      empty={reportable ? undefined : 'This scope recorded no GPU·seconds.'}
      caption="Distance from optimal GPU usage as a lower-bound ladder: each colored band is the GPU·seconds attributable to idle, load imbalance, small-batch loss, communication, kernel-vs-hardware gap, and the irreducible hardware-optimal floor. Bands telescope and sum to the scope's Real held GPU·seconds."
    />
  );
}
