import { useMemo } from 'react';

import { useActiveRunSubject } from '../../application/ActiveRunProvider';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';
import { makeWorkerKey, type WorkerKey } from '../../domain/worker';
import { workerRequestStateOption } from './workerRequestStateOption';

export default function WorkerRequestStateCard({ workerKey }: { workerKey: WorkerKey }) {
  const subject = useActiveRunSubject('requestState');
  const worker =
    subject.status === 'ready'
      ? subject.payload.pools
          .flatMap((pool) => pool.workers)
          .find((candidate) => makeWorkerKey(candidate.worker) === workerKey)
      : undefined;
  const option = useMemo(
    () =>
      subject.status === 'ready' && worker
        ? workerRequestStateOption(subject.payload, worker.series, CHART_THEME)
        : null,
    [subject, worker],
  );

  return (
    <ChartCard
      evidenceId="request-state"
      idx="e"
      title="Request state"
      sub={
        worker
          ? `${worker.worker.poolTag} / ${worker.worker.workerId} · ${worker.series.length} categories`
          : subject.status === 'ready'
            ? 'no worker series'
            : subjectStatusLabel(subject)
      }
      option={option}
      empty={
        subject.status === 'ready'
          ? 'No request-state series for the selected worker.'
          : subjectStatusMessage(subject)
      }
      note={worker ? 'Click a legend item to show or hide that category.' : null}
      caption="Request populations by lifecycle category for the selected worker. Categories independently enable or disable and re-stack in the browser."
    />
  );
}
