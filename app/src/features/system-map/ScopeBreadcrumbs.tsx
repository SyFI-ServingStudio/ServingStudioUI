import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useViz } from '../../store';
import { currentWorker, projectWorkerTree } from '../../application/runSelection';
import { useActiveRun } from '../../application/ActiveRunProvider';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { leafById, nodeById } from '../../data/tree';
import { tokens } from '../../theme';
import { shortName } from '../../util';

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
  const scope = useViz((state) => state.scope);
  const poolRole = useViz((state) => state.poolRole);
  const workerKey = useViz((state) => state.workerKey);
  const leafId = useViz((state) => state.leafId);
  const parId = useViz((state) => state.parId);
  const cursorMs = useViz((state) => state.cursorMs);
  const setCluster = useViz((state) => state.setCluster);
  const selectPool = useViz((state) => state.selectPool);
  const selectWorker = useViz((state) => state.selectWorker);
  const run = useActiveRun();
  const treeState = useActiveWorkerTreeState();
  const w = currentWorker(run, { workerKey });
  const tree =
    treeState.status === 'ready'
      ? projectWorkerTree(run, { workerKey, cursorMs }, treeState.tree)
      : null;

  const parts: Crumb[] = [
    { g: '▸', lab: shortName(run), here: scope === 'cluster', onClick: setCluster },
  ];
  if (scope !== 'cluster') {
    const role = poolRole ?? w.pool;
    parts.push({
      g: 'pool',
      lab: role,
      here: scope === 'pool',
      onClick: () => selectPool(role),
    });
  }
  if (scope === 'worker' || scope === 'kernel' || scope === 'parallel') {
    parts.push({
      g: 'worker',
      lab: w.id,
      here: scope === 'worker',
      onClick: () => selectWorker(w.ref),
    });
  }
  if (scope === 'kernel') {
    const lf = tree ? leafById(tree, leafId) : null;
    parts.push({
      g: 'kernel',
      lab: lf ? (lf.slot.name.split('.').pop() ?? lf.slot.name) : '—',
      here: true,
    });
  }
  if (scope === 'parallel') {
    const pn = tree ? nodeById(tree, parId) : null;
    parts.push({
      g: 'parallel',
      lab: pn?.kind === 'max' ? (pn.label ?? 'max') : '—',
      here: true,
    });
  }

  const hint: Record<string, string> = {
    cluster: 'cluster — SLO · throughput · conservation',
    pool: 'pool — utilization · KV · batch composition · kernel time',
    worker: run.capabilities.workerIterations
      ? 'worker — batch composition · cost tree · kernel throughput'
      : treeState.status === 'ready' && treeState.evidence === 'hierarchical-detail'
        ? 'worker — hierarchical CostTree detail'
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
        {hint[scope]}
      </Typography>
    </Stack>
  );
}
