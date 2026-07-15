import { Box, Paper, Stack, Typography } from '@mui/material';
import { useViz, currentRun } from '../../store';
import { metricView, METRIC_TITLES, METRIC_CAPTIONS } from '../../charts/metricOption';
import { utilizationOption, clusterKernelStackOption, CHART_THEME } from '../../charts/options';
import { conservationFor, clusterKernelBreakdown } from '../../data/scopeData';
import ChartCard from '../ChartCard';
import ConservationCard from '../ConservationCard';
import { tokens } from '../../theme';

/** Whole-deployment outcome: SLO + throughput, scheduler backpressure,
 *  per-pool GPU utilization, kernel-time breakdown, and conservation. */
export default function ClusterStage() {
  const st = useViz();
  const run = currentRun(st);
  const slo = metricView('slo', st);
  const tp = metricView('throughput', st);
  const backpressure = metricView('backpressure', st);
  const cons = run.payloads.conservation
    ?? (run.source.kind === 'synthetic' ? conservationFor(run) : null);
  const kbreak = clusterKernelBreakdown(run);

  const util = run.payloads.utilization;
  const pools = run.topology.pools;
  const poolUtilOption = (role: string) => {
    const series = util.series.filter((item) => item.poolTag === role
      || (item.poolTag === undefined && `${item.key} ${item.label}`.toLowerCase().includes(role.toLowerCase())));
    return series.length ? utilizationOption({ t_ms: util.t_ms, series }, CHART_THEME) : null;
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 2 }}>
        <ChartCard idx="a" title={METRIC_TITLES.slo} sub={slo.sub} option={slo.option} caption={METRIC_CAPTIONS.slo} />
        <ChartCard idx="b" title={METRIC_TITLES.throughput} sub={tp.sub} option={tp.option} caption={METRIC_CAPTIONS.throughput} />
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
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: pools.length > 1 ? 'repeat(2,1fr)' : '1fr' }, gap: 2 }}>
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

      {/* cluster-wide kernel time breakdown — stacked by kernel family */}
      <ChartCard
        idx="e"
        title="Cluster kernel time breakdown"
        sub="share by family · all GPUs"
        option={clusterKernelStackOption(kbreak, CHART_THEME)}
        height={Math.max(170, kbreak.rows.length * 48 + 74)}
        note="hover a segment for its %"
        caption="Share of GPU·kernel time by family (GEMM / attention / collectives / norm / routing), counted across ALL GPUs — each worker's batched-iteration cost is weighted by its GPU count and summed. The 'cluster' bar is the whole deployment (so the 32-GPU ffn pool weighs more than an 8-GPU attn pool); per-pool bars show each pool's own mix."
      />

      {cons ? (
        <ConservationCard idx="f" data={cons} />
      ) : (
        <Paper sx={{ borderRadius: 2, p: 2 }}>
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>Workload conservation</Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 11, color: tokens.sub }}>
            Subject not generated for this simulation folder.
          </Typography>
        </Paper>
      )}
    </Stack>
  );
}
