import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useViz } from '../store';
import { currentWorker, projectWorkerTree } from '../application/runSelection';
import { useActiveRun } from '../application/ActiveRunProvider';
import { useActiveWorkerTreeState } from '../application/WorkerTreeProvider';
import { leafById, nodeById } from '../data/tree';
import { tokens } from '../theme';
import { shortName } from '../util';

interface Crumb {
  g: string;
  lab: string;
  here: boolean;
  onClick?: () => void;
}

const crumbSx = (here: boolean) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.9,
  px: 1.5,
  py: 0.6,
  borderRadius: 1.75,
  fontSize: 12.5,
  fontWeight: 600,
  border: `1px solid ${here ? tokens.hair : 'transparent'}`,
  color: here ? tokens.ink : tokens.sub,
  background: here ? tokens.tile : 'transparent',
  boxShadow: here ? tokens.shadow : 'none',
  transition: `all .28s ${tokens.ease}`,
  '&:hover': here ? {} : { color: tokens.ink, background: 'rgba(42,38,34,.04)' },
});

export default function ScopeBreadcrumbs() {
  const st = useViz();
  const run = useActiveRun();
  const treeState = useActiveWorkerTreeState();
  const w = currentWorker(run, st);
  const tree = treeState.status === 'ready' ? projectWorkerTree(run, st, treeState.tree) : null;

  const parts: Crumb[] = [
    { g: '▸', lab: shortName(run), here: st.scope === 'cluster', onClick: () => st.setCluster() },
  ];
  if (st.scope !== 'cluster') {
    const role = st.poolRole ?? w.pool;
    parts.push({
      g: 'pool',
      lab: role,
      here: st.scope === 'pool',
      onClick: () => st.selectPool(role),
    });
  }
  if (st.scope === 'worker' || st.scope === 'kernel' || st.scope === 'parallel') {
    parts.push({
      g: 'worker',
      lab: w.id,
      here: st.scope === 'worker',
      onClick: () => st.selectWorker(w.ref),
    });
  }
  if (st.scope === 'kernel') {
    const lf = tree ? leafById(tree, st.leafId) : null;
    parts.push({ g: 'kernel', lab: lf ? lf.slot!.name.split('.').pop()! : '—', here: true });
  }
  if (st.scope === 'parallel') {
    const pn = tree ? nodeById(tree, st.parId) : null;
    parts.push({ g: 'parallel', lab: pn ? (pn.label ?? 'max') : '—', here: true });
  }

  const hint: Record<string, string> = {
    cluster: 'cluster — SLO · throughput · conservation',
    pool: 'pool — utilization · KV · batch composition · kernel time',
    worker: run.capabilities.workerIterations
      ? 'worker — batch composition · cost tree · kernel throughput'
      : 'worker — full-run aggregate kernel time share',
    kernel: run.capabilities.kernelPerformance
      ? 'kernel — roofline · input distribution'
      : 'kernel — detail not generated',
    parallel: run.capabilities.loadImbalance
      ? 'parallel — load imbalance · straggler'
      : 'parallel — detail not generated',
  };

  return (
    <Stack
      direction="row"
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      sx={{ gap: 1.1, my: 2.2 }}
    >
      {parts.map((p, i) => {
        const content = (
          <>
            <Box component="span" sx={{ fontFamily: tokens.mono, fontSize: 11, opacity: 0.7 }}>
              {p.g}
            </Box>
            {p.lab}
          </>
        );
        return (
          <Stack key={`${p.g}-${p.lab}`} direction="row" alignItems="center" spacing={1.1}>
            {i > 0 && (
              <Box
                component="span"
                sx={{
                  color: tokens.sub,
                  opacity: 0.5,
                  fontFamily: tokens.serif,
                  fontStyle: 'italic',
                }}
              >
                /
              </Box>
            )}
            {p.here ? (
              <Box component="span" aria-current="page" sx={crumbSx(true)}>
                {content}
              </Box>
            ) : (
              <ButtonBase
                type="button"
                aria-label={`Scope to ${p.g} ${p.lab}`}
                onClick={p.onClick}
                sx={crumbSx(false)}
              >
                {content}
              </ButtonBase>
            )}
          </Stack>
        );
      })}
      <Typography
        sx={{
          ml: 'auto',
          fontFamily: tokens.mono,
          fontSize: 10.5,
          color: tokens.sub2,
          letterSpacing: '.04em',
        }}
      >
        {hint[st.scope]}
      </Typography>
    </Stack>
  );
}
