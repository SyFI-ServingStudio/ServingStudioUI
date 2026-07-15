import { Box, Stack } from '@mui/material';
import { useViz, currentRun, cursorSeconds, poolInScope } from '../../store';
import { metricView, METRIC_TITLES, METRIC_CAPTIONS } from '../../charts/metricOption';
import { batchOption, CHART_THEME } from '../../charts/options';
import { batchFor } from '../../data/scopeData';
import ChartCard from '../ChartCard';
import WorkersInPool from '../WorkersInPool';

/** Pool-level resource behaviour: utilization + KV + queue pressure + batch, then drill. */
export default function PoolStage() {
  const st = useViz();
  const run = currentRun(st);
  const role = poolInScope(st) ?? st.poolRole ?? '—';
  const util = metricView('utilization', st);
  const kv = metricView('kv', st);
  const backpressure = metricView('backpressure', st);
  const batch = batchFor(run, role);
  const cS = cursorSeconds(st);

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 2 }}>
        <ChartCard idx="a" title={METRIC_TITLES.utilization} sub={util.sub} option={util.option} note={util.note} caption={METRIC_CAPTIONS.utilization} empty={util.note ?? undefined} />
        <ChartCard idx="b" title={METRIC_TITLES.kv} sub={kv.sub} option={kv.option} note={kv.note} caption={METRIC_CAPTIONS.kv} empty={kv.note ?? undefined} />
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
      <ChartCard
        idx="d" title="Batch composition" sub={`pool: ${role}`}
        option={batchOption(batch, CHART_THEME, cS)}
        note="prefill ∥ decode tokens per step · concurrent decode requests (right axis)"
        caption="Batched tokens per scheduler step, split into prefill vs decode, with the number of concurrent decode requests on the right axis. Shows how the pool fills its token budget over the run."
      />
      <WorkersInPool idx="e" role={role} />
    </Stack>
  );
}
