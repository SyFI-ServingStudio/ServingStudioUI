import type { SubjectResult } from '../../domain/subject';
import {
  hasReportableKernelTime,
  projectKernelTimeBreakdown,
  type KernelTimeBreakdownProjection,
  type KernelTimeBreakdownScope,
} from './kernelTimeBreakdown';
import { kernelTimeStackOption } from './options';
import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';

function unavailableMessage(projection: KernelTimeBreakdownProjection): string {
  if (projection.status === 'scope_missing') return projection.reason;
  if (projection.status === 'ready') return '';
  const reason = 'reason' in projection ? projection.reason : undefined;
  const code = 'code' in projection ? projection.code : undefined;
  return [
    `Kernel-time-share subject is ${projection.status.replace('_', ' ')}.`,
    code ? `[${code}]` : '',
    reason ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Shared cluster/pool card so both scopes preserve analyzer status and use the
 * exact same family taxonomy and sampling disclosure. */
export default function KernelTimeBreakdownCard({
  idx,
  title,
  subject,
  scope,
}: {
  idx: string;
  title: string;
  subject: SubjectResult<'kernelTimeShare'>;
  scope: KernelTimeBreakdownScope;
}) {
  const projection = projectKernelTimeBreakdown(subject, scope);
  if (projection.status !== 'ready') {
    return (
      <ChartCard
        idx={idx}
        title={title}
        sub={projection.status.replace('_', ' ')}
        option={null}
        empty={unavailableMessage(projection)}
        caption="Analyzer kernel-time-share subject status for this scope."
      />
    );
  }

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
  const note = `${totalNote} · ${samplingNote}`;
  const caption = projection.positionMixExact
    ? 'Share of analyzer CostTree-root kernel time by family. Overall and pool totals, and the family mixture, are exact.'
    : 'Share of analyzer CostTree-root kernel time by family. Scope totals are exact; the position/family mixture is estimated from the analyzer replay sample.';

  return (
    <ChartCard
      idx={idx}
      title={title}
      sub={sub}
      option={hasKernelTime ? kernelTimeStackOption(projection, CHART_THEME) : null}
      height={Math.max(170, projection.rows.length * 48 + 74)}
      note={hasKernelTime ? note : undefined}
      empty={hasKernelTime ? undefined : 'This pool recorded no CostTree-root kernel time.'}
      caption={caption}
    />
  );
}
