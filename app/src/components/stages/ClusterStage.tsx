import { useMemo } from 'react';
import { Box, Stack } from '@mui/material';
import { useViz } from '../../store';
import { useActiveRun, useActiveRunSubject } from '../../application/ActiveRunProvider';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import { metricView, METRIC_TITLES, METRIC_CAPTIONS } from '../../charts/metricOption';
import ChartCard from '../ChartCard';
import ConservationCard from '../ConservationCard';
import KernelTimeBreakdownCard from '../KernelTimeBreakdownCard';

/** Whole-deployment outcome: SLO + throughput, scheduler backpressure,
 *  per-pool GPU utilization, kernel-time breakdown, and conservation. */
export default function ClusterStage() {
  const scope = useViz((state) => state.scope);
  const poolRole = useViz((state) => state.poolRole);
  const workerKey = useViz((state) => state.workerKey);
  const cursorMs = useViz((state) => state.cursorMs);
  const run = useActiveRun();
  const sloSubject = useActiveRunSubject('slo');
  const throughputSubject = useActiveRunSubject('throughput');
  const utilizationSubject = useActiveRunSubject('utilization');
  const backpressureSubject = useActiveRunSubject('backpressure');
  const conservation = useActiveRunSubject('conservation');
  const kernelTimeShare = useActiveRunSubject('kernelTimeShare');
  const metricSelection = useMemo(
    () => ({ scope, poolRole, workerKey, cursorMs }),
    [scope, poolRole, workerKey, cursorMs],
  );
  const slo = metricView(sloSubject, run, metricSelection);
  const tp = metricView(throughputSubject, run, metricSelection);
  const backpressure = metricView(backpressureSubject, run, metricSelection);

  const pools = run.topology.pools;

  return (
    <Stack spacing={2}>
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 2 }}
      >
        <ChartCard
          idx="a"
          title={METRIC_TITLES.slo}
          sub={slo.sub}
          option={slo.option}
          empty={slo.empty}
          caption={METRIC_CAPTIONS.slo}
        />
        <ChartCard
          idx="b"
          title={METRIC_TITLES.throughput}
          sub={tp.sub}
          option={tp.option}
          empty={tp.empty}
          caption={METRIC_CAPTIONS.throughput}
        />
      </Box>

      <ChartCard
        idx="c"
        title={METRIC_TITLES.backpressure}
        sub={backpressure.sub}
        option={backpressure.option}
        note={backpressure.note}
        empty={backpressure.empty}
        caption={METRIC_CAPTIONS.backpressure}
      />

      {/* per-pool GPU utilization — one figure per pool */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: pools.length > 1 ? 'repeat(2,1fr)' : '1fr' },
          gap: 2,
        }}
      >
        {pools.map((p) => {
          const poolUtil = metricView(utilizationSubject, run, metricSelection, {
            poolRole: p.role,
          });
          return (
            <ChartCard
              key={p.role}
              idx="d"
              title={`GPU utilization · ${p.role}`}
              sub={
                utilizationSubject.status === 'ready'
                  ? `${p.groups.reduce((a, g) => a + g.numGpus, 0)} GPU`
                  : poolUtil.sub
              }
              option={poolUtil.option}
              empty={poolUtil.empty}
              caption={`GPU busy fraction over the run window for the ${p.role} pool.`}
            />
          );
        })}
      </Box>

      <KernelTimeBreakdownCard
        idx="e"
        title="Cluster kernel time breakdown"
        subject={kernelTimeShare}
        scope={{ kind: 'cluster' }}
      />

      {conservation.status === 'ready' ? (
        <ConservationCard idx="f" data={conservation.payload} />
      ) : (
        <ChartCard
          idx="f"
          title="Workload conservation"
          sub={subjectStatusLabel(conservation)}
          option={null}
          empty={subjectStatusMessage(conservation)}
          caption="Analyzer workload-conservation subject status."
        />
      )}
    </Stack>
  );
}
