import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, Stack, Typography } from '@mui/material';

import { useActiveRun } from '../../application/ActiveRunProvider';
import SurfaceCard from '../../components/SurfaceCard';
import { currentWorker } from '../../application/runSelection';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import {
  costTreeDisplayLabel,
  fmtMs,
  fmtPct,
  nodeById,
  type CostNode,
} from '../../domain/cost-tree';
import { useViz } from '../../store';
import { tokens } from '../../theme';

function nodeLabel(node: CostNode): string {
  if (node.kind === 'leaf') return node.slot.name;
  return costTreeDisplayLabel(node.label ?? node.kind);
}

/** Selected Max view. It exposes only facts derivable from the validated pure
 * Max algebra; per-lane load and straggler claims require a future artifact. */
export default function ParallelDetail() {
  const scope = useViz((state) => state.scope);
  const workerKey = useViz((state) => state.workerKey);
  const parId = useViz((state) => state.parId);
  const selectWorker = useViz((state) => state.selectWorker);
  const run = useActiveRun();
  const treeState = useActiveWorkerTreeState();
  if (scope !== 'parallel' || parId === null) return null;
  if (treeState.status !== 'ready') return null;
  const worker = currentWorker(run, { workerKey });
  const node = nodeById(treeState.tree, parId);
  if (node === null || node.kind !== 'max') return null;
  const criticalChild = node.children.reduce((critical, child) =>
    child.ms > critical.ms ? child : critical,
  );

  return (
    <SurfaceCard accent={tokens.violet}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 1.5, p: '15px 18px', borderBottom: `1px solid ${tokens.hair}` }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 22 }}>
          parallel{' '}
          <Box
            component="span"
            sx={{ fontFamily: tokens.mono, fontSize: 13, color: tokens.violet }}
          >
            ⇉ {costTreeDisplayLabel(node.label ?? 'max')}
          </Box>
        </Typography>
        <Box
          sx={{
            fontFamily: tokens.mono,
            fontSize: 10.5,
            px: 1.1,
            py: 0.4,
            borderRadius: 0.75,
            color: tokens.violet,
            background: 'rgba(122,92,255,.12)',
          }}
        >
          pure Max · critical path
        </Box>
        <IconButton
          aria-label={`Back to worker ${worker.ref.poolTag}/${worker.ref.workerId}`}
          size="small"
          onClick={() => selectWorker(worker.ref)}
          sx={{ ml: 'auto', color: tokens.sub }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' },
          '& > div': { p: '12px 18px', borderBottom: `1px solid ${tokens.hair}` },
        }}
      >
        <div>
          wall-time
          <br />
          <b>{fmtMs(node.ms)}</b>
        </div>
        <div>
          share of tree root
          <br />
          <b>{fmtPct(node.pct)}</b>
        </div>
        <div>
          parallel branches
          <br />
          <b>{node.children.length}</b>
        </div>
        <div>
          critical child
          <br />
          <b>{nodeLabel(criticalChild)}</b>
        </div>
      </Box>
      <Box
        role="status"
        sx={{ m: 1.5, p: 1.5, borderLeft: `3px solid ${tokens.gold}`, background: tokens.tile }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}>
          Load-imbalance detail not generated
        </Typography>
        <Typography sx={{ mt: 0.35, fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
          Analyzer v1 has no versioned per-lane load or straggler artifact. The critical child above
          is the real CostTree Max result, not an inferred lane measurement.
        </Typography>
        <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}>
          evidence status · not_generated
        </Typography>
      </Box>
    </SurfaceCard>
  );
}
