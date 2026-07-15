import { Box, Paper, Stack, Typography } from '@mui/material';
import { useViz } from '../../store';
import { useActiveRun, useActiveRunData } from '../../application/ActiveRunProvider';
import { metricView, METRIC_TITLES, METRIC_CAPTIONS } from '../../charts/metricOption';
import { utilizationOption, CHART_THEME } from '../../charts/options';
import { conservationFor } from '../../data/scopeData';
import ChartCard from '../ChartCard';
import ConservationCard from '../ConservationCard';
import KernelTimeBreakdownCard from '../KernelTimeBreakdownCard';
import { tokens } from '../../theme';

/** Whole-deployment outcome: SLO + throughput, scheduler backpressure,
 *  per-pool GPU utilization, kernel-time breakdown, and conservation. */
export default function ClusterStage() {
  const st = useViz();
  const run = useActiveRun();
  const activeData = useActiveRunData();
  const slo = metricView('slo', run, st);
  const tp = metricView('throughput', run, st);
  const backpressure = metricView('backpressure', run, st);
  const cons =
    run.payloads.conservation ?? (run.source.kind === 'synthetic' ? conservationFor(run) : null);

  const util = run.payloads.utilization;
  const pools = run.topology.pools;
  const poolUtilOption = (role: string) => {
    const series = util.series.filter(
      (item) =>
        item.poolTag === role ||
        (item.poolTag === undefined &&
          `${item.key} ${item.label}`.toLowerCase().includes(role.toLowerCase())),
    );
    return series.length ? utilizationOption({ t_ms: util.t_ms, series }, CHART_THEME) : null;
  };

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
          caption={METRIC_CAPTIONS.slo}
        />
        <ChartCard
          idx="b"
          title={METRIC_TITLES.throughput}
          sub={tp.sub}
          option={tp.option}
          caption={METRIC_CAPTIONS.throughput}
        />
      </Box>

      <ChartCard
        idx="c"
        title={METRIC_TITLES.backpressure}
        sub={backpressure.sub}
        option={backpressure.option}
        note={backpressure.note}
        empty={backpressure.note ?? undefined}
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
        {pools.map((p) => (
          <ChartCard
            key={p.role}
            idx="d"
            title={`GPU utilization · ${p.role}`}
            sub={`${p.groups.reduce((a, g) => a + g.numGpus, 0)} GPU`}
            option={poolUtilOption(p.role)}
            caption={`GPU busy fraction over the run window for the ${p.role} pool.`}
          />
        ))}
      </Box>

      <KernelTimeBreakdownCard
        idx="e"
        title="Cluster kernel time breakdown"
        subject={activeData.subjects.kernelTimeShare}
        scope={{ kind: 'cluster' }}
      />

      {cons ? (
        <ConservationCard idx="f" data={cons} />
      ) : (
        <Paper sx={{ borderRadius: 2, p: 2 }}>
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
            Workload conservation
          </Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 11, color: tokens.sub }}>
            Subject not generated for this simulation folder.
          </Typography>
        </Paper>
      )}
    </Stack>
  );
}
