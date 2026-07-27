import { useMemo } from 'react';
import { Stack } from '@mui/material';
import { useViz } from '../../store';
import { useActiveRun, useActiveRunSubject } from '../../application/ActiveRunProvider';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import ChartCard from '../../components/ChartCard';
import {
  KernelTimeBreakdownCard,
  SloChartRow,
  metricView,
  METRIC_TITLES,
  METRIC_CAPTIONS,
} from '../../metrics';
import ConservationCard from './ConservationCard';
import RequestStateCard from './RequestStateCard';

/** Whole-deployment outcome; scheduler backpressure sits immediately before
 * the kernel breakdown, which closes every aggregate Section 02 scope. */
export default function ClusterStage() {
  const scope = useViz((state) => state.scope);
  const poolRole = useViz((state) => state.poolRole);
  const workerKey = useViz((state) => state.workerKey);
  const cursorMs = useViz((state) => state.cursorMs);
  const run = useActiveRun();
  const sloSubject = useActiveRunSubject('slo');
  const throughputSubject = useActiveRunSubject('throughput');
  const utilizationSubject = useActiveRunSubject('utilization');
  const conservation = useActiveRunSubject('conservation');
  const kernelTimeShare = useActiveRunSubject('kernelTimeShare');
  const metricSelection = useMemo(
    () => ({ scope, poolRole, workerKey, cursorMs }),
    [scope, poolRole, workerKey, cursorMs],
  );
  const tp = metricView(throughputSubject, run, metricSelection);
  const clusterUtil = metricView(utilizationSubject, run, metricSelection);

  return (
    <Stack spacing={2}>
      <SloChartRow subject={sloSubject} />

      <ChartCard
        evidenceId="throughput"
        idx="b"
        title={METRIC_TITLES.throughput}
        sub={tp.sub}
        option={tp.option}
        empty={tp.empty}
        caption={METRIC_CAPTIONS.throughput}
      />

      <ChartCard
        evidenceId="utilization"
        idx="c"
        title="GPU utilization · all pools"
        sub={
          utilizationSubject.status === 'ready'
            ? `${utilizationSubject.payload.workerSeries.length} worker lines · ${utilizationSubject.payload.series.length} pool averages`
            : clusterUtil.sub
        }
        option={clusterUtil.option}
        empty={clusterUtil.empty}
        caption="GPU busy fraction over time for every worker; bold lines show each pool's average."
      />

      {conservation.status === 'ready' ? (
        <ConservationCard idx="d" data={conservation.payload} />
      ) : (
        <ChartCard
          evidenceId="workload-conservation"
          idx="d"
          title="Workload conservation"
          sub={subjectStatusLabel(conservation)}
          option={null}
          empty={subjectStatusMessage(conservation)}
          caption="Analyzer workload-conservation subject status."
        />
      )}

      <RequestStateCard idx="e" />

      <KernelTimeBreakdownCard
        idx="f"
        title="Cluster kernel time breakdown"
        subject={kernelTimeShare}
        scope={{ kind: 'cluster' }}
      />
    </Stack>
  );
}
