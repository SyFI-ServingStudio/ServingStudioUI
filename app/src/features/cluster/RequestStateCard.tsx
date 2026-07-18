import { useMemo } from 'react';

import { useActiveRunSubject } from '../../application/ActiveRunProvider';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';
import { useViz } from '../../store';
import { clusterRequestStateOption } from './requestStateOption';

export default function RequestStateCard({ idx }: { idx: string }) {
  const subject = useActiveRunSubject('requestState');
  const cursorMs = useViz((state) => state.cursorMs);
  const option = useMemo(
    () =>
      subject.status === 'ready'
        ? clusterRequestStateOption(
            subject.payload,
            CHART_THEME,
            cursorMs === null ? undefined : cursorMs / 1000,
          )
        : null,
    [cursorMs, subject],
  );
  const categoryCount = subject.status === 'ready' ? subject.payload.clusterSeries.length : 0;

  return (
    <ChartCard
      idx={idx}
      title="Request state"
      sub={
        subject.status === 'ready'
          ? `${categoryCount} categories · legend toggles each layer`
          : subjectStatusLabel(subject)
      }
      option={option}
      empty={
        subject.status === 'ready' ? 'No request-state categories.' : subjectStatusMessage(subject)
      }
      note={
        subject.status === 'ready' ? 'Click a legend item to show or hide that category.' : null
      }
      caption="Time-weighted request populations by lifecycle category. Legend items independently enable or disable stacked layers."
    />
  );
}
