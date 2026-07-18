import { useMemo } from 'react';
import { Box, Stack } from '@mui/material';
import { useViz } from '../../store';
import { poolInScope } from '../../application/runSelection';
import { useActiveRun, useActiveRunSubject } from '../../application/ActiveRunProvider';
import ChartCard from '../../components/ChartCard';
import { KernelTimeBreakdownCard, metricView, METRIC_TITLES, METRIC_CAPTIONS } from '../metrics';
import PoolBatchComposition from './PoolBatchComposition';
import PoolRequestStateCard from './PoolRequestStateCard';

/** Pool resources and composition; backpressure immediately precedes the
 * closing kernel breakdown. */
export default function PoolStage() {
  const scope = useViz((state) => state.scope);
  const poolRole = useViz((state) => state.poolRole);
  const workerKey = useViz((state) => state.workerKey);
  const cursorMs = useViz((state) => state.cursorMs);
  const run = useActiveRun();
  const utilizationSubject = useActiveRunSubject('utilization');
  const kvSubject = useActiveRunSubject('kv');
  const kernelTimeShare = useActiveRunSubject('kernelTimeShare');
  const metricSelection = useMemo(
    () => ({ scope, poolRole, workerKey, cursorMs }),
    [scope, poolRole, workerKey, cursorMs],
  );
  const role = poolInScope(run, metricSelection) ?? poolRole ?? '—';
  const util = metricView(utilizationSubject, run, metricSelection);
  const kv = metricView(kvSubject, run, metricSelection);

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
      <PoolBatchComposition poolTag={role} />
      <PoolRequestStateCard poolTag={role} />
      <KernelTimeBreakdownCard
        idx="f"
        title={`Kernel time breakdown · ${role}`}
        subject={kernelTimeShare}
        scope={{ kind: 'pool', poolTag: role }}
      />
    </Stack>
  );
}
