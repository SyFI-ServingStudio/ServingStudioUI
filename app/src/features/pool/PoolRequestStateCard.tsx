import { useMemo } from 'react';

import { useActiveRunSubject } from '../../application/ActiveRunProvider';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';
import { poolRequestStateOption } from './poolRequestStateOption';

export default function PoolRequestStateCard({ poolTag }: { poolTag: string }) {
  const subject = useActiveRunSubject('requestState');
  const pool =
    subject.status === 'ready'
      ? subject.payload.pools.find((candidate) => candidate.poolTag === poolTag)
      : undefined;
  const option = useMemo(
    () =>
      subject.status === 'ready' && pool
        ? poolRequestStateOption(subject.payload, pool, CHART_THEME)
        : null,
    [pool, subject],
  );

  return (
    <ChartCard
      idx="e"
      title={`Request state · ${poolTag}`}
      sub={
        pool
          ? `${pool.workerCount} workers · aggregate + average + workers`
          : subject.status === 'ready'
            ? 'no pool series'
            : subjectStatusLabel(subject)
      }
      option={option}
      empty={
        subject.status === 'ready'
          ? `No request-state series for pool ${poolTag}.`
          : subjectStatusMessage(subject)
      }
      note={pool ? 'pool aggregate · worker average · individual workers' : null}
      caption="Pending requests for the selected pool: total pool pressure, per-worker average, and every individual worker queue."
    />
  );
}
