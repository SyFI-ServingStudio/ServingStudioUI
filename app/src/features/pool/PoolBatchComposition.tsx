import { Box } from '@mui/material';
import { useMemo } from 'react';

import { useActiveRun, useActiveRunSubject } from '../../application/ActiveRunProvider';
import { cursorSeconds } from '../../application/runSelection';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';
import { useViz } from '../../store';
import { poolBatchMetricOption } from '../../metrics';
import { buildPoolBatchSnapshots } from './poolBatchSnapshots';

const CARD_SPECS = [
  {
    idx: 'd1',
    title: 'Total batch tokens',
    metric: 'total_tokens' as const,
    caption:
      "Wall-clock pool snapshot of total logical tokens. Aggregate sums every worker's latest sampled invocation; average divides that sum by the pool worker count.",
  },
  {
    idx: 'd2',
    title: 'Prefill tokens',
    metric: 'prefill_tokens' as const,
    caption:
      "Wall-clock pool snapshot of prompt tokens. Aggregate sums every worker's latest sampled invocation; average divides that sum by the pool worker count.",
  },
  {
    idx: 'd3',
    title: 'Decode requests',
    metric: 'decode_requests' as const,
    caption:
      "Wall-clock pool snapshot of participating decode requests. Aggregate sums every worker's latest sampled invocation; average divides that sum by the pool worker count.",
  },
] as const;

export default function PoolBatchComposition({ poolTag }: { poolTag: string }) {
  const run = useActiveRun();
  const subject = useActiveRunSubject('batch');
  const cursorMs = useViz((state) => state.cursorMs);
  const poolWorkers = useMemo(
    () =>
      subject.status === 'ready'
        ? subject.payload.workers.filter((worker) => worker.worker.poolTag === poolTag)
        : [],
    [poolTag, subject],
  );
  const snapshots = useMemo(() => buildPoolBatchSnapshots(poolWorkers), [poolWorkers]);
  const roster = run.workerList.filter((worker) => worker.pool === poolTag);
  const routedTotalOnly =
    roster.length > 0 && roster.every((worker) => worker.workerType === 'disagg_ffn');
  const cursorS = cursorSeconds({ cursorMs });

  const subjectEmpty =
    subject.status === 'ready'
      ? `The batch payload has no worker series for pool ${poolTag}. Re-run analysis with worker batch publication enabled.`
      : subjectStatusMessage(subject);

  return (
    <Box
      component="section"
      aria-label={`Pool batch composition · ${poolTag}`}
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' }, gap: 2 }}
    >
      {CARD_SPECS.map((spec) => {
        const routedMetricUnavailable = routedTotalOnly && spec.metric !== 'total_tokens';
        const unavailable = routedMetricUnavailable
          ? 'FFN cost logs retain only routed total tokens; prefill/decode attribution is unavailable.'
          : snapshots === null
            ? subjectEmpty
            : null;
        return (
          <ChartCard
            key={spec.metric}
            evidenceId={`batch:${spec.metric}`}
            idx={spec.idx}
            title={spec.title}
            sub={
              unavailable
                ? routedMetricUnavailable
                  ? 'unavailable for this pool kind'
                  : subject.status === 'ready'
                    ? 'ready · worker detail unavailable'
                    : subjectStatusLabel(subject)
                : `pool: ${poolTag} · ${snapshots?.workerCount ?? 0} workers`
            }
            option={
              snapshots && !unavailable
                ? poolBatchMetricOption(
                    snapshots.aggregate,
                    snapshots.average,
                    spec.metric,
                    CHART_THEME,
                    cursorS,
                  )
                : null
            }
            note={unavailable ? null : 'pool aggregate ∥ pool average · wall-clock snapshot'}
            empty={unavailable ?? undefined}
            caption={spec.caption}
          />
        );
      })}
    </Box>
  );
}
