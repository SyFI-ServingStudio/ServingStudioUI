import { Box, Stack } from '@mui/material';
import { useViz } from '../../store';
import { cursorSeconds, poolInScope } from '../../application/runSelection';
import { useActiveRun } from '../../application/ActiveRunProvider';
import { metricView, METRIC_TITLES, METRIC_CAPTIONS } from '../../charts/metricOption';
import { batchOption, CHART_THEME } from '../../charts/options';
import { batchFor } from '../../data/scopeData';
import ChartCard from '../ChartCard';
import WorkersInPool from '../WorkersInPool';

/** Pool-level resource behaviour: utilization + KV + queue pressure + batch, then drill. */
export default function PoolStage() {
  const st = useViz();
  const run = useActiveRun();
  const role = poolInScope(run, st) ?? st.poolRole ?? '—';
  const util = metricView('utilization', run, st);
  const kv = metricView('kv', run, st);
  const backpressure = metricView('backpressure', run, st);
  const batch =
    run.payloads.batchByPool?.[role] ??
    (run.source.kind === 'synthetic' ? batchFor(run, role) : null);
  const cS = cursorSeconds(st);

  return (
    <Stack spacing={2}>
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 2 }}
      >
        <ChartCard
          idx="a"
          title={METRIC_TITLES.utilization}
          sub={util.sub}
          option={util.option}
          note={util.note}
          caption={METRIC_CAPTIONS.utilization}
          empty={util.note ?? undefined}
        />
        <ChartCard
          idx="b"
          title={METRIC_TITLES.kv}
          sub={kv.sub}
          option={kv.option}
          note={kv.note}
          caption={METRIC_CAPTIONS.kv}
          empty={kv.note ?? undefined}
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
      <ChartCard
        idx="d"
        title="Batch composition"
        sub={`pool: ${role}`}
        option={batch ? batchOption(batch, CHART_THEME, cS) : null}
        note={
          batch
            ? 'prefill ∥ decode tokens per step · concurrent decode requests (right axis)'
            : 'batch subject not generated for this folder'
        }
        empty={batch ? undefined : 'Batch composition is unavailable for this simulation folder.'}
        caption="Batched tokens per scheduler step, split into prefill vs decode, with the number of concurrent decode requests on the right axis. Shows how the pool fills its token budget over the run."
      />
      <WorkersInPool idx="e" role={role} />
    </Stack>
  );
}
