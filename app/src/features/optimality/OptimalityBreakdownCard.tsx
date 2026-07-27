import type { SubjectResult } from '../../domain/subject';
import {
  hasReportableOptimality,
  projectOptimalityBreakdown,
  type OptimalityBreakdownProjection,
  type OptimalityScope,
} from './optimalityBreakdown';
import {
  OPTIMALITY_FAMILIES,
  OPTIMALITY_NECESSARY_WORK_FAMILIES,
  optimalityStackOption,
} from './optimalityOption';
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
  return (
    <OptimalityWaterfallCard
      idx={idx}
      title={title}
      projection={projection}
      separatePrimaryRowScale={scope.kind === 'pool'}
    />
  );
}

/** Render any already-projected optimality scope. Exact iteration resources use
 * this view directly so they share the aggregate waterfall visual contract. */
export function OptimalityWaterfallCard({
  idx,
  title,
  projection,
  separatePrimaryRowScale = false,
}: {
  idx?: string;
  title: string;
  projection: OptimalityBreakdownProjection;
  separatePrimaryRowScale?: boolean;
}) {
  if (projection.status !== 'ready') {
    return (
      <ChartCard
        evidenceId="optimality-breakdown"
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
  const necessaryRatio = projection.necessaryRatio;
  const hasNecessaryWork = necessaryRatio !== null;
  const sub =
    necessaryRatio !== null
      ? `${Math.round(necessaryRatio * 100)}% hardware-necessary`
      : `${Math.round(projection.optimalityRatio * 100)}% hardware-optimal`;
  const specNote = projection.gpuSpecMatched
    ? `roofline ${projection.gpuSpecMatched}`
    : `roofline unavailable (${projection.gpuName || 'unknown GPU'})`;
  const note = `${specNote} · batching ceiling: ${projection.peaksSource}`;
  const families = hasNecessaryWork ? OPTIMALITY_NECESSARY_WORK_FAMILIES : OPTIMALITY_FAMILIES;

  return (
    <ChartCard
      evidenceId="optimality-breakdown"
      idx={idx}
      title={title}
      sub={sub}
      option={
        reportable
          ? optimalityStackOption(projection.rows, families, CHART_THEME, {
              separatePrimaryRowScale,
            })
          : null
      }
      height={Math.max(separatePrimaryRowScale ? 270 : 180, projection.rows.length * 46 + 98)}
      note={reportable ? note : undefined}
      empty={reportable ? undefined : 'This scope recorded no GPU·seconds.'}
      caption={
        hasNecessaryWork
          ? "Necessary-work lower-bound ladder: R5 is further split into excess over per-op necessary work, cross-op fusion opportunity, and the global hardware-necessary floor. All bands telescope to the scope's total GPU·seconds."
          : "Distance from optimal GPU usage as a lower-bound ladder: each colored band is the GPU·seconds attributable to idle, load imbalance, small-batch loss, communication, kernel-vs-hardware gap, and the irreducible hardware-optimal floor. Bands telescope and sum to the scope's total GPU·seconds."
      }
    />
  );
}
