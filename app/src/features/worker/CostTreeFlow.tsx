import { Box, Paper, Stack, Typography } from '@mui/material';

import { useActiveRun } from '../../application/ActiveRunProvider';
import { currentWorker } from '../../application/runSelection';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { GROUP, fmtMs } from '../../domain/cost-tree';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import CostTreeNode from './CostTreeNode';

export default function CostTreeFlow() {
  const scope = useViz((state) => state.scope);
  const workerKey = useViz((state) => state.workerKey);
  const leafId = useViz((state) => state.leafId);
  const parId = useViz((state) => state.parId);
  const selectWorker = useViz((state) => state.selectWorker);
  const selectKernel = useViz((state) => state.selectKernel);
  const selectParallel = useViz((state) => state.selectParallel);
  const run = useActiveRun();
  const w = currentWorker(run, { workerKey });
  const treeState = useActiveWorkerTreeState();
  if (treeState.status !== 'ready') {
    throw new Error(`CostTreeFlow requires ready worker evidence, received ${treeState.status}.`);
  }
  const tree = treeState.tree;
  const selId = scope === 'kernel' ? leafId : null;
  const parSel = scope === 'parallel' ? parId : null;
  const timeBasis =
    treeState.evidence === 'hierarchical-detail' ? 'worker detail' : 'full-run aggregate';

  return (
    <Paper sx={{ borderRadius: 2, borderTop: `2px solid ${tokens.teal}`, overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 1.75, p: '14px 18px', borderBottom: `1px solid ${tokens.hair}` }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 18 }}>
          arch{' '}
          <Box
            component="span"
            sx={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.teal, fontWeight: 500 }}
          >
            {w.id} · {w.arch.type} · {w.gpuCount} GPU
          </Box>
        </Typography>
        <Box
          sx={{
            fontFamily: tokens.mono,
            fontSize: 11.5,
            color: tokens.sub,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 0.9,
            px: 1.25,
            py: 0.5,
            background: tokens.tile2,
          }}
        >
          Σ / {timeBasis} <b style={{ color: tokens.teal }}>{fmtMs(tree.totalMs)}</b>
        </Box>
        <Stack
          direction="row"
          flexWrap="wrap"
          useFlexGap
          sx={{ gap: '5px 12px', alignItems: 'center', ml: 'auto' }}
        >
          {Object.entries(GROUP)
            .filter(([g]) => g !== 'misc')
            .map(([g, G]) => (
              <Box
                key={g}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.6,
                  fontSize: 10.5,
                  color: tokens.sub,
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: 0.75,
                    background: G.color,
                    border: '1px solid rgba(42,38,34,.12)',
                  }}
                />
                {G.label}
              </Box>
            ))}
          <Box
            component="span"
            sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub2, ml: 0.5 }}
          >
            → sequential · ⇉ parallel critical path · ×N repeat
          </Box>
        </Stack>
      </Stack>
      <Box sx={{ overflow: 'auto', p: '22px 18px 24px', minHeight: 220 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'stretch', width: 'max-content' }}>
          <CostTreeNode
            node={tree}
            selId={selId}
            onSelect={selectKernel}
            onRoot={() => selectWorker(w.ref)}
            parSel={parSel}
            onPar={selectParallel}
          />
        </Box>
      </Box>
    </Paper>
  );
}
