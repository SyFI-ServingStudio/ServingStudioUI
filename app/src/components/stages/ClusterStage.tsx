import { Box, Stack } from '@mui/material';
import { useViz } from '../../store';
import { useActiveRun, useActiveRunData } from '../../application/ActiveRunProvider';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import { metricView, METRIC_TITLES, METRIC_CAPTIONS } from '../../charts/metricOption';
import ChartCard from '../ChartCard';
import ConservationCard from '../ConservationCard';
import KernelTimeBreakdownCard from '../KernelTimeBreakdownCard';

/** Whole-deployment outcome: SLO + throughput, scheduler backpressure,
 *  per-pool GPU utilization, kernel-time breakdown, and conservation. */
export default function ClusterStage() {
  const st = useViz();
  const run = useActiveRun();
  const activeData = useActiveRunData();
  const slo = metricView(activeData.subjects.slo, run, st);
  const tp = metricView(activeData.subjects.throughput, run, st);
  const backpressure = metricView(activeData.subjects.backpressure, run, st);
  const conservation = activeData.subjects.conservation;

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
          const poolUtil = metricView(activeData.subjects.utilization, run, st, {
            poolRole: p.role,
          });
          return (
            <ChartCard
              key={p.role}
              idx="d"
              title={`GPU utilization · ${p.role}`}
              sub={
                activeData.subjects.utilization.status === 'ready'
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
        subject={activeData.subjects.kernelTimeShare}
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
