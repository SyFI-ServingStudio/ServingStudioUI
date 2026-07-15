import { useMemo } from 'react';
import { Box, Stack } from '@mui/material';
import { useViz } from '../../store';
import { cursorSeconds, poolInScope } from '../../application/runSelection';
import { useActiveRun, useActiveRunSubject } from '../../application/ActiveRunProvider';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';
import {
  batchOption,
  KernelTimeBreakdownCard,
  metricView,
  METRIC_TITLES,
  METRIC_CAPTIONS,
} from '../metrics';
import WorkersInPool from './WorkersInPool';

/** Pool-level resource behaviour: utilization, KV, queue/batch, kernel mix, then drill. */
export default function PoolStage() {
  const scope = useViz((state) => state.scope);
  const poolRole = useViz((state) => state.poolRole);
  const workerKey = useViz((state) => state.workerKey);
  const cursorMs = useViz((state) => state.cursorMs);
  const run = useActiveRun();
  const utilizationSubject = useActiveRunSubject('utilization');
  const kvSubject = useActiveRunSubject('kv');
  const backpressureSubject = useActiveRunSubject('backpressure');
  const batchSubject = useActiveRunSubject('batch');
  const kernelTimeShare = useActiveRunSubject('kernelTimeShare');
  const metricSelection = useMemo(
    () => ({ scope, poolRole, workerKey, cursorMs }),
    [scope, poolRole, workerKey, cursorMs],
  );
  const role = poolInScope(run, metricSelection) ?? poolRole ?? '—';
  const util = metricView(utilizationSubject, run, metricSelection);
  const kv = metricView(kvSubject, run, metricSelection);
  const backpressure = metricView(backpressureSubject, run, metricSelection);
  const batch = batchSubject.status === 'ready' ? batchSubject.payload.pools[role] : undefined;
  const batchSub =
    batchSubject.status === 'ready'
      ? batch === undefined
        ? 'ready · empty'
        : `pool: ${role}`
      : subjectStatusLabel(batchSubject);
  const batchEmpty =
    batchSubject.status === 'ready'
      ? `The batch subject has no series for pool ${role}.`
      : subjectStatusMessage(batchSubject);
  const cS = cursorSeconds(metricSelection);

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
          empty={util.empty}
        />
        <ChartCard
          idx="b"
          title={METRIC_TITLES.kv}
          sub={kv.sub}
          option={kv.option}
          note={kv.note}
          caption={METRIC_CAPTIONS.kv}
          empty={kv.empty}
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
      <ChartCard
        idx="d"
        title="Batch composition"
        sub={batchSub}
        option={batch ? batchOption(batch, CHART_THEME, cS) : null}
        note={
          batch
            ? 'prefill ∥ decode tokens per step · concurrent decode requests (right axis)'
            : null
        }
        empty={batch ? undefined : batchEmpty}
        caption="Batched tokens per scheduler step, split into prefill vs decode, with the number of concurrent decode requests on the right axis. Shows how the pool fills its token budget over the run."
      />
      <KernelTimeBreakdownCard
        idx="e"
        title={`Kernel time breakdown · ${role}`}
        subject={kernelTimeShare}
        scope={{ kind: 'pool', poolTag: role }}
      />
      <WorkersInPool idx="f" role={role} />
    </Stack>
  );
}
